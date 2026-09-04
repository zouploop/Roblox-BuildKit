import puppeteer, { type Browser, type Page } from "puppeteer";

export type StageCameraAngle = {
  azimuth: number;
  elevation: number;
};
export type StageCaptureOptions = { width?: number; height?: number; opIndex?: number };

type SessionPage = {
  page: Page;
  busy: boolean;
  lastUsed: number;
  idleTimer?: NodeJS.Timeout;
};

export type StageRendererOptions = {
  viewerUrl?: string;
  idleTimeoutMs?: number;
  settleMs?: number;
  maxPages?: number;
  launch?: typeof puppeteer.launch;
};

const DEFAULT_ANGLE: StageCameraAngle = { azimuth: 45, elevation: 25 };

export class StageRenderer {
  private readonly viewerUrl: string;
  private readonly idleTimeoutMs: number;
  private readonly settleMs: number;
  private readonly maxPages: number;
  private readonly launch: typeof puppeteer.launch;
  private readonly sessions = new Map<string, SessionPage>();
  private browser?: Promise<Browser>;
  private acquireTail: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(options: StageRendererOptions = {}) {
    this.viewerUrl = options.viewerUrl ?? "http://localhost:8642/stage.html";
    this.idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
    this.settleMs = options.settleMs ?? 250;
    this.maxPages = Math.min(6, Math.max(1, options.maxPages ?? 6));
    this.launch = options.launch ?? puppeteer.launch;
  }

  async render(session: string, angles: StageCameraAngle[] = [DEFAULT_ANGLE], options: StageCaptureOptions = {}): Promise<Buffer[]> {
    if (!session.trim()) throw new Error("session is required");
    if (!angles.length) throw new Error("at least one camera angle is required");
    for (const value of [options.width, options.height]) if (value !== undefined && (!Number.isInteger(value) || value < 256 || value > 1600)) throw new Error("capture dimensions must be integers from 256 to 1600");
    if (options.opIndex !== undefined && (!Number.isInteger(options.opIndex) || options.opIndex < 0)) throw new Error("opIndex must be a non-negative integer");
    const entry = await this.acquire(session);
    try {
      const images: Buffer[] = [];
      await entry.page.setViewport({ width: options.width ?? 800, height: options.height ?? 600, deviceScaleFactor: 1 });
      for (const angle of angles) images.push(await this.capture(entry.page, session, angle, options.opIndex));
      return images;
    } finally {
      entry.busy = false;
      entry.lastUsed = Date.now();
      entry.idleTimer = setTimeout(() => void this.closeIdle(session, entry), this.idleTimeoutMs);
      entry.idleTimer.unref?.();
    }
  }

  async cleanupIdle(now = Date.now()): Promise<void> {
    await Promise.all([...this.sessions].map(async ([session, entry]) => {
      if (!entry.busy && now - entry.lastUsed >= this.idleTimeoutMs) await this.closeIdle(session, entry);
    }));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    for (const entry of entries) clearTimeout(entry.idleTimer);
    await Promise.all(entries.map(({ page }) => page.close().catch(() => {})));
    if (this.browser) await (await this.browser).close();
  }

  private async acquire(session: string): Promise<SessionPage> {
    const previous = this.acquireTail;
    let release!: () => void;
    this.acquireTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (this.closed) throw new Error("stage renderer is closed");
      const existing = this.sessions.get(session);
      if (existing) {
        if (existing.busy) throw new Error(`stage render already running for session ${session}`);
        clearTimeout(existing.idleTimer);
        existing.busy = true;
        return existing;
      }

      if (this.sessions.size >= this.maxPages) {
        const idle = [...this.sessions.entries()]
          .filter(([, entry]) => !entry.busy)
          .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
        if (!idle) throw new Error(`stage renderer is at its ${this.maxPages}-page limit`);
        await this.closeIdle(idle[0], idle[1]);
      }

      this.browser ??= this.launch({ headless: true });
      const page = await (await this.browser).newPage();
      const entry: SessionPage = { page, busy: true, lastUsed: Date.now() };
      this.sessions.set(session, entry);
      return entry;
    } finally {
      release();
    }
  }

  private async capture(page: Page, session: string, angle: StageCameraAngle, opIndex?: number): Promise<Buffer> {
    const url = new URL(this.viewerUrl);
    url.searchParams.set("session", session);
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    const viewport = await page.waitForSelector("#stage-viewport", { visible: true });
    if (!viewport) throw new Error("stage viewport did not load");
    await page.waitForFunction(
      (id) => (globalThis as { __buildkitStageReady?: { session?: string } }).__buildkitStageReady?.session === id,
      { timeout: 10_000 },
      session,
    );
    if (this.settleMs > 0) await new Promise((resolve) => setTimeout(resolve, this.settleMs));

    const azimuth = Number.isFinite(angle.azimuth) ? angle.azimuth : DEFAULT_ANGLE.azimuth;
    const elevation = Number.isFinite(angle.elevation)
      ? Math.max(-85, Math.min(85, angle.elevation))
      : DEFAULT_ANGLE.elevation;
    await page.evaluate(async (view) => {
      const capture = (globalThis as { __buildkitCapture?: (angle: StageCameraAngle) => Promise<unknown> }).__buildkitCapture;
      if (!capture) throw new Error("stage capture camera is unavailable");
      await capture(view);
    }, { azimuth, elevation, ...(opIndex === undefined ? {} : { opIndex }) });
    return Buffer.from(await viewport.screenshot({ type: "png" }));
  }

  private async closeIdle(session: string, entry: SessionPage): Promise<void> {
    if (entry.busy || this.sessions.get(session) !== entry) return;
    clearTimeout(entry.idleTimer);
    this.sessions.delete(session);
    await entry.page.close().catch(() => {});
  }
}
