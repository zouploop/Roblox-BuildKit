export const CONFORMANCE_FORMAT = "buildkit-conformance-profile" as const;
export const CONFORMANCE_VERSION = 1 as const;

export type CoverageState = "complete" | "truncated" | "missing" | "failed";
export type Vec3 = [number, number, number];

export type SceneDump = {
  parts?: unknown;
  coverage?: CoverageState | { state?: CoverageState };
  truncated?: boolean;
  totalParts?: number;
  bounds?: unknown;
};

export type ProfilePart = {
  id: string;
  className: string;
  material: string;
  position: Vec3 | null;
  size: Vec3 | null;
  surfaceArea: number;
};

export type Bounds = {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  size: Vec3;
};

export type ConformanceProfile = {
  format: typeof CONFORMANCE_FORMAT;
  version: typeof CONFORMANCE_VERSION;
  coverage: CoverageState;
  incomplete: boolean;
  partCount: number;
  capturedPartCount: number;
  bounds: Bounds | null;
  surfaceArea: number;
  materialShares: Record<string, number>;
  classCounts: Record<string, number>;
  parts: ProfilePart[];
};

export type ConformanceTolerance = {
  partCount: number;
  bounds: number;
  materialShare: number;
  classCount: number;
  part: number;
};

export type CompareConformanceOptions = {
  tolerance?: Partial<ConformanceTolerance> | number;
};

export type ConformanceDeviation = {
  metric: "coverage" | "partCount" | "bounds" | "materialShare" | "classCount" | "part" | "partIds";
  key?: string;
  field?: string;
  actual: unknown;
  expected: unknown;
  delta?: number;
  tolerance: number;
};

export type ConformanceReport = {
  clean: boolean;
  incomplete: boolean;
  deviations: ConformanceDeviation[];
  tolerance: ConformanceTolerance;
};

const DEFAULT_TOLERANCE: ConformanceTolerance = {
  partCount: 0,
  bounds: 0.01,
  materialShare: 0.01,
  classCount: 0,
  part: 0.01,
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} must be a non-negative integer`);
  return number;
}

function vec3(value: unknown, label: string, absolute = false): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must be [x,y,z]`);
  const result = value.map((entry, index) => finiteNumber(entry, `${label}[${index}]`)) as Vec3;
  return absolute ? result.map(Math.abs) as Vec3 : result;
}

function optionalVec3(value: unknown, label: string, absolute = false): Vec3 | null {
  return value === undefined || value === null ? null : vec3(value, label, absolute);
}

function identityOf(part: Record<string, unknown>, index: number): string {
  for (const key of ["stableId", "id", "uid", "fullPath", "path", "relativePath"]) {
    const value = part[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  throw new Error(`scene dump part ${index + 1} must include a stable id or path`);
}

function coverageOf(dump: Record<string, unknown>, parts: unknown[], hasParts: boolean): CoverageState {
  const raw = dump.coverage;
  const stated = typeof raw === "string" ? raw : recordOrNull(raw)?.state;
  if (raw !== undefined) {
    if (stated === "complete" || stated === "truncated" || stated === "missing" || stated === "failed") {
      if (stated === "complete" && (!hasParts || dump.truncated === true || (typeof dump.totalParts === "number" && dump.totalParts > parts.length))) return !hasParts ? "missing" : "failed";
      return stated;
    }
    return "failed";
  }
  if (!hasParts) return "missing";
  if (dump.truncated === true) return "truncated";
  if (dump.totalParts !== undefined && typeof dump.totalParts === "number" && dump.totalParts > parts.length) return "truncated";
  return "complete";
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundsFromValue(value: unknown): Bounds | null {
  if (value === undefined || value === null) return null;
  const raw = record(value, "bounds");
  if (raw.min !== undefined || raw.max !== undefined) {
    const min = vec3(raw.min, "bounds.min");
    const max = vec3(raw.max, "bounds.max");
    if (min.some((entry, index) => entry > max[index])) throw new Error("bounds.min must not exceed bounds.max");
    return makeBounds(min, max);
  }
  const center = vec3(raw.center, "bounds.center");
  const size = vec3(raw.size, "bounds.size", true);
  return makeBounds(center.map((entry, index) => entry - size[index] / 2) as Vec3, center.map((entry, index) => entry + size[index] / 2) as Vec3);
}

function makeBounds(min: Vec3, max: Vec3): Bounds {
  const center = min.map((entry, index) => (entry + max[index]) / 2) as Vec3;
  const size = min.map((entry, index) => max[index] - entry) as Vec3;
  return { min, max, center, size };
}

function boundsFromParts(parts: ProfilePart[]): Bounds | null {
  let min: Vec3 | null = null;
  let max: Vec3 | null = null;
  for (const part of parts) {
    if (!part.position || !part.size) continue;
    const lo = part.position.map((entry, index) => entry - part.size![index] / 2) as Vec3;
    const hi = part.position.map((entry, index) => entry + part.size![index] / 2) as Vec3;
    min = min ? min.map((entry, index) => Math.min(entry, lo[index])) as Vec3 : lo;
    max = max ? max.map((entry, index) => Math.max(entry, hi[index])) as Vec3 : hi;
  }
  return min && max ? makeBounds(min, max) : null;
}

function surfaceArea(size: Vec3 | null): number {
  if (!size) return 0;
  return 2 * (size[0] * size[1] + size[0] * size[2] + size[1] * size[2]);
}

function increment(counts: Record<string, number>, key: string, amount = 1): void {
  counts[key] = (counts[key] ?? 0) + amount;
}

function materialShares(parts: ProfilePart[], totalArea: number): Record<string, number> {
  const areas: Record<string, number> = {};
  for (const part of parts) increment(areas, part.material, part.surfaceArea);
  if (totalArea === 0) return Object.fromEntries(Object.keys(areas).sort().map((key) => [key, 0]));
  return Object.fromEntries(Object.keys(areas).sort().map((key) => [key, areas[key] / totalArea]));
}

function profilePart(value: unknown, index: number): ProfilePart {
  const raw = record(value, `profile.parts[${index}]`);
  const id = raw.id;
  if (typeof id !== "string" || id.trim() === "") throw new Error(`profile.parts[${index}].id must be a non-empty string`);
  const className = raw.className;
  const material = raw.material;
  if (typeof className !== "string" || className === "") throw new Error(`profile.parts[${index}].className must be a non-empty string`);
  if (typeof material !== "string" || material === "") throw new Error(`profile.parts[${index}].material must be a non-empty string`);
  const position = optionalVec3(raw.position, `profile.parts[${index}].position`);
  const size = optionalVec3(raw.size, `profile.parts[${index}].size`, true);
  const area = finiteNumber(raw.surfaceArea, `profile.parts[${index}].surfaceArea`);
  if (area < 0) throw new Error(`profile.parts[${index}].surfaceArea must not be negative`);
  return { id: id.trim(), className, material, position, size, surfaceArea: area };
}

function isProfile(value: unknown): value is ConformanceProfile {
  const raw = recordOrNull(value);
  return raw?.format === CONFORMANCE_FORMAT && raw.version === CONFORMANCE_VERSION;
}

export function createConformanceProfile(sceneDump: SceneDump): ConformanceProfile {
  const dump = record(sceneDump, "scene dump");
  const rawParts = dump.parts;
  const hasParts = rawParts !== undefined;
  const parts = rawParts === undefined ? [] : rawParts;
  if (!Array.isArray(parts)) throw new Error("scene dump parts must be an array");
  const coverage = coverageOf(dump, parts, hasParts);
  const seen = new Set<string>();
  const profileParts: ProfilePart[] = [];
  const classCounts: Record<string, number> = {};
  let totalArea = 0;

  parts.forEach((value, index) => {
    const raw = record(value, `scene dump part ${index + 1}`);
    const id = identityOf(raw, index);
    if (seen.has(id)) throw new Error(`scene dump contains duplicate stable id '${id}'`);
    seen.add(id);
    const className = typeof raw.class === "string" && raw.class ? raw.class : typeof raw.className === "string" && raw.className ? raw.className : "Unknown";
    const material = typeof raw.material === "string" && raw.material ? raw.material : "Unknown";
    const position = optionalVec3(raw.pos, `scene dump part ${index + 1}.pos`);
    const size = optionalVec3(raw.size, `scene dump part ${index + 1}.size`, true);
    const area = surfaceArea(size);
    profileParts.push({ id, className, material, position, size, surfaceArea: area });
    increment(classCounts, className);
    totalArea += area;
  });

  profileParts.sort((a, b) => a.id.localeCompare(b.id));
  const statedTotal = typeof dump.totalParts === "number" && Number.isInteger(dump.totalParts) && dump.totalParts >= 0
    ? dump.totalParts
    : profileParts.length;
  const partCount = Math.max(statedTotal, profileParts.length);
  return {
    format: CONFORMANCE_FORMAT,
    version: CONFORMANCE_VERSION,
    coverage,
    incomplete: coverage !== "complete",
    partCount,
    capturedPartCount: profileParts.length,
    bounds: boundsFromValue(dump.bounds) ?? boundsFromParts(profileParts),
    surfaceArea: totalArea,
    materialShares: materialShares(profileParts, totalArea),
    classCounts: Object.fromEntries(Object.keys(classCounts).sort().map((key) => [key, classCounts[key]])),
    parts: profileParts,
  };
}

export function validateConformanceProfile(value: unknown): ConformanceProfile {
  const raw = record(value, "conformance profile");
  if (raw.format !== CONFORMANCE_FORMAT) throw new Error(`conformance profile format must be '${CONFORMANCE_FORMAT}'`);
  if (raw.version !== CONFORMANCE_VERSION) throw new Error(`unsupported conformance profile version: ${String(raw.version)}`);
  const coverage = raw.coverage;
  if (coverage !== "complete" && coverage !== "truncated" && coverage !== "missing" && coverage !== "failed") {
    throw new Error("conformance profile coverage is invalid");
  }
  if (raw.incomplete !== (coverage !== "complete")) throw new Error("conformance profile incomplete flag disagrees with coverage");
  const partsRaw = raw.parts;
  if (!Array.isArray(partsRaw)) throw new Error("conformance profile parts must be an array");
  const parts = partsRaw.map(profilePart);
  const ids = new Set<string>();
  for (const part of parts) {
    if (ids.has(part.id)) throw new Error(`conformance profile contains duplicate stable id '${part.id}'`);
    ids.add(part.id);
  }
  const materialSharesRaw = record(raw.materialShares, "conformance profile materialShares");
  const materialShares: Record<string, number> = {};
  for (const [key, value] of Object.entries(materialSharesRaw)) {
    const share = finiteNumber(value, `materialShares.${key}`);
    if (share < 0 || share > 1) throw new Error(`materialShares.${key} must be between 0 and 1`);
    materialShares[key] = share;
  }
  const classCountsRaw = record(raw.classCounts, "conformance profile classCounts");
  const classCounts: Record<string, number> = {};
  for (const [key, value] of Object.entries(classCountsRaw)) classCounts[key] = nonNegativeInteger(value, `classCounts.${key}`);
  if (!("bounds" in raw)) throw new Error("conformance profile bounds is required");
  const bounds = raw.bounds === null ? null : boundsFromValue(raw.bounds);
  const partCount = nonNegativeInteger(raw.partCount, "conformance profile partCount");
  const capturedPartCount = nonNegativeInteger(raw.capturedPartCount, "conformance profile capturedPartCount");
  if (capturedPartCount < parts.length || partCount < capturedPartCount) throw new Error("conformance profile part counts are inconsistent");
  const totalSurfaceArea = finiteNumber(raw.surfaceArea, "conformance profile surfaceArea");
  if (totalSurfaceArea < 0) throw new Error("conformance profile surfaceArea must not be negative");
  return {
    format: CONFORMANCE_FORMAT,
    version: CONFORMANCE_VERSION,
    coverage,
    incomplete: coverage !== "complete",
    partCount,
    capturedPartCount,
    bounds,
    surfaceArea: totalSurfaceArea,
    materialShares,
    classCounts,
    parts: parts.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function serializeConformanceProfile(profile: ConformanceProfile): string {
  return `${JSON.stringify(validateConformanceProfile(profile), null, 2)}\n`;
}

function toleranceOf(options?: CompareConformanceOptions): ConformanceTolerance {
  if (typeof options?.tolerance === "number") {
    if (!Number.isFinite(options.tolerance) || options.tolerance < 0) throw new Error("conformance tolerance must be non-negative");
    return { partCount: options.tolerance, bounds: options.tolerance, materialShare: options.tolerance, classCount: options.tolerance, part: options.tolerance };
  }
  const supplied = options?.tolerance ?? {};
  const result = { ...DEFAULT_TOLERANCE };
  for (const key of Object.keys(result) as (keyof ConformanceTolerance)[]) {
    const value = supplied[key];
    if (value !== undefined) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`conformance tolerance ${key} must be non-negative`);
      result[key] = value;
    }
  }
  return result;
}

function maximumDelta(actual: Vec3 | null, expected: Vec3 | null): number | null {
  if (!actual || !expected) return null;
  return Math.max(...actual.map((value, index) => Math.abs(value - expected[index])));
}

function addNumericDeviation(
  deviations: ConformanceDeviation[],
  metric: ConformanceDeviation["metric"],
  actual: number,
  expected: number,
  tolerance: number,
  key?: string,
  field?: string,
): void {
  const delta = Math.abs(actual - expected);
  if (delta > tolerance) deviations.push({ metric, key, field, actual, expected, delta, tolerance });
}

function compareBounds(actual: Bounds | null, expected: Bounds | null, tolerance: number, deviations: ConformanceDeviation[]): void {
  if (!actual || !expected) {
    if (actual !== expected) deviations.push({ metric: "bounds", actual, expected, tolerance });
    return;
  }
  const delta = Math.max(maximumDelta(actual.min, expected.min)!, maximumDelta(actual.max, expected.max)!);
  if (delta > tolerance) deviations.push({ metric: "bounds", actual, expected, delta, tolerance });
}

function compareRecord(
  actual: Record<string, number>,
  expected: Record<string, number>,
  metric: "materialShare" | "classCount",
  tolerance: number,
  deviations: ConformanceDeviation[],
): void {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const key of [...keys].sort()) addNumericDeviation(deviations, metric, actual[key] ?? 0, expected[key] ?? 0, tolerance, key);
}

function compareParts(actual: ProfilePart[], expected: ProfilePart[], tolerance: number, deviations: ConformanceDeviation[]): void {
  const actualById = new Map(actual.map((part) => [part.id, part]));
  const expectedById = new Map(expected.map((part) => [part.id, part]));
  const ids = new Set([...actualById.keys(), ...expectedById.keys()]);
  for (const id of [...ids].sort()) {
    const current = actualById.get(id);
    const reference = expectedById.get(id);
    if (!current || !reference) {
      deviations.push({ metric: "partIds", key: id, actual: current ? "present" : "missing", expected: reference ? "present" : "missing", tolerance: 0 });
      continue;
    }
    if (current.className !== reference.className) deviations.push({ metric: "part", key: id, field: "className", actual: current.className, expected: reference.className, tolerance: 0 });
    if (current.material !== reference.material) deviations.push({ metric: "part", key: id, field: "material", actual: current.material, expected: reference.material, tolerance: 0 });
    const positionDelta = maximumDelta(current.position, reference.position);
    if (positionDelta === null ? current.position !== reference.position : positionDelta > tolerance) {
      deviations.push({ metric: "part", key: id, field: "position", actual: current.position, expected: reference.position, delta: positionDelta ?? undefined, tolerance });
    }
    const sizeDelta = maximumDelta(current.size, reference.size);
    if (sizeDelta === null ? current.size !== reference.size : sizeDelta > tolerance) {
      deviations.push({ metric: "part", key: id, field: "size", actual: current.size, expected: reference.size, delta: sizeDelta ?? undefined, tolerance });
    }
  }
}

export function compareConformance(
  actual: SceneDump | ConformanceProfile,
  expected: ConformanceProfile,
  options?: CompareConformanceOptions,
): ConformanceReport {
  const current = isProfile(actual) ? validateConformanceProfile(actual) : createConformanceProfile(actual);
  const reference = validateConformanceProfile(expected);
  const tolerance = toleranceOf(options);
  const deviations: ConformanceDeviation[] = [];

  if (current.coverage !== reference.coverage) deviations.push({ metric: "coverage", actual: current.coverage, expected: reference.coverage, tolerance: 0 });
  addNumericDeviation(deviations, "partCount", current.partCount, reference.partCount, tolerance.partCount);
  compareBounds(current.bounds, reference.bounds, tolerance.bounds, deviations);
  compareRecord(current.materialShares, reference.materialShares, "materialShare", tolerance.materialShare, deviations);
  compareRecord(current.classCounts, reference.classCounts, "classCount", tolerance.classCount, deviations);
  compareParts(current.parts, reference.parts, tolerance.part, deviations);

  const incomplete = current.incomplete || reference.incomplete;
  return { clean: !incomplete && deviations.length === 0, incomplete, deviations, tolerance };
}
