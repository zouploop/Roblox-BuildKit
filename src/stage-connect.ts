import { rotateStageVector, stageWorldPoint } from "../viewer/seam-qa.js";
import type { StageOp } from "./stage-state.js";

export type XYZ = [number, number, number];
export type StagePartRef = string | {
  index?: number;
  opIndex?: number;
  partIndex?: number;
  id?: string;
  name?: string;
};
export type StageConnectionIntent = "seat" | "join" | "align";
export type StageConnectionSocket = {
  point?: XYZ;
  pos?: XYZ;
  rot?: XYZ;
};
export type StageConnectionRequest = {
  intent: StageConnectionIntent;
  source: StagePartRef;
  target: StagePartRef;
  sourcePoint?: XYZ;
  targetPoint?: XYZ;
  sourceSocket?: StageConnectionSocket;
  targetSocket?: StageConnectionSocket;
  tolerance?: number;
  expectedRevision?: number;
};
export type StageConnectionAction = {
  index: number;
  partIndex: number;
  targetId?: string;
  patch: Record<string, unknown>;
};
export type StageConnectionFinding = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  source?: { index: number; partIndex: number };
  target?: { index: number; partIndex: number };
};
export type StageConnectionResidual = {
  position: number;
  orientation: number;
  max: number;
};
export type StageConnectionPlan = {
  kind: "stage-connection-plan";
  version: 1;
  ok: boolean;
  intent: StageConnectionIntent;
  request: StageConnectionRequest;
  revision?: number;
  expectedRevision?: number;
  source: { index: number; partIndex: number; id?: string; name?: string };
  target: { index: number; partIndex: number; id?: string; name?: string };
  baseFingerprint: string;
  resolvedSourcePoint?: XYZ;
  resolvedTargetPoint?: XYZ;
  actions: StageConnectionAction[];
  residual: StageConnectionResidual;
  findings: StageConnectionFinding[];
};
export type StageConnectionState = { ops: readonly StageOp[]; revision: number };
export type StageConnectionApplyResult = {
  ok: boolean;
  code?: "REVISION_CONFLICT" | "INVALID_PLAN";
  revision: number;
  expectedRevision: number;
  changed: boolean;
  ops?: StageOp[];
  residual: StageConnectionResidual;
  findings: StageConnectionFinding[];
};

type Part = Record<string, unknown>;
type Geometry = {
  index: number;
  partIndex: number;
  args: Record<string, unknown>;
  raw: Part;
  center: XYZ;
  pos: XYZ;
  size: XYZ;
  rot: XYZ;
};
type Frame = [XYZ, XYZ, XYZ];

const ZERO: XYZ = [0, 0, 0];
const EPS = 1e-8;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function vector(value: unknown, label: string, positive = false): XYZ {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((part) => typeof part === "number" && Number.isFinite(part))) {
    throw new Error(`${label} must be a finite [x,y,z] vector`);
  }
  const result = value as XYZ;
  if (positive && result.some((part) => part <= 0)) throw new Error(`${label} must be positive`);
  return [...result] as XYZ;
}

function add(a: XYZ, b: XYZ): XYZ { return a.map((value, index) => value + b[index]) as XYZ; }
function sub(a: XYZ, b: XYZ): XYZ { return a.map((value, index) => value - b[index]) as XYZ; }
function mul(a: XYZ, scale: number): XYZ { return a.map((value) => value * scale) as XYZ; }
function dot(a: XYZ, b: XYZ): number { return a.reduce((sum, value, index) => sum + value * b[index], 0); }
function length(a: XYZ): number { return Math.hypot(...a); }
function unit(value: XYZ, label: string): XYZ {
  const size = length(value);
  if (size <= EPS) throw new Error(`${label} must not be zero`);
  return mul(value, 1 / size);
}
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function sameVector(a: XYZ, b: XYZ): boolean { return a.every((value, index) => Math.abs(value - b[index]) <= EPS); }
function angleDegrees(a: XYZ, b: XYZ): number {
  return Math.acos(clamp(dot(unit(a, "orientation"), unit(b, "orientation")), -1, 1)) * 180 / Math.PI;
}

function geometry(ops: readonly StageOp[]): Geometry[] {
  const result: Geometry[] = [];
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];
    if (op.action !== "build" || op.args.kind !== "prop" || !Array.isArray(op.args.parts)) continue;
    const center = vector(op.args.center, `op ${index} center`);
    for (let partIndex = 0; partIndex < op.args.parts.length; partIndex += 1) {
      const raw = op.args.parts[partIndex];
      if (!isRecord(raw)) throw new Error(`op ${index} part ${partIndex} must be an object`);
      const pos = vector(raw.pos ?? ZERO, `op ${index} part ${partIndex} pos`);
      const size = vector(raw.size, `op ${index} part ${partIndex} size`, true);
      const rot = vector(raw.rot ?? ZERO, `op ${index} part ${partIndex} rot`);
      result.push({ index, partIndex, args: op.args, raw, center: add(center, pos), pos, size, rot });
    }
  }
  return result;
}

function resolvePart(parts: Geometry[], value: StagePartRef, label: string): Geometry {
  const ref = typeof value === "string" ? { id: value.trim() } : isRecord(value) ? value : {};
  const id = typeof ref.id === "string" && ref.id.trim() ? ref.id.trim() : undefined;
  const name = typeof ref.name === "string" && ref.name.trim() ? ref.name.trim() : undefined;
  if (isRecord(value) && (value.id !== undefined && id === undefined || value.name !== undefined && name === undefined)) {
    throw new Error(`${label} id/name must be non-empty strings`);
  }

  const suppliedIndices = [value && typeof value === "object" && !Array.isArray(value) ? value.index : undefined,
    value && typeof value === "object" && !Array.isArray(value) ? value.opIndex : undefined].filter((index) => index !== undefined);
  if (suppliedIndices.length > 1 && suppliedIndices[0] !== suppliedIndices[1]) throw new Error(`${label} index and opIndex conflict`);
  const index = suppliedIndices[0];
  const partIndex = value && typeof value === "object" && !Array.isArray(value) ? value.partIndex : undefined;
  let found: Geometry | undefined;
  if (index !== undefined || partIndex !== undefined) {
    if (!Number.isInteger(index) || (index as number) < 0 || !Number.isInteger(partIndex) || (partIndex as number) < 0) {
      throw new Error(`${label} reference must contain non-negative integer index/opIndex and partIndex`);
    }
    found = parts.find((part) => part.index === index && part.partIndex === partIndex);
    if (!found) throw new Error(`${label} part is out of range or not a prop part`);
  } else if (id !== undefined) {
    const byId = parts.filter((part) => part.raw.id === id);
    if (byId.length > 1) throw new Error(`${label} id '${id}' is ambiguous`);
    found = byId[0];
    if (!found && name === undefined) throw new Error(`${label} id '${id}' is missing`);
  }
  if (!found && name !== undefined) {
    const byName = parts.filter((part) => part.raw.name === name);
    if (byName.length > 1) throw new Error(`${label} name '${name}' is ambiguous`);
    found = byName[0];
  }
  if (!found) throw new Error(`${label} reference must be a part id, name, or {index,partIndex}`);
  if (id !== undefined && found.raw.id !== id) throw new Error(`${label} id '${id}' conflicts with the selected part`);
  if (name !== undefined && found.raw.name !== name) throw new Error(`${label} name '${name}' conflicts with the selected part`);
  return found;
}

function frameFromEuler(rot: XYZ): Frame {
  return [
    rotateStageVector([1, 0, 0], rot) as XYZ,
    rotateStageVector([0, 1, 0], rot) as XYZ,
    rotateStageVector([0, 0, 1], rot) as XYZ,
  ];
}

function multiplyFrame(a: Frame, b: Frame): Frame {
  return b.map((column) => add(add(mul(a[0], column[0]), mul(a[1], column[1])), mul(a[2], column[2]))) as Frame;
}

function inverseFrame(frame: Frame): Frame {
  return [
    [frame[0][0], frame[1][0], frame[2][0]],
    [frame[0][1], frame[1][1], frame[2][1]],
    [frame[0][2], frame[1][2], frame[2][2]],
  ];
}

function eulerFromFrame(frame: Frame): XYZ {
  const m = [
    [frame[0][0], frame[1][0], frame[2][0]],
    [frame[0][1], frame[1][1], frame[2][1]],
    [frame[0][2], frame[1][2], frame[2][2]],
  ];
  const y = Math.asin(clamp(m[0][2], -1, 1));
  const cy = Math.cos(y);
  let x: number;
  let z: number;
  if (Math.abs(cy) > 1e-7) {
    x = Math.atan2(-m[1][2], m[2][2]);
    z = Math.atan2(-m[0][1], m[0][0]);
  } else {
    z = 0;
    x = y > 0 ? Math.atan2(m[1][0], m[1][1]) : -Math.atan2(m[1][0], m[1][1]);
  }
  const degrees = 180 / Math.PI;
  return [x * degrees, y * degrees, z * degrees];
}

function socketPoint(socket: StageConnectionSocket | undefined, explicit: XYZ | undefined): XYZ | undefined {
  if (explicit !== undefined) return vector(explicit, "connection endpoint");
  const value = socket?.point ?? socket?.pos;
  return value === undefined ? undefined : vector(value, "connection socket point");
}

function supportPoint(part: Geometry, direction: XYZ): XYZ {
  const axes = frameFromEuler(part.rot);
  const local = axes.map((axis) => dot(direction, axis));
  if (String(part.raw.shape ?? "box").toLowerCase() === "cylinder") {
    return [local[0] === 0 ? 0 : Math.sign(local[0]) * part.size[0] / 2, 0, 0];
  }
  return local.map((value, index) => value === 0 ? 0 : Math.sign(value) * part.size[index] / 2) as XYZ;
}

function socketFrame(part: Geometry, socket: StageConnectionSocket | undefined): Frame {
  return multiplyFrame(frameFromEuler(part.rot), frameFromEuler(vector(socket?.rot ?? ZERO, "connection socket rotation")));
}

function measureConnectionResidual(source: Geometry, target: Geometry, request: StageConnectionRequest, sourcePoint: XYZ, targetPoint: XYZ): StageConnectionResidual {
  const a = stageWorldPoint(source.center, source.rot, sourcePoint) as XYZ;
  const b = stageWorldPoint(target.center, target.rot, targetPoint) as XYZ;
  const position = length(sub(b, a));
  let orientation = 0;
  if (request.intent === "align") {
    const sourceSocketFrame = multiplyFrame(frameFromEuler(source.rot), frameFromEuler(vector(request.sourceSocket?.rot ?? ZERO, "connection socket rotation")));
    const targetSocketFrame = socketFrame(target, request.targetSocket);
    orientation = angleDegrees(sourceSocketFrame[0], mul(targetSocketFrame[0], -1));
  }
  return { position, orientation, max: Math.max(position, orientation) };
}

function fingerprint(source: Geometry, target: Geometry): string {
  return JSON.stringify([source.index, source.partIndex, source.raw, source.center, target.index, target.partIndex, target.raw, target.center]);
}

function parseRequest(request: StageConnectionRequest): StageConnectionRequest {
  if (!isRecord(request) || !["seat", "join", "align"].includes(request.intent)) throw new Error("connection intent must be 'seat', 'join', or 'align'");
  if ("sourceNormal" in request || "targetNormal" in request || isRecord(request.sourceSocket) && "normal" in request.sourceSocket || isRecord(request.targetSocket) && "normal" in request.targetSocket) {
    throw new Error("normal fields are not part of the connection contract; use socket rot");
  }
  if (request.tolerance !== undefined && (!Number.isFinite(request.tolerance) || request.tolerance < 0)) throw new Error("connection tolerance must be non-negative");
  if (request.expectedRevision !== undefined && (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 0)) throw new Error("expectedRevision must be a non-negative integer");
  return structuredClone(request);
}

function isConnectionState(input: StageConnectionState | readonly StageOp[]): input is StageConnectionState {
  return isRecord(input) && Array.isArray(input.ops) && Number.isInteger(input.revision);
}

export function previewStageConnection(input: StageConnectionState | readonly StageOp[], request: StageConnectionRequest, revision?: number): StageConnectionPlan {
  const snapshot = isConnectionState(input);
  const ops = snapshot ? input.ops : input;
  const baseRevision = snapshot ? input.revision : revision;
  const parsed = parseRequest(request);
  const parts = geometry(ops);
  const source = resolvePart(parts, parsed.source, "source");
  const target = resolvePart(parts, parsed.target, "target");
  if (source.index === target.index && source.partIndex === target.partIndex) throw new Error("connection source and target must differ");
  const sourceRef = { index: source.index, partIndex: source.partIndex, ...(typeof source.raw.id === "string" ? { id: source.raw.id } : {}), ...(typeof source.raw.name === "string" ? { name: source.raw.name } : {}) };
  const targetRef = { index: target.index, partIndex: target.partIndex, ...(typeof target.raw.id === "string" ? { id: target.raw.id } : {}), ...(typeof target.raw.name === "string" ? { name: target.raw.name } : {}) };
  const base = {
    kind: "stage-connection-plan" as const,
    version: 1 as const,
    ok: true,
    intent: parsed.intent,
    request: parsed,
    ...(baseRevision === undefined ? {} : { revision: baseRevision }),
    ...(parsed.expectedRevision === undefined ? {} : { expectedRevision: parsed.expectedRevision }),
    source: sourceRef,
    target: targetRef,
    baseFingerprint: fingerprint(source, target),
    actions: [] as StageConnectionAction[],
    residual: { position: 0, orientation: 0, max: 0 } as StageConnectionResidual,
    findings: [] as StageConnectionFinding[],
  };
  if (baseRevision !== undefined && parsed.expectedRevision !== undefined && parsed.expectedRevision !== baseRevision) {
    return { ...base, ok: false, findings: [{ code: "REVISION_CONFLICT", severity: "error", message: "expectedRevision does not match the preview snapshot revision", source: sourceRef, target: targetRef }] };
  }
  if (source.raw.locked === true || source.args.locked === true) {
    return { ...base, ok: false, findings: [{ code: "SOURCE_LOCKED", severity: "error", message: "connection source is locked", source: sourceRef, target: targetRef }] };
  }
  let sourcePoint = socketPoint(parsed.sourceSocket, parsed.sourcePoint);
  let targetPoint = socketPoint(parsed.targetSocket, parsed.targetPoint);
  if (parsed.intent === "seat") {
    sourcePoint ??= [0, -source.size[1] / 2, 0];
    targetPoint ??= [0, target.size[1] / 2, 0];
  } else {
    const direction = unit(sub(target.center, source.center), "connection direction");
    sourcePoint ??= supportPoint(source, direction);
    targetPoint ??= supportPoint(target, mul(direction, -1));
  }
  let sourceRot = source.rot;
  if (parsed.intent === "align") {
    const targetSocket = socketFrame(target, parsed.targetSocket);
    const desiredSourceSocket: Frame = [mul(targetSocket[0], -1), targetSocket[1], mul(targetSocket[2], -1)];
    sourceRot = eulerFromFrame(multiplyFrame(desiredSourceSocket, inverseFrame(frameFromEuler(vector(parsed.sourceSocket?.rot ?? ZERO, "connection socket rotation")))));
  }
  const targetWorld = stageWorldPoint(target.center, target.rot, targetPoint) as XYZ;
  const sourceWorldBeforeTranslation = stageWorldPoint(source.center, sourceRot, sourcePoint) as XYZ;
  const delta = sub(targetWorld, sourceWorldBeforeTranslation);
  const sourcePos = add(source.pos, delta);
  const patch: Part = { ...source.raw, pos: sourcePos, ...(parsed.intent === "align" ? { rot: sourceRot } : {}) };
  const changed = !sameVector(sourcePos, source.pos) || (parsed.intent === "align" && !sameVector(sourceRot, source.rot));
  const transformedSource = { ...source, rot: sourceRot, pos: sourcePos, center: add(source.center, delta) };
  const residual = measureConnectionResidual(transformedSource, target, parsed, sourcePoint, targetPoint);
  const tolerance = parsed.tolerance ?? 1e-4;
  const findings: StageConnectionFinding[] = [];
  if (residual.max > tolerance) findings.push({ code: "RESIDUAL", severity: "error", message: `connection residual ${residual.max.toFixed(6)} exceeds tolerance ${tolerance}`, source: sourceRef, target: targetRef });
  return {
    ...base,
    ok: residual.max <= tolerance,
    resolvedSourcePoint: sourcePoint,
    resolvedTargetPoint: targetPoint,
    actions: changed ? [{ index: source.index, partIndex: source.partIndex, ...(typeof source.raw.id === "string" ? { targetId: source.raw.id } : {}), patch }] : [],
    residual,
    findings,
  };
}

function invalidResult(revision: number, expectedRevision: number, code: "REVISION_CONFLICT" | "INVALID_PLAN", residual: StageConnectionResidual, findings: StageConnectionFinding[]): StageConnectionApplyResult {
  return { ok: false, code, revision, expectedRevision, changed: false, residual, findings };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
}

function withoutRevision(request: StageConnectionRequest): Record<string, unknown> {
  const copy = structuredClone(request) as Record<string, unknown>;
  delete copy.expectedRevision;
  return copy;
}

function residualOf(plan: unknown): StageConnectionResidual {
  if (isRecord(plan) && isRecord(plan.residual) && [plan.residual.position, plan.residual.orientation, plan.residual.max].every((value) => typeof value === "number" && Number.isFinite(value))) {
    return { position: plan.residual.position as number, orientation: plan.residual.orientation as number, max: plan.residual.max as number };
  }
  return { position: 0, orientation: 0, max: 0 };
}

export function applyStageConnection(state: StageConnectionState, plan: StageConnectionPlan, expectedRevision = plan.expectedRevision): StageConnectionApplyResult {
  const reportedRevision = Number.isInteger(expectedRevision) && (expectedRevision as number) >= 0 ? expectedRevision as number : -1;
  if (reportedRevision < 0) {
    return invalidResult(state.revision, reportedRevision, "INVALID_PLAN", residualOf(plan), [{ code: "EXPECTED_REVISION", severity: "error", message: "apply requires a non-negative expectedRevision" }]);
  }
  if (state.revision !== reportedRevision) {
    return invalidResult(state.revision, reportedRevision, "REVISION_CONFLICT", residualOf(plan), [{ code: "REVISION_CONFLICT", severity: "error", message: "stage revision changed; preview again before applying" }]);
  }
  if (!isRecord(plan) || plan.kind !== "stage-connection-plan" || plan.version !== 1 || plan.ok !== true || !Array.isArray(plan.actions) || !isRecord(plan.request) || !isRecord(plan.source) || !isRecord(plan.target) || typeof plan.baseFingerprint !== "string") {
    return invalidResult(state.revision, reportedRevision, "INVALID_PLAN", residualOf(plan), [{ code: "INVALID_PLAN", severity: "error", message: "connection plan is invalid or was not previewed successfully" }]);
  }
  if (plan.revision !== reportedRevision || plan.expectedRevision !== undefined && plan.expectedRevision !== reportedRevision) {
    return invalidResult(state.revision, reportedRevision, "REVISION_CONFLICT", residualOf(plan), [{ code: "REVISION_CONFLICT", severity: "error", message: "plan revision does not match expectedRevision" }]);
  }

  let canonical: StageConnectionPlan;
  try {
    canonical = previewStageConnection(state, { ...plan.request as StageConnectionRequest, expectedRevision: reportedRevision });
  } catch (error) {
    return invalidResult(state.revision, reportedRevision, "INVALID_PLAN", residualOf(plan), [{ code: "INVALID_PLAN", severity: "error", message: error instanceof Error ? error.message : String(error) }]);
  }
  if (!canonical.ok) {
    return invalidResult(state.revision, reportedRevision, "INVALID_PLAN", canonical.residual, canonical.findings);
  }
  const identity = { intent: canonical.intent, source: canonical.source, target: canonical.target, baseFingerprint: canonical.baseFingerprint };
  const suppliedIdentity = { intent: plan.intent, source: plan.source, target: plan.target, baseFingerprint: plan.baseFingerprint };
  if (!sameValue(identity, suppliedIdentity) || !sameValue(withoutRevision(canonical.request), withoutRevision(plan.request as StageConnectionRequest)) ||
      !sameValue(canonical.actions, plan.actions) || !sameValue(canonical.residual, plan.residual) ||
      !sameValue(canonical.resolvedSourcePoint, plan.resolvedSourcePoint) || !sameValue(canonical.resolvedTargetPoint, plan.resolvedTargetPoint)) {
    return invalidResult(state.revision, reportedRevision, "INVALID_PLAN", canonical.residual, [{ code: "PLAN_TAMPERED", severity: "error", message: "connection plan does not match a fresh canonical preview" }]);
  }

  const next = structuredClone(state.ops) as StageOp[];
  try {
    for (const action of canonical.actions) {
      if (!Number.isInteger(action.index) || action.index < 0 || !Number.isInteger(action.partIndex) || action.partIndex < 0 || !isRecord(action.patch)) throw new Error("connection action is malformed");
      const op = next[action.index];
      if (!op || op.action !== "build" || op.args.kind !== "prop" || !Array.isArray(op.args.parts) || action.partIndex >= op.args.parts.length) throw new Error("connection action target is out of range");
      const current = op.args.parts[action.partIndex];
      if (!isRecord(current) || action.targetId !== undefined && current.id !== action.targetId) throw new Error("connection action target ID is stale");
      op.args.parts[action.partIndex] = structuredClone(action.patch);
    }
  } catch (error) {
    return invalidResult(state.revision, reportedRevision, "INVALID_PLAN", canonical.residual, [{ code: "INVALID_PLAN", severity: "error", message: error instanceof Error ? error.message : String(error) }]);
  }
  let appliedSource: Geometry | undefined;
  let appliedTarget: Geometry | undefined;
  try {
    const applied = geometry(next);
    appliedSource = applied.find((part) => part.index === canonical.source.index && part.partIndex === canonical.source.partIndex);
    appliedTarget = applied.find((part) => part.index === canonical.target.index && part.partIndex === canonical.target.partIndex);
  } catch (error) {
    return invalidResult(state.revision, reportedRevision, "INVALID_PLAN", canonical.residual, [{ code: "INVALID_PLAN", severity: "error", message: error instanceof Error ? error.message : String(error) }]);
  }
  if (!appliedSource || !appliedTarget || !canonical.resolvedSourcePoint || !canonical.resolvedTargetPoint) {
    return invalidResult(state.revision, reportedRevision, "INVALID_PLAN", canonical.residual, [{ code: "INVALID_PLAN", severity: "error", message: "canonical action target disappeared during apply" }]);
  }
  const measured = measureConnectionResidual(appliedSource, appliedTarget, canonical.request, canonical.resolvedSourcePoint, canonical.resolvedTargetPoint);
  const tolerance = canonical.request.tolerance ?? 1e-4;
  if (measured.max > tolerance) {
    return invalidResult(state.revision, reportedRevision, "INVALID_PLAN", measured, [{ code: "RESIDUAL", severity: "error", message: `applied connection residual ${measured.max.toFixed(6)} exceeds tolerance ${tolerance}` }]);
  }
  const changed = canonical.actions.length > 0;
  return { ok: true, revision: state.revision + (changed ? 1 : 0), expectedRevision: reportedRevision, changed, ops: next, residual: measured, findings: canonical.findings };
}
