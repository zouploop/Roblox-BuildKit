// The bridge is the piece with the most moving parts and the least direct observability:
// long-poll dispatch, place/ctx routing, the shared-bridge owner/client split, and the
// CSRF guards on the plugin-facing endpoints. These tests drive it over real HTTP with a
// fake "plugin" so the wire contract is what's actually under test.
//
// NOTE: nothing here touches POST /config. That endpoint persists to the real
// ~/.buildkit/config.json, and a test must never overwrite the user's Open Cloud key.
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { Bridge } from "../src/bridge.js";

const open: Bridge[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((b) => b.stop().catch(() => {})));
});

async function freePort(): Promise<number> {
  const s = http.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as any).port as number;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

async function startBridge(port: number): Promise<Bridge> {
  const b = new Bridge();
  await b.start(port);
  open.push(b);
  return b;
}

// Minimal stand-in for BuildKitPlugin's poll loop: GET /poll, run `run`, POST /result.
function req(port: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    const r = http.request(
      { host: "127.0.0.1", port, path, method, headers: { "Content-Length": Buffer.byteLength(data), ...headers } },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: buf }));
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

// Poll as a plugin but hang up after `waitMs`. Needed whenever a test asserts that
// NOTHING was dispatched: the bridge legitimately holds an idle /poll open for
// POLL_HOLD_MS (25s), so waiting for it to return would blow the test timeout.
// Resolves null on "nothing arrived", or the command if one did.
function pollBriefly(port: number, place: string, ctx = "edit", waitMs = 300): Promise<any | null> {
  return new Promise((resolve, reject) => {
    let hungUp = false;
    const r = http.request(
      { host: "127.0.0.1", port, path: `/poll?place=${encodeURIComponent(place)}&ctx=${ctx}`, method: "GET" },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve(buf ? JSON.parse(buf) : null));
      }
    );
    r.on("error", (e) => (hungUp ? resolve(null) : reject(e)));
    setTimeout(() => {
      hungUp = true;
      r.destroy();
    }, waitMs);
    r.end();
  });
}

// Poll once as a plugin in `place`, and answer whatever command arrives.
async function serveOne(port: number, place: string, run: (cmd: any) => unknown, ctx = "edit") {
  const res = await req(port, "GET", `/poll?place=${encodeURIComponent(place)}&ctx=${ctx}`);
  if (!res.body) return null; // long-poll expired with nothing for us
  const cmd = JSON.parse(res.body);
  await req(port, "POST", "/result", { id: cmd.id, ok: true, result: run(cmd) }, { "Content-Type": "application/json" });
  return cmd;
}

describe("command round trip", () => {
  it("dispatches a queued command to a polling plugin and resolves with its result", async () => {
    const port = await freePort();
    const b = await startBridge(port);
    const pending = b.sendCommand("ping", { x: 1 }, 5000);
    const cmd = await serveOne(port, "MyPlace", (c) => ({ echoed: c.args.x, action: c.action }));
    expect(cmd.action).toBe("ping");
    await expect(pending).resolves.toEqual({ echoed: 1, action: "ping" });
  });

  it("hands a command straight to an already-waiting poller", async () => {
    const port = await freePort();
    const b = await startBridge(port);
    // Poller arrives FIRST and is parked in this.waiters; the command must go to it
    // immediately rather than sitting in the queue until the next poll.
    const served = serveOne(port, "MyPlace", () => ({ ok: true }));
    await new Promise((r) => setTimeout(r, 50));
    await expect(b.sendCommand("ping", {}, 5000)).resolves.toEqual({ ok: true });
    await served;
  });

  it("rejects with an actionable message when no plugin answers", async () => {
    const port = await freePort();
    const b = await startBridge(port);
    await expect(b.sendCommand("ping", {}, 150)).rejects.toThrow(/timeout waiting for edit plugin on action "ping"/);
  });

  it("propagates a plugin-side error as a rejection", async () => {
    const port = await freePort();
    const b = await startBridge(port);
    const pending = b.sendCommand("build", {}, 5000);
    // Attach before POSTing: /result rejects the pending promise synchronously inside the
    // request handler, and a rejection with no handler yet attached is reported as unhandled.
    const rejected = expect(pending).rejects.toThrow("unknown build kind: nil");
    const res = await req(port, "GET", "/poll?place=P&ctx=edit");
    const cmd = JSON.parse(res.body);
    await req(port, "POST", "/result", { id: cmd.id, ok: false, error: "unknown build kind: nil" },
      { "Content-Type": "application/json" });
    await rejected;
  });
});

describe("place routing", () => {
  it("routes to any place when no filter is set", async () => {
    const port = await freePort();
    const b = await startBridge(port);
    const pending = b.sendCommand("ping", {}, 5000);
    await serveOne(port, "Anything At All", () => "served");
    await expect(pending).resolves.toBe("served");
  });

  it("matches the filter case-insensitively on a substring", async () => {
    const port = await freePort();
    const b = await startBridge(port);
    b.setActivePlace("noir");
    expect(b.getActivePlace()).toBe("noir");
    const pending = b.sendCommand("ping", {}, 5000);
    await serveOne(port, "My NOIR Apartment", () => "served");
    await expect(pending).resolves.toBe("served");
  });

  it("withholds a filtered command from a non-matching place", async () => {
    const port = await freePort();
    const b = await startBridge(port);
    b.setActivePlace("Alpha");
    // Attach the rejection handler up front: the command times out at 400ms, well before
    // the assertions below finish, and an unobserved rejection fails the run.
    const pending = b.sendCommand("ping", {}, 400);
    const rejected = expect(pending).rejects.toThrow(/for place "Alpha"/);
    // A plugin in the wrong place polls; it must be handed nothing.
    expect(await pollBriefly(port, "Beta")).toBeNull();
    await rejected;
  });

  it("treats a blank filter as cleared", async () => {
    const port = await freePort();
    const b = await startBridge(port);
    b.setActivePlace("   ");
    expect(b.getActivePlace()).toBeNull();
  });
});

describe("ctx routing", () => {
  it("does not let the edit poller take a runtime command", async () => {
    const port = await freePort();
    const b = await startBridge(port);
    const pending = b.sendCommand("eval", { code: "return 1" }, 400, "runtime");
    const rejected = expect(pending).rejects.toThrow(/timeout waiting for runtime plugin/);
    expect(await pollBriefly(port, "P", "edit")).toBeNull();
    await rejected;
  });

  it("delivers a runtime command to the runtime poller", async () => {
    const port = await freePort();
    const b = await startBridge(port);
    const pending = b.sendCommand("eval", { code: "return 1" }, 5000, "runtime");
    await serveOne(port, "P", () => ({ value: 1 }), "runtime");
    await expect(pending).resolves.toEqual({ value: 1 });
  });

  it("tracks edit and runtime pollers in separate place lists", async () => {
    const port = await freePort();
    const b = await startBridge(port);
    // The poller registers its place as soon as /poll is received, before the hold; a
    // brief poll is enough to record it.
    await pollBriefly(port, "EditPlace", "edit", 200);
    expect(b.listPlaces()).toContain("EditPlace");
    expect(b.listRuntimePlaces()).not.toContain("EditPlace");
  });
});

describe("shared bridge (owner / client)", () => {
  it("makes a second bridge on the same port a client that forwards to the owner", async () => {
    const port = await freePort();
    await startBridge(port); // owner
    const client = await startBridge(port); // EADDRINUSE -> client mode
    const pending = client.sendCommand("ping", { via: "client" }, 5000);
    // The plugin only ever polls the OWNER; the client's command must still reach it.
    const cmd = await serveOne(port, "MyPlace", (c) => ({ seen: c.args.via }));
    expect(cmd.action).toBe("ping");
    await expect(pending).resolves.toEqual({ seen: "client" });
  });

  it("honours each client's own place filter rather than the owner's", async () => {
    const port = await freePort();
    const owner = await startBridge(port);
    const client = await startBridge(port);
    owner.setActivePlace("OwnerOnly");
    client.setActivePlace("Beta");
    const pending = client.sendCommand("ping", {}, 5000);
    // Place "Beta" matches the CLIENT's filter but not the owner's — it must still be served.
    await serveOne(port, "Beta", () => "ok");
    await expect(pending).resolves.toBe("ok");
  });

  it("promotes a client to owner once the previous owner releases the port", async () => {
    const port = await freePort();
    const owner = await startBridge(port);
    const client = await startBridge(port);
    await owner.stop();
    // First command after the owner vanished: the forward fails with ECONNREFUSED, the
    // client grabs the freed port and serves the command itself.
    const pending = client.sendCommand("ping", {}, 5000);
    await new Promise((r) => setTimeout(r, 100));
    await serveOne(port, "MyPlace", () => "served by promoted owner");
    await expect(pending).resolves.toBe("served by promoted owner");
  });
});

describe("endpoint guards", () => {
  it("rejects browser-origin requests to the plugin endpoints", async () => {
    const port = await freePort();
    await startBridge(port);
    for (const [method, path] of [["GET", "/poll?place=P"], ["POST", "/result"], ["POST", "/submit"]] as const) {
      const withOrigin = await req(port, method, path, {}, { Origin: "https://evil.example" });
      expect(withOrigin.status, `${method} ${path} with Origin`).toBe(403);
      const withFetchSite = await req(port, method, path, {}, { "Sec-Fetch-Site": "cross-site" });
      expect(withFetchSite.status, `${method} ${path} with Sec-Fetch-Site`).toBe(403);
    }
  });

  it("requires a JSON content-type on /submit", async () => {
    const port = await freePort();
    await startBridge(port);
    const res = await req(port, "POST", "/submit", { action: "ping" }, { "Content-Type": "text/plain" });
    expect(res.status).toBe(415);
  });

  it("serves /places without needing a content-type", async () => {
    const port = await freePort();
    await startBridge(port);
    const res = await req(port, "GET", "/places");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty("places");
  });

  it("404s an unknown path", async () => {
    const port = await freePort();
    await startBridge(port);
    expect((await req(port, "GET", "/nope")).status).toBe(404);
  });
});
