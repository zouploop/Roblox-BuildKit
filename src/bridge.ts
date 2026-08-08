// Bridge: localhost HTTP server that the Studio plugin long-polls.
// The plugin GETs /poll?place=<game.Name> (held open until a command is queued or
// ~25s elapse), runs the command in Studio, then POSTs /result. sendCommand()
// correlates by id. When two Studios run the plugin, set an active place filter
// (rbx_use_place) so commands only dispatch to the Studio whose name matches.
//
// SHARED BRIDGE (multi-agent): two MCP clients (e.g. Claude + Codex) each spawn
// their own copy of this server, but only ONE can bind port 44760. The first to
// bind is the "owner" and runs the real bridge; later copies fall back to "client"
// mode and forward their commands to the owner via POST /submit. The plugin only
// ever polls the single owner, so both agents drive the same Studio. If the owner
// process dies, a client self-promotes by grabbing the freed port (the plugin's
// poll loop reconnects on its own), so there's no single point of failure.
import http from "node:http";
import { loadConfig, saveConfig, CONFIG_PATH } from "./config.js";

// ctx separates the Edit-datamodel plugin ("edit") from the in-game runtime
// harness ("runtime") so a play-mode rbx_run never gets grabbed by the editor
// poller (and vice versa). Both poll the same bridge; ctx is the routing key.
type Cmd = { id: string; action: string; args: unknown; targetPlace: string | null; targetCtx: string };
type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};
type Waiter = { fn: (c: Cmd | null) => void; place: string; ctx: string };

const POLL_HOLD_MS = 25_000; // how long /poll is held open when idle

// A command targeted at `target` may run on a poller named `place` when no filter
// is set (target null) or the poller's place contains the filter (case-insensitive).
function placeMatches(place: string, target: string | null): boolean {
  if (!target) return true;
  return place.toLowerCase().includes(target.toLowerCase());
}

export class Bridge {
  private queue: Cmd[] = [];
  private waiters: Waiter[] = [];
  private pending = new Map<string, Pending>();
  private seq = 0;
  private server?: http.Server;
  private activePlace: string | null = null;
  private places = new Map<string, number>(); // edit place name -> last poll time
  private runtimePlaces = new Map<string, number>(); // play-mode harness place -> last poll
  // Shared-bridge state. "owner" runs the HTTP server the plugin polls; "client"
  // forwards commands to the owner. clientPlaces/* cache the owner's place lists so
  // the (synchronous) listPlaces() getters still work in client mode.
  private mode: "owner" | "client" = "owner";
  private port = 44760;
  private clientPlaces: string[] = [];
  private clientRuntimePlaces: string[] = [];
  // Settings pushed from the Studio plugin's BuildKit Settings panel (Open Cloud key,
  // Creator ID, ComfyUI URL, Hunyuan endpoint, build-mode toggles). Held in memory so
  // tools (mesh upload / ComfyUI) can read them; never persisted to disk or a place.
  private config: Record<string, unknown> = {};
  // Optional shared-secret bridge auth (env BRIDGE_TOKEN or config key "bridgeToken").
  // When set, every plugin-boundary request must present it as X-BuildKit-Token. This
  // stops a rogue local process from POSTing /submit (driving Studio) or /config
  // (overwriting creds) to the real bridge, and lets the plugin verify the server before
  // pushing secrets. Not a defense against a pre-existing port squatter — it receives the
  // token from the plugin's own request — so the config file + trust model stay documented.
  private token = "";

  async start(port: number, tokenOverride?: string): Promise<void> {
    this.port = port;
    this.config = await loadConfig(); // seed creds from the user-local config file
    this.token = tokenOverride || process.env.BRIDGE_TOKEN || (typeof this.config.bridgeToken === "string" ? this.config.bridgeToken : "");
    if (this.token) console.error("[buildkit] bridge token required (env BRIDGE_TOKEN or config bridgeToken)");
    try {
      await this.listen(port);
      this.mode = "owner";
    } catch (e: any) {
      if (e && e.code === "EADDRINUSE") {
        // Another buildkit already owns the bridge. Forward to it instead of dying.
        this.mode = "client";
        console.error(`[buildkit] port ${port} already owned; running as shared-bridge client`);
        await this.seedPlaces();
      } else {
        throw e;
      }
    }
  }

  // Bind the HTTP server. Rejects with EADDRINUSE when the port is already taken.
  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.onRequest(req, res));
      server.requestTimeout = 0; // we hold /poll and /submit open far longer than the default
      const onErr = (e: Error) => reject(e);
      server.on("error", onErr);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", onErr);
        // Keep a permanent error listener so a post-bind socket error is logged, not thrown as
        // an uncaught exception that would kill the whole MCP process.
        server.on("error", (e) => console.error("[buildkit] bridge server error:", e));
        this.server = server;
        console.error(`[buildkit] bridge listening on http://127.0.0.1:${port}`);
        resolve();
      });
    });
  }

  // Release the bridge port and fail any in-flight commands. Mainly for tests (so a suite
  // doesn't leak listeners between cases) and for a clean shutdown; in normal operation the
  // process just exits, which frees the port anyway. Safe to call when not the owner.
  async stop(): Promise<void> {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("bridge stopped"));
      this.pending.delete(id);
    }
    for (const w of this.waiters.splice(0)) w.fn(null);
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  setActivePlace(place: string | null) {
    this.activePlace = place && place.trim() ? place.trim() : null;
  }
  getActivePlace(): string | null {
    return this.activePlace;
  }
  // Latest settings from the plugin's settings panel (key/creator/comfy/modes).
  getConfig(): Record<string, unknown> {
    return this.config;
  }
  // Where the durable config file lives (shown in rbx_status).
  configPath(): string {
    return CONFIG_PATH;
  }
  // Keys the plugin's Settings panel may push. Whitelist so a rogue caller can't
  // spray arbitrary junk into the config object (and so nothing beyond the known
  // settings survives a save).
  private static CONFIG_KEYS = ["openCloudKey", "creatorId", "creatorType", "comfyUrl", "hunyuanUrl", "bridgeToken"];
  // Merge a /config push into the in-memory config and persist to the local file.
  // Skip empty-string values so a blank panel field never WIPES a saved secret
  // (the plugin pushes openCloudKey:"" when the panel box is empty). Unknown keys
  // are dropped. Resolves false when the save fails so the caller can surface it.
  private async applyConfig(incoming: Record<string, unknown>): Promise<boolean> {
    let changed = false;
    for (const [k, v] of Object.entries(incoming)) {
      if (!Bridge.CONFIG_KEYS.includes(k)) continue;
      if (v === "" || v == null) continue;
      if (this.config[k] !== v) {
        this.config[k] = v;
        changed = true;
      }
    }
    if (!changed) return true; // nothing new to persist — don't churn the file
    try {
      await saveConfig(this.config);
      return true;
    } catch (e) {
      console.error("[buildkit] config save failed:", e);
      return false;
    }
  }
  // Pollers seen within 30s (window > the 25s long-poll hold, so an idle poller
  // mid-hold still counts as connected). In client mode these come from the owner
  // (cached, refreshed on every /submit response and at startup).
  private freshPlaces(map: Map<string, number>, cache: string[]): string[] {
    if (this.mode === "client") return cache;
    const now = Date.now();
    return [...map.entries()].filter(([, t]) => now - t < 30_000).map(([p]) => p);
  }
  // Edit-datamodel plugin pollers seen in the last 30s.
  listPlaces(): string[] {
    return this.freshPlaces(this.places, this.clientPlaces);
  }
  // Play-mode runtime harnesses seen in the last 30s.
  listRuntimePlaces(): string[] {
    return this.freshPlaces(this.runtimePlaces, this.clientRuntimePlaces);
  }

  // Queue a command for the plugin and resolve when /result arrives. ctx picks
  // which poller serves it: "edit" (default, the Studio plugin) or "runtime"
  // (the in-game harness, only alive during Play). In client mode this forwards
  // to the owner bridge over HTTP.
  sendCommand(action: string, args: unknown = {}, timeoutMs = 30_000, ctx = "edit"): Promise<any> {
    if (this.mode === "client") return this.submitRemote(action, args, timeoutMs, ctx);
    return this.sendLocal(action, args, timeoutMs, ctx);
  }

  // Owner-side command dispatch: queue + wait for /result. targetPlace defaults to
  // this server's active place filter, but /submit passes the *client's* filter so
  // each agent's rbx_use_place is honoured independently.
  private sendLocal(
    action: string,
    args: unknown,
    timeoutMs: number,
    ctx: string,
    targetPlace: string | null = this.activePlace
  ): Promise<any> {
    const id = "c" + ++this.seq;
    const cmd: Cmd = { id, action, args, targetPlace, targetCtx: ctx };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const where = cmd.targetPlace ? ` for place "${cmd.targetPlace}"` : "";
        const hint =
          ctx === "runtime"
            ? " (is the game in Play mode with BuildKitRuntime installed? run rbx_runtime install, then Play.)"
            : " (is BuildKitPlugin running + polling in Studio?)";
        reject(new Error(`timeout waiting for ${ctx} plugin on action "${action}"${where}${hint}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      // hand straight to a matching idle poller if one is waiting, else queue it.
      const wi = this.waiters.findIndex((w) => w.ctx === ctx && placeMatches(w.place, cmd.targetPlace));
      if (wi >= 0) {
        const [w] = this.waiters.splice(wi, 1);
        w.fn(cmd);
      } else {
        this.queue.push(cmd);
      }
    });
  }

  // Client-side: POST the command to the owner bridge and await its /submit reply.
  // If the owner has gone (ECONNREFUSED/RESET), try to grab the port ourselves
  // (self-promotion) or fall through to whichever client won the race.
  private async submitRemote(
    action: string,
    args: unknown,
    timeoutMs: number,
    ctx: string,
    attempt = 0
  ): Promise<any> {
    const body = { action, args, ctx, timeoutMs, targetPlace: this.activePlace };
    try {
      const r = await this.httpJson("POST", "/submit", body, timeoutMs + 5000);
      if (Array.isArray(r?.places)) this.clientPlaces = r.places;
      if (Array.isArray(r?.runtimePlaces)) this.clientRuntimePlaces = r.runtimePlaces;
      if (r?.ok) return r.result;
      throw new Error(r?.error || "shared-bridge error");
    } catch (e: any) {
      const gone = e && (e.code === "ECONNREFUSED" || e.code === "ECONNRESET");
      if (gone && attempt < 3) {
        if (await this.tryPromote()) return this.sendLocal(action, args, timeoutMs, ctx);
        return this.submitRemote(action, args, timeoutMs, ctx, attempt + 1);
      }
      throw e;
    }
  }

  // Attempt to take over the freed bridge port. true => we're the new owner.
  private async tryPromote(): Promise<boolean> {
    try {
      await this.listen(this.port);
      this.mode = "owner";
      console.error("[buildkit] promoted to bridge owner (previous owner gone)");
      return true;
    } catch (e: any) {
      if (e && e.code === "EADDRINUSE") return false; // another client beat us to it
      throw e;
    }
  }

  private async seedPlaces(): Promise<void> {
    try {
      const r = await this.httpJson("GET", "/places", null, 3000);
      if (Array.isArray(r?.places)) this.clientPlaces = r.places;
      if (Array.isArray(r?.runtimePlaces)) this.clientRuntimePlaces = r.runtimePlaces;
    } catch {
      /* owner may be mid-restart; caches fill on the first command */
    }
  }

  private httpJson(method: string, path: string, body: unknown, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const data = body == null ? "" : JSON.stringify(body);
      const headers: Record<string, string> = { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(data)) };
      if (this.token) headers["X-BuildKit-Token"] = this.token;
      const req = http.request(
        {
          host: "127.0.0.1",
          port: this.port,
          path,
          method,
          headers,
        },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            try {
              resolve(buf ? JSON.parse(buf) : {});
            } catch (err) {
              reject(err as Error);
            }
          });
        }
      );
      req.on("error", reject);
      if (timeoutMs > 0) req.setTimeout(timeoutMs, () => req.destroy(new Error("shared-bridge submit timeout")));
      if (data) req.write(data);
      req.end();
    });
  }

  // Pop the first queued command this poller (place + ctx) is allowed to run.
  private takeFor(place: string, ctx: string): Cmd | undefined {
    const i = this.queue.findIndex((c) => c.targetCtx === ctx && placeMatches(place, c.targetPlace));
    if (i < 0) return undefined;
    return this.queue.splice(i, 1)[0];
  }

  // When a bridge token is configured, require X-BuildKit-Token on plugin-facing
  // endpoints. Returns false (and has written a 401) when the request is rejected.
  private requireToken(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (!this.token) return true;
    if (req.headers["x-buildkit-token"] === this.token) return true;
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
    return false;
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = req.url || "";
    if (req.method === "GET" && url.startsWith("/poll")) {
      if (this.rejectBrowser(req, res)) return; // block cross-origin browser theft of plugin commands
      if (!this.requireToken(req, res)) return; // token required if configured
      const params = new URL(url, "http://x").searchParams;
      const place = params.get("place") || "";
      const ctx = params.get("ctx") || "edit";
      if (place) (ctx === "runtime" ? this.runtimePlaces : this.places).set(place, Date.now());
      // Echo a positive auth signal back so the plugin can confirm this is the real server
      // before it pushes secrets. Header-only: the poll body stays a command (or empty).
      const headers = { "Content-Type": "application/json", "X-BuildKit-Auth": this.token ? "ok" : "" };

      const cmd = this.takeFor(place, ctx);
      if (cmd) {
        res.writeHead(200, headers);
        res.end(JSON.stringify(cmd));
        return;
      }
      // hold open until a matching command appears or timeout
      let done = false;
      const fn = (c: Cmd | null) => {
        if (done) return;
        done = true;
        res.writeHead(200, headers);
        res.end(c ? JSON.stringify(c) : "");
      };
      const waiter: Waiter = { fn, place, ctx };
      this.waiters.push(waiter);
      const t = setTimeout(() => {
        if (done) return;
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        fn(null);
      }, POLL_HOLD_MS);
      req.on("close", () => {
        done = true;
        clearTimeout(t);
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
      });
      return;
    }

    if (req.method === "POST" && url.startsWith("/result")) {
      if (this.rejectBrowser(req, res)) return; // block drive-by browser spoofing of command results
      if (!this.requireToken(req, res)) return;
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const data = JSON.parse(body || "{}");
          const p = this.pending.get(data.id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(data.id);
            if (data.ok) p.resolve(data.result);
            else p.reject(new Error(String(data.error || "plugin error")));
          }
          res.writeHead(200);
          res.end("ok");
        } catch (e) {
          res.writeHead(400);
          res.end("bad json");
        }
      });
      return;
    }

    // Shared bridge: another MCP server (client mode) forwards a command here.
    if (req.method === "POST" && url.startsWith("/submit")) {
      if (this.rejectBrowser(req, res)) return; // defense-in-depth: reject any browser-origin request
      if (!this.requireToken(req, res)) return; // token required if configured
      if (!this.requireJson(req, res)) return; // block drive-by browser CSRF (no-preflight POSTs)
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        let d: any;
        try {
          d = JSON.parse(body || "{}");
        } catch {
          res.writeHead(400);
          res.end("bad json");
          return;
        }
        const tmo = typeof d.timeoutMs === "number" ? d.timeoutMs : 30_000;
        this.sendLocal(d.action, d.args ?? {}, tmo, d.ctx || "edit", d.targetPlace ?? null)
          .then((result) => this.endSubmit(res, { ok: true, result }))
          .catch((err: Error) => this.endSubmit(res, { ok: false, error: String(err?.message || err) }));
      });
      return;
    }

    // Shared bridge: client seeds/refreshes its place caches from the owner.
    if (req.method === "GET" && url.startsWith("/places")) {
      if (!this.requireToken(req, res)) return;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ places: this.listPlaces(), runtimePlaces: this.listRuntimePlaces() }));
      return;
    }

    // Settings panel pushes its config here (held in memory for upload/ComfyUI tools).
    if (req.method === "POST" && url.startsWith("/config")) {
      if (this.rejectBrowser(req, res)) return; // defense-in-depth: reject any browser-origin request
      if (!this.requireToken(req, res)) return; // token required if configured — secrets endpoint
      if (!this.requireJson(req, res)) return; // creds endpoint — same CSRF guard as /submit
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(body || "{}");
        } catch {
          /* ignore bad json */
        }
        if (parsed) {
          this.applyConfig(parsed)
            .then((saved) => {
              if (saved) console.error(`[buildkit] settings saved -> ${CONFIG_PATH}`);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: saved, path: CONFIG_PATH }));
            })
            .catch(() => {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: "config save failed" }));
            });
          return;
        }
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "bad json" }));
      });
      return;
    }

    res.writeHead(404);
    res.end("not found");
  }

  // The bridge has no auth (any LOCAL process can reach 127.0.0.1:44760). /submit dispatches
  // arbitrary buildkit actions (incl. sync = writing script Source) and /config overwrites creds,
  // so require an application/json content-type: legit clients (the plugin's post() and the MCP
  // client's httpJson) always send it, while a no-preflight browser POST can't — killing drive-by CSRF.
  // Drive-by CSRF guard for the plugin-boundary endpoints. Browsers always attach at least one of
  // these cross-origin markers (Origin on non-GET, Sec-Fetch-* on every fetch in modern browsers);
  // the plugin's HttpService:RequestAsync sends neither, so it always passes. Rejecting when either
  // header is present blocks a malicious web page from spoofing /result or stealing /poll commands.
  private isBrowserRequest(req: http.IncomingMessage): boolean {
    return req.headers["origin"] !== undefined || req.headers["sec-fetch-site"] !== undefined;
  }

  private rejectBrowser(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (this.isBrowserRequest(req)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "forbidden" }));
      return true;
    }
    return false;
  }

  private requireJson(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const ct = String(req.headers["content-type"] || "");
    if (!ct.includes("application/json")) {
      res.writeHead(415, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Content-Type must be application/json" }));
      return false;
    }
    return true;
  }

  private endSubmit(res: http.ServerResponse, payload: { ok: boolean; result?: unknown; error?: string }) {
    if (res.writableEnded) return;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ...payload, places: this.listPlaces(), runtimePlaces: this.listRuntimePlaces() }));
  }
}
