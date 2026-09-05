import { randomUUID } from "node:crypto";
import type { StageOp } from "./stage-state.js";
import { MAX_STAGE_ITEMS, validateStageOps } from "./stage-share.js";
import { scanStageIssues } from "../viewer/seam-qa.js";
import * as seamQa from "../viewer/seam-qa.js";

const rotateStageVector = (seamQa as unknown as { rotateStageVector: (v: number[], rot?: number[]) => number[] }).rotateStageVector;

export type StageAgentPatch = {
  id: string;
  changes?: Record<string, unknown>;
  remove?: boolean;
};

export type StageAgentPatchRequest = {
  expectedRevision: number;
  expectedInstance: string;
  patches: StageAgentPatch[];
};

export type StageAgentCurrent = { revision: number; instance: string };

export type StageAgentPatchResult = {
  ok: true;
  ops: StageOp[];
  changedIds: string[];
  affectedIndices: number[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const finiteVec3 = (value: unknown): number[] | null =>
  Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number" && Number.isFinite(part))
    ? [...value]
    : null;

function assertUniqueRefs(ops: readonly StageOp[]) {
  const refs = new Set<string>();
  const add = (value: unknown, label: string) => {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
    if (refs.has(value)) throw new Error(`duplicate stage ref: ${value}`);
    refs.add(value);
  };
  ops.forEach((op, opIndex) => {
    add(op.args.id, `stage op ${opIndex + 1} id`);
    if (!Array.isArray(op.args.parts)) return;
    op.args.parts.forEach((part, partIndex) => {
      if (isRecord(part)) add(part.id, `stage part ${opIndex + 1}:${partIndex + 1} id`);
    });
  });
}

/** Clone ops and fill only missing operation/part identities. Existing IDs never move. */
export function ensureStageIds(ops: readonly StageOp[]): StageOp[] {
  if (!Array.isArray(ops)) throw new Error("stage ops must be an array");
  const next = structuredClone(ops) as StageOp[];
  const used = new Set<string>();
  for (const op of next) {
    if (typeof op.args?.id === "string" && op.args.id.trim() !== "") used.add(op.args.id);
    if (Array.isArray(op.args?.parts)) {
      for (const part of op.args.parts) if (isRecord(part) && typeof part.id === "string" && part.id.trim() !== "") used.add(part.id);
    }
  }
  next.forEach((op, opIndex) => {
    if (typeof op.args.id !== "string" || op.args.id.trim() === "") {
      let id: string;
      do id = randomUUID(); while (used.has(id));
      used.add(id);
      op.args.id = id;
    }
    if (!Array.isArray(op.args.parts)) return;
    op.args.parts.forEach((part, partIndex) => {
      if (isRecord(part) && (typeof part.id !== "string" || part.id.trim() === "")) {
        let id: string;
        do id = randomUUID(); while (used.has(id));
        used.add(id);
        part.id = id;
      }
    });
  });
  assertUniqueRefs(next);
  return next;
}

type Ref = { id: string; opIndex: number; partIndex?: number };

function refsFor(ops: readonly StageOp[]): Map<string, Ref> {
  const refs = new Map<string, Ref>();
  ops.forEach((op, opIndex) => {
    const opId = op.args.id;
    if (typeof opId !== "string" || opId.trim() === "") throw new Error(`stage op ${opIndex + 1} is missing an id`);
    if (refs.has(opId)) throw new Error(`ambiguous stage ref: ${opId}`);
    refs.set(opId, { id: opId, opIndex });
    if (!Array.isArray(op.args.parts)) return;
    op.args.parts.forEach((part, partIndex) => {
      if (!isRecord(part)) throw new Error(`stage part ${opIndex + 1}:${partIndex + 1} must be an object`);
      if (typeof part.id !== "string" || part.id.trim() === "") throw new Error(`stage part ${opIndex + 1}:${partIndex + 1} is missing an id`);
      if (refs.has(part.id)) throw new Error(`ambiguous stage ref: ${part.id}`);
      refs.set(part.id, { id: part.id, opIndex, partIndex });
    });
  });
  return refs;
}

function validatePatch(value: unknown, index: number): StageAgentPatch {
  if (!isRecord(value)) throw new Error(`stage agent patch ${index + 1} must be an object`);
  if (typeof value.id !== "string" || value.id.trim() === "") throw new Error(`stage agent patch ${index + 1} id must be a non-empty string`);
  if (value.changes !== undefined && !isRecord(value.changes)) throw new Error(`stage agent patch ${index + 1} changes must be an object`);
  if (value.remove !== undefined && typeof value.remove !== "boolean") throw new Error(`stage agent patch ${index + 1} remove must be boolean`);
  if (value.changes && ("id" in value.changes || "action" in value.changes || "parts" in value.changes || "args" in value.changes)) {
    throw new Error(`stage agent patch ${index + 1} cannot change identity, action, or parts`);
  }
  return {
    id: value.id,
    ...(value.changes ? { changes: structuredClone(value.changes) } : {}),
    ...(value.remove === undefined ? {} : { remove: value.remove }),
  };
}

/** Apply disjoint ID-based field patches atomically; the input array is never mutated. */
export function applyStageAgentPatch(
  ops: readonly StageOp[],
  request: StageAgentPatchRequest,
  current: StageAgentCurrent,
): StageAgentPatchResult {
  if (!Number.isInteger(request?.expectedRevision) || request.expectedRevision < 0) throw new Error("expectedRevision must be a non-negative integer");
  if (typeof request?.expectedInstance !== "string" || request.expectedInstance.length === 0) throw new Error("expectedInstance must be a non-empty string");
  if (request.expectedRevision !== current.revision) throw new Error("stage revision is stale");
  if (request.expectedInstance !== current.instance) throw new Error("stage instance is stale");
  if (!Array.isArray(request.patches) || request.patches.length === 0) throw new Error("stage patches must be a non-empty array");

  const candidate = structuredClone(ops) as StageOp[];
  assertUniqueRefs(candidate);
  const base = validateStageOps(candidate);
  assertUniqueRefs(base);
  const refs = refsFor(base);
  const patches = request.patches.map(validatePatch);
  const requested = new Set<string>();
  const resolved: { patch: StageAgentPatch; ref: Ref }[] = [];
  for (const patch of patches) {
    if (requested.has(patch.id)) throw new Error(`duplicate patch ref: ${patch.id}`);
    requested.add(patch.id);
    const ref = refs.get(patch.id);
    if (!ref) throw new Error(`stage ref not found: ${patch.id}`);
    resolved.push({ patch, ref });
  }
  const patchKinds = new Map<number, { op: boolean; part: boolean }>();
  for (const { ref } of resolved) {
    const kind = patchKinds.get(ref.opIndex) ?? { op: false, part: false };
    if (ref.partIndex === undefined) kind.op = true;
    else kind.part = true;
    patchKinds.set(ref.opIndex, kind);
  }
  for (const [opIndex, kind] of patchKinds) if (kind.op && kind.part) throw new Error(`overlapping stage patches for op ${opIndex}`);

  for (const { patch, ref } of resolved) {
    const op = base[ref.opIndex];
    const target = ref.partIndex === undefined
      ? op.args
      : (op.args.parts as Record<string, unknown>[]).find((part) => part.id === patch.id);
    if (!target) throw new Error(`stage ref not found: ${patch.id}`);
    if (op.args.locked === true || target.locked === true) throw new Error(`stage ref is locked: ${patch.id}`);
    // Supported group edits are center/name and other validated metadata. Raw-prop
    // transforms belong to part IDs because the renderer/builders do not consume
    // root rot or size fields for a parts-based prop.
    if (ref.partIndex === undefined && op.action === "build" && op.args.kind === "prop"
      && patch.changes && ("rot" in patch.changes || "size" in patch.changes)) {
      throw new Error("raw prop root rot/size is unsupported; patch part rot/size or op center");
    }
    if (ref.partIndex !== undefined && patch.changes && "size" in patch.changes) {
      const size = finiteVec3(patch.changes.size);
      if (!size || size.some((value) => value <= 0)) throw new Error("stage part size must contain three positive finite numbers");
    }
  }

  const next = structuredClone(base);
  const removedOps = new Set<number>();
  const changedIds: string[] = [];
  const affected = new Set<number>();
  for (const { patch, ref } of resolved) {
    if (removedOps.has(ref.opIndex)) throw new Error(`stage op was already removed: ${ref.opIndex}`);
    const op = next[ref.opIndex];
    const target = ref.partIndex === undefined
      ? op.args
      : (op.args.parts as Record<string, unknown>[]).find((part) => part.id === patch.id);
    if (!target) throw new Error(`stage ref not found: ${patch.id}`);
    if (patch.remove === true) {
      if (ref.partIndex === undefined) removedOps.add(ref.opIndex);
      else op.args.parts = (op.args.parts as Record<string, unknown>[]).filter((part) => part.id !== patch.id);
      changedIds.push(patch.id);
      affected.add(ref.opIndex);
      continue;
    }
    const before = JSON.stringify(target);
    Object.assign(target, patch.changes ?? {});
    if (JSON.stringify(target) !== before) {
      changedIds.push(patch.id);
      affected.add(ref.opIndex);
    }
  }

  const validated = validateStageOps(next.filter((_, index) => !removedOps.has(index)));
  assertUniqueRefs(validated);
  return {
    ok: true,
    ops: validated,
    changedIds,
    affectedIndices: [...affected].sort((a, b) => a - b),
  };
}

export type StageBounds = { min: number[]; max: number[] };
export type StageInventoryItem = {
  id: string;
  opIndex: number;
  partIndex?: number;
  name?: string;
  geometry?: { center: number[]; size: number[]; rot: number[]; shape?: string };
  bounds: StageBounds | null;
};

type LedgerInventoryItem = StageInventoryItem & { fingerprint: string };

type LedgerPoint = {
  revision: number;
  instance: string;
  inventory: LedgerInventoryItem[];
  truncated: boolean;
  qa: Set<string>;
  qaTotal: number;
  qaCoverage: ReturnType<typeof scanStageIssues>["coverage"];
};

export type StageInspectRequest = {
  revision: number;
  instance: string;
  since?: number;
  detail?: boolean;
  ops?: readonly StageOp[];
  offset?: number;
  limit?: number;
};

export type StageInspectResult = {
  revision: number;
  instance: string;
  inventory?: StageInventoryItem[];
  truncated: boolean;
  qa: { new: string[]; resolved: string[]; partial?: boolean; resolvedSuppressed?: boolean };
  inventoryTotal: number;
  inventoryOffset: number;
  inventoryHasMore: boolean;
  inventoryNextOffset: number | null;
  qaTotal: number;
  qaNextOffset: number | null;
};

const boundsFor = (center: number[], size: number[], rot: number[]): StageBounds => {
  const half = size.map((value) => value / 2);
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((axis) => rotateStageVector(axis, rot));
  const extent = [0, 1, 2].map((axis) => axes.reduce((sum, vector, index) => sum + Math.abs(vector[axis]) * half[index], 0));
  return { min: center.map((value, index) => value - extent[index]), max: center.map((value, index) => value + extent[index]) };
};

function geometry(center: unknown, size: unknown, rot: unknown, shape: unknown) {
  const c = finiteVec3(center), s = finiteVec3(size), r = finiteVec3(rot) ?? [0, 0, 0];
  if (!c || !s || s.some((value) => value <= 0)) return null;
  return { geometry: { center: c, size: s, rot: r, ...(typeof shape === "string" ? { shape } : {}) }, bounds: boundsFor(c, s, r) };
}

function compactHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function inventoryFor(ops: readonly StageOp[]): { inventory: LedgerInventoryItem[]; truncated: boolean } {
  const inventory: LedgerInventoryItem[] = [];
  const add = (item: LedgerInventoryItem) => inventory.push(item);
  ops.forEach((op, opIndex) => {
    const args = op.args;
    let opBounds: StageBounds | null = null;
    const opGeometry = op.action === "build" ? geometry(args.center, args.size, args.rot, args.shape) : null;
    if (opGeometry) opBounds = opGeometry.bounds;
    const partItems: LedgerInventoryItem[] = [];
    if (Array.isArray(args.parts)) {
      args.parts.forEach((raw, partIndex) => {
        if (!isRecord(raw) || typeof raw.id !== "string") return;
        const part = geometry(
          finiteVec3(args.center) && finiteVec3(raw.pos) ? finiteVec3(args.center)!.map((value, index) => value + finiteVec3(raw.pos)![index]) : args.center,
          raw.size,
          raw.rot,
          raw.shape,
        );
        if (part) {
          opBounds = opBounds ? {
            min: opBounds.min.map((value, index) => Math.min(value, part.bounds.min[index])),
            max: opBounds.max.map((value, index) => Math.max(value, part.bounds.max[index])),
          } : part.bounds;
        }
        const { id: _id, ...editablePart } = raw;
        partItems.push({ id: raw.id, opIndex, partIndex, ...(typeof raw.name === "string" ? { name: raw.name } : {}), ...(part ?? { bounds: null }), fingerprint: compactHash(editablePart) });
      });
    }
    if (typeof args.id === "string") {
      const { id: _id, parts: _parts, ...editableArgs } = args;
      add({ id: args.id, opIndex, ...(typeof args.name === "string" ? { name: args.name } : {}), ...(opGeometry ?? { bounds: opBounds }), fingerprint: compactHash({ action: op.action, args: editableArgs }) });
    }
    for (const item of partItems) add(item);
  });
  return { inventory, truncated: false };
}

export class ChangeLedger {
  private readonly points = new Map<number, LedgerPoint>();

  constructor(private readonly capacity = 50) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("ledger capacity must be positive");
  }

  record(revision: number, instance: string, ops: readonly StageOp[]): void {
    if (!Number.isInteger(revision) || revision < 0) throw new Error("ledger revision must be a non-negative integer");
    if (typeof instance !== "string" || instance.length === 0) throw new Error("ledger instance must be a non-empty string");
    const candidate = structuredClone(ops) as StageOp[];
    assertUniqueRefs(candidate);
    const checked = validateStageOps(candidate);
    assertUniqueRefs(checked);
    const { inventory, truncated } = inventoryFor(checked);
    const qaReport = scanStageIssues(checked, { maxIssues: 1000 });
    this.points.delete(revision);
    this.points.set(revision, {
      revision,
      instance,
      inventory,
      truncated,
      qa: new Set(qaReport.issues.map((issue) => issue.id)),
      qaTotal: qaReport.issues.length,
      qaCoverage: qaReport.coverage,
    });
    while (this.points.size > this.capacity) this.points.delete(this.points.keys().next().value!);
  }

  inspect(request: StageInspectRequest): StageInspectResult & Record<string, unknown> {
    if (!Number.isInteger(request.revision) || request.revision < 0) throw new Error("inspect revision must be a non-negative integer");
    if (request.since !== undefined && (!Number.isInteger(request.since) || request.since < 0)) throw new Error("inspect since must be a non-negative integer");
    if (request.since !== undefined && request.since > request.revision) throw new Error("inspect since cannot exceed revision");
    const current = this.points.get(request.revision);
    if (!current) throw new Error(`stage revision ${request.revision} is no longer retained`);
    if (current.instance !== request.instance) throw new Error("stage instance is stale");
    const offset = request.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) throw new Error("inspect offset must be a non-negative integer");
    const pageSize = request.detail === true ? (request.limit ?? 50) : Math.min(request.limit ?? 50, 50);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_STAGE_ITEMS) throw new Error("inspect limit is invalid");
    const page = <T>(items: readonly T[]) => items.slice(offset, offset + pageSize);
    const nextOffset = (total: number) => offset + pageSize < total ? offset + pageSize : null;
    const publicItem = ({ fingerprint: _fingerprint, ...item }: LedgerInventoryItem): StageInventoryItem => item;
    const inventory = current.inventory.map(publicItem);
    const detail = request.detail === true && request.ops ? { detail: structuredClone(request.ops) } : {};
    const base = {
      revision: current.revision,
      instance: current.instance,
      ...(request.since === undefined || request.detail === true ? { inventory: page(inventory) } : {}),
      inventoryTotal: inventory.length,
      inventoryOffset: offset,
      inventoryHasMore: offset + pageSize < inventory.length,
      inventoryNextOffset: nextOffset(inventory.length),
      truncated: current.truncated,
      qa: { new: page([...current.qa]), resolved: [] as string[] },
      qaTotal: current.qaTotal,
      qaNextOffset: nextOffset(current.qaTotal),
      qaTotalLimited: current.qaCoverage.status !== "complete" || current.qaCoverage.resultsTruncated || current.qaCoverage.budgetExceeded,
      qaCoverage: current.qaCoverage,
      ...detail,
    };
    if (request.since === undefined) return base;
    const previous = this.points.get(request.since);
    if (!previous) throw new Error(`stage revision ${request.since} is no longer retained`);
    if (previous.instance !== request.instance) throw new Error("stage instance is stale");
    const before = new Map(previous.inventory.map((item) => [item.id, item]));
    const after = new Map(current.inventory.map((item) => [item.id, item]));
    const added = [...after.values()].filter((item) => !before.has(item.id)).map(publicItem);
    const removed = [...before.values()].filter((item) => !after.has(item.id)).map(publicItem);
    const changed = [...after.values()]
      .filter((item) => before.has(item.id) && item.fingerprint !== before.get(item.id)!.fingerprint)
      .map((item) => ({ id: item.id, before: publicItem(before.get(item.id)!), after: publicItem(item) }));
    const qaNew = [...current.qa].filter((id) => !previous.qa.has(id));
    const qaResolved = [...previous.qa].filter((id) => !current.qa.has(id));
    const qaPartial = current.qaCoverage.status !== "complete" || current.qaCoverage.resultsTruncated || current.qaCoverage.budgetExceeded;
    return {
      ...base,
      since: previous.revision,
      added: page(added),
      removed: page(removed),
      changed: page(changed),
      addedTotal: added.length,
      removedTotal: removed.length,
      changedTotal: changed.length,
      addedNextOffset: nextOffset(added.length),
      removedNextOffset: nextOffset(removed.length),
      changedNextOffset: nextOffset(changed.length),
      qaNewTotal: qaNew.length,
      qaResolvedTotal: qaPartial ? 0 : qaResolved.length,
      qaNewNextOffset: nextOffset(qaNew.length),
      qaResolvedNextOffset: qaPartial ? null : nextOffset(qaResolved.length),
      qaTotalLimited: qaPartial,
      qaCoverage: current.qaCoverage,
      qa: {
        new: page(qaNew),
        resolved: qaPartial ? [] : page(qaResolved),
        partial: qaPartial,
        resolvedSuppressed: qaPartial,
      },
    };
  }
}
