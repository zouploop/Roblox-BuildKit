import puppeteer, { type Browser, type Page } from "puppeteer";

export type StageCameraAngle = {
  azimuth: number;
  elevation: number;
};

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

  async render(session: string, angles: StageCameraAngle[] = [DEFAULT_ANGLE]): Promise<Buffer[]> {
    if (!session.trim()) throw new Error("session is required");
    if (!angles.length) throw new Error("at least one camera angle is required");
    const entry = await this.acquire(session);
    try {
      const images: Buffer[] = [];
      for (const angle of angles) images.push(await this.capture(entry.page, session, angle));
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

  private async capture(page: Page, session: string, angle: StageCameraAngle): Promise<Buffer> {
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

    // Frame the complete build, then remove editor chrome and selection helpers so
    // headless QA captures geometry instead of a close-up of the default origin.
    if (page.keyboard && page.click && page.evaluate) {
      await page.keyboard.down("Control");
      await page.keyboard.press("a");
      await page.keyboard.up("Control");
      await page.click("#frame");
      await page.evaluate(() => {
        for (const selector of ["#toolbar", "#dock-slots", "#explorer", "#properties", "#generations", "#history"]) {
          const element = document.querySelector<HTMLElement>(selector);
          if (element) element.style.display = "none";
        }
        window.dispatchEvent(new Event("resize"));
      });
      if (this.settleMs > 0) await new Promise((resolve) => setTimeout(resolve, this.settleMs));
    }

    const box = await viewport.boundingBox();
    if (!box) throw new Error("stage viewport has no visible bounds");
    if (page.mouse.click) await page.mouse.click(box.x + box.width / 2, box.y + 8);
    const azimuth = Number.isFinite(angle.azimuth) ? angle.azimuth : DEFAULT_ANGLE.azimuth;
    const elevation = Number.isFinite(angle.elevation)
      ? Math.max(-85, Math.min(85, angle.elevation))
      : DEFAULT_ANGLE.elevation;
    const dx = ((azimuth - DEFAULT_ANGLE.azimuth) / 360) * box.height;
    const dy = ((DEFAULT_ANGLE.elevation - elevation) / 360) * box.height;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (dx || dy) {
      await page.mouse.move(x, y);
      await page.mouse.down({ button: "right" });
      await page.mouse.move(x + dx, y + dy, { steps: 8 });
      await page.mouse.up({ button: "right" });
      if (this.settleMs > 0) await new Promise((resolve) => setTimeout(resolve, this.settleMs));
    }
    return Buffer.from(await viewport.screenshot({ type: "png" }));
  }

  private async closeIdle(session: string, entry: SessionPage): Promise<void> {
    if (entry.busy || this.sessions.get(session) !== entry) return;
    clearTimeout(entry.idleTimer);
    this.sessions.delete(session);
    await entry.page.close().catch(() => {});
  }
}
