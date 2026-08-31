export type MirrorTransform = {
  target: string;
  position: number[];
  rotation: number[]; // same units as the dump being overlaid
  size: number[];
};

type MirrorPart = Record<string, unknown>;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function vectorMatches(actual: unknown, expected: number[], tolerance: number): boolean {
  return Array.isArray(actual) && actual.length === 3 && actual.every((value, index) =>
    typeof value === "number" && Number.isFinite(value) && Math.abs(value - expected[index]) <= tolerance
  );
}

function partTarget(part: MirrorPart): string | null {
  const target = part.fullPath ?? part.path;
  return typeof target === "string" && target ? target : null;
}

export function mirrorTransformMatches(part: MirrorPart, transform: MirrorTransform, tolerance = 0.001): boolean {
  return vectorMatches(part.pos, transform.position, tolerance) &&
    vectorMatches(part.rot, transform.rotation, tolerance) &&
    vectorMatches(part.size, transform.size, tolerance);
}

export function overlayMirrorTransforms(
  raw: unknown,
  transforms: readonly MirrorTransform[],
  acknowledge = false,
): { dump: Record<string, unknown> | null; acknowledged: string[]; missing: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { dump: null, acknowledged: [], missing: transforms.map((transform) => transform.target) };
  }
  const dump = cloneJson(raw) as Record<string, unknown>;
  if (!Array.isArray(dump.parts)) {
    return { dump, acknowledged: [], missing: transforms.map((transform) => transform.target) };
  }
  const parts = dump.parts as MirrorPart[];
  const acknowledged: string[] = [];
  const missing: string[] = [];
  for (const transform of transforms) {
    const part = parts.find((candidate) => partTarget(candidate) === transform.target);
    if (!part) {
      missing.push(transform.target);
      continue;
    }
    if (acknowledge && mirrorTransformMatches(part, transform)) {
      acknowledged.push(transform.target);
      continue;
    }
    part.pos = [...transform.position];
    part.rot = [...transform.rotation];
    part.size = [...transform.size];
  }
  return { dump, acknowledged, missing };
}
