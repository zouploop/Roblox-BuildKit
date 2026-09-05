import { MAX_SYNC_PARTS, normalizeSyncScope, type SyncScope } from "./sync-scope.js";

export type MirrorOptions = {
  ok: true;
  maxParts: number;
  minParts: 1;
  maxPartsLimit: number;
  enabled: boolean;
  intervalMs: number;
  scope: SyncScope;
};

type MirrorBridge = { sendCommand(action: string, args: unknown, timeoutMs: number): Promise<any> };

export function parseMirrorMaxParts(value: unknown) {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_SYNC_PARTS) {
    throw new Error(`maxParts must be an integer from 1 to ${MAX_SYNC_PARTS}`);
  }
  return value as number;
}

export function mirrorOptions(status: any): MirrorOptions {
  if (!status || typeof status !== "object" || !Number.isInteger(status.maxParts) || status.maxParts < 1 || status.maxParts > MAX_SYNC_PARTS || typeof status.enabled !== "boolean" || !Number.isInteger(status.intervalMs)) {
    throw new Error("connected Studio plugin is stale; restart Studio with the updated BuildKit plugin and retry");
  }
  const scope = normalizeSyncScope({ target: status.target, region: status.region, lod: status.lod, maxParts: status.maxParts });
  return { ok: true, maxParts: status.maxParts, minParts: 1, maxPartsLimit: MAX_SYNC_PARTS, enabled: status.enabled, intervalMs: status.intervalMs, scope };
}

export async function getMirrorOptions(bridge: MirrorBridge) {
  return mirrorOptions(await bridge.sendCommand("live_sync", { readOnly: true }, 30_000));
}

export async function configureMirrorMaxParts(
  bridge: MirrorBridge,
  maxParts: number,
  writeMirror: (dump: unknown, notify: boolean) => Promise<unknown>,
) {
  const status = await bridge.sendCommand("live_sync", { maxParts }, 30_000);
  if (!status || status.maxParts !== maxParts) {
    const actual = Number.isInteger(status?.maxParts) ? ` (plugin applied ${status.maxParts})` : "";
    throw new Error(`connected Studio plugin is stale; restart Studio with the updated BuildKit plugin and retry${actual}`);
  }
  const options = mirrorOptions(status);
  try {
    const dump = await bridge.sendCommand("scene_dump", options.scope, 30_000);
    await writeMirror(dump, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = new Error(`mirror options applied, but the fresh renderer snapshot failed: ${message}`) as Error & { applied?: MirrorOptions };
    failure.applied = options;
    throw failure;
  }
  return options;
}
