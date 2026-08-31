export type Vec3 = [number, number, number];
export type SyncRegion =
  | { center: Vec3; radius: number }
  | { min: Vec3; max: Vec3 };
export type SyncScope = {
  target?: string;
  region?: SyncRegion;
  lod: "parts" | "bbox";
  maxParts: number;
};

export const MAX_SYNC_PARTS = 800;

function vec3(value: unknown, label: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    throw new Error(`${label} must be [x,y,z] finite numbers`);
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

export function normalizeSyncScope(input: unknown = {}): SyncScope {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("sync scope must be an object");
  const value = input as Record<string, unknown>;
  const hasTarget = value.target !== undefined;
  const hasRegion = value.region !== undefined;
  if (hasTarget && hasRegion) throw new Error("sync scope accepts target or region, not both");

  let target: string | undefined;
  let region: SyncRegion | undefined;
  if (hasTarget) {
    if (typeof value.target !== "string" || value.target.trim() === "") throw new Error("sync target must be a non-empty string");
    target = value.target;
  } else if (hasRegion) {
    if (!value.region || typeof value.region !== "object" || Array.isArray(value.region)) throw new Error("sync region must be an object");
    const raw = value.region as Record<string, unknown>;
    if (raw.center !== undefined || raw.radius !== undefined) {
      if (raw.center === undefined || typeof raw.radius !== "number" || !Number.isFinite(raw.radius) || raw.radius <= 0) {
        throw new Error("sync region center/radius must contain a positive finite radius");
      }
      region = { center: vec3(raw.center, "region.center"), radius: raw.radius };
    } else if (raw.min !== undefined || raw.max !== undefined) {
      const min = vec3(raw.min, "region.min");
      const max = vec3(raw.max, "region.max");
      if (min.some((n, i) => n > max[i])) throw new Error("sync region min must not exceed max");
      region = { min, max };
    } else {
      throw new Error("sync region must be center/radius or min/max");
    }
  } else {
    target = "workspace";
  }

  const lod = value.lod === undefined ? "parts" : value.lod;
  if (lod !== "parts" && lod !== "bbox") throw new Error("sync lod must be parts or bbox");
  const requested = value.maxParts === undefined ? MAX_SYNC_PARTS : value.maxParts;
  if (typeof requested !== "number" || !Number.isInteger(requested) || requested < 1) throw new Error("sync maxParts must be a positive integer");
  return { ...(target ? { target } : { region }), lod, maxParts: Math.min(requested, MAX_SYNC_PARTS) };
}

export function liveSyncPayload(scope: unknown, intervalMs: number) {
  if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60_000) throw new Error("sync intervalMs must be an integer from 100 to 60000");
  return { enabled: true, intervalMs, ...normalizeSyncScope(scope) };
}

export function requireRegionEcho<T>(region: unknown, result: T): T {
  if (region && (!result || typeof result !== "object" || !("region" in result))) {
    throw new Error("connected Studio plugin is stale: restart Studio before using a region-scoped command");
  }
  return result;
}
