import { validateStageOps } from "./stage-share.js";
import type { StageOp } from "./stage-state.js";

export type StageReparentRequest = {
  action: "group" | "ungroup";
  source?: { index: number; partIndex: number };
  sources?: { index: number; partIndex: number }[];
  targetIndex?: number;
};

type ReparentEntry = { owner: string | null; op: StageOp };
type PropArgs = Record<string, unknown> & { kind: "prop"; parts: Record<string, unknown>[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function vector(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((part) => typeof part === "number" && Number.isFinite(part))) {
    throw new Error(`stage reparent ${label} must be [x,y,z]`);
  }
  return value as number[];
}

function prop(entry: ReparentEntry, label: string): PropArgs {
  if (entry.op.action !== "build" || entry.op.args.kind !== "prop" || !Array.isArray(entry.op.args.parts) || !entry.op.args.parts.every(isRecord)) {
    throw new Error(`stage reparent ${label} must be a prop with parts`);
  }
  return entry.op.args as PropArgs;
}

function parseIndex(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`stage reparent ${label} must be a non-negative integer`);
  return value as number;
}

function parseSource(value: unknown, label: string) {
  if (!isRecord(value)) throw new Error(`stage reparent ${label} must be {index,partIndex}`);
  return { index: parseIndex(value.index, `${label}.index`), partIndex: parseIndex(value.partIndex, `${label}.partIndex`) };
}

export function parseStageReparentRequest(value: unknown): StageReparentRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("stage reparent request must be an object");
  const data = value as Record<string, unknown>;
  if (data.action !== "group" && data.action !== "ungroup") throw new Error("stage reparent action must be 'group' or 'ungroup'");
  const hasSource = data.source !== undefined;
  const hasSources = data.sources !== undefined;
  if (hasSource === hasSources) throw new Error("stage reparent requires exactly one of source or sources");
  const source = hasSource ? parseSource(data.source, "source") : undefined;
  const sources = hasSources
    ? (() => {
        if (!Array.isArray(data.sources) || data.sources.length === 0) throw new Error("stage reparent sources must be a non-empty array");
        return data.sources.map((value, index) => parseSource(value, `sources[${index}]`));
      })()
    : undefined;
  const targetIndex = data.targetIndex === undefined ? undefined : parseIndex(data.targetIndex, "targetIndex");
  if (data.action === "group" && hasSources && sources!.length < 2) throw new Error("stage reparent group requires at least two sources");
  if (data.action === "group" && hasSource && targetIndex === undefined) throw new Error("stage reparent group requires targetIndex");
  if (data.action === "group" && hasSources && targetIndex !== undefined) throw new Error("stage reparent grouped sources do not accept targetIndex");
  if (data.action === "ungroup" && targetIndex !== undefined) throw new Error("stage reparent ungroup does not accept targetIndex");
  return {
    action: data.action,
    ...(source ? { source } : { sources }),
    ...(targetIndex === undefined ? {} : { targetIndex }),
  };
}

export function applyStageReparent(entries: ReparentEntry[], request: StageReparentRequest): { entries: ReparentEntry[]; promotedOwners: Set<string> } {
  const sources = request.sources ?? (request.source ? [request.source] : []);
  if (sources.length === 0) throw new Error("stage reparent requires at least one source");
  if (request.action === "group" && request.targetIndex === undefined) {
    if (sources.length < 2) throw new Error("stage reparent group requires at least two sources");
    if (new Set(sources.map(({ index }) => index)).size < 2) throw new Error("stage reparent group requires sources from at least two props");
  }

  const selected = sources.map((ref) => {
    const entry = entries[ref.index];
    if (!entry) throw new Error(`stage reparent source index ${ref.index} is out of range`);
    const args = prop(entry, "source");
    const part = args.parts[ref.partIndex];
    if (!part || typeof part !== "object" || Array.isArray(part)) throw new Error("stage reparent source partIndex is out of range");
    const center = vector(args.center, "source center");
    const partCopy = structuredClone(part);
    const pos = partCopy.pos === undefined ? [0, 0, 0] : vector(partCopy.pos, "source part pos");
    return { ref, entry, args, part: partCopy, world: center.map((value, index) => value + pos[index]) };
  });
  const refs = new Set(sources.map((ref) => `${ref.index}:${ref.partIndex}`));
  if (refs.size !== sources.length) throw new Error("stage reparent sources must be unique");

  const promotedOwners = new Set<string>();
  for (const item of selected) if (item.entry.owner) promotedOwners.add(item.entry.owner);

  if (request.action === "group" && request.targetIndex !== undefined) {
    const source = selected[0];
    if (request.targetIndex === source.ref.index) throw new Error("stage reparent source and target must differ");
    const target = entries[request.targetIndex];
    if (!target) throw new Error(`stage reparent target index ${request.targetIndex} is out of range`);
    const targetArgs = prop(target, "target");
    if (target.owner) promotedOwners.add(target.owner);
    const targetCenter = vector(targetArgs.center, "target center");
    const next = entries.map((entry) => ({ owner: entry.owner, op: structuredClone(entry.op) }));
    const nextSourceArgs = prop(next[source.ref.index], "source");
    nextSourceArgs.parts.splice(source.ref.partIndex, 1);
    const nextTargetArgs = prop(next[request.targetIndex], "target");
    nextTargetArgs.parts.push({ ...source.part, pos: source.world.map((value, index) => value - targetCenter[index]) });
    if (nextSourceArgs.parts.length === 0) next.splice(source.ref.index, 1);
    const validated = validateStageOps(next.map((entry) => entry.op), "stage reparent");
    return { entries: next.map((entry, index) => ({ ...entry, op: validated[index] })), promotedOwners };
  }

  const selectedParts = new Map<number, Set<number>>();
  for (const { ref } of selected) {
    const partIndexes = selectedParts.get(ref.index) ?? new Set<number>();
    partIndexes.add(ref.partIndex);
    selectedParts.set(ref.index, partIndexes);
  }
  let next: ReparentEntry[];
  const removeSelected = () => entries
    .map((entry) => ({ owner: entry.owner, op: structuredClone(entry.op) }))
    .map((entry, index) => {
      const partIndexes = selectedParts.get(index);
      if (!partIndexes) return entry;
      const args = prop(entry, "source");
      args.parts = args.parts.filter((_, partIndex) => !partIndexes.has(partIndex));
      return entry;
    })
    .filter((entry, index) => !selectedParts.has(index) || !((entry.op.action === "build") && entry.op.args.kind === "prop" && Array.isArray(entry.op.args.parts) && entry.op.args.parts.length === 0));

  if (request.action === "group") {
    next = removeSelected();
    next.push({
      owner: null,
      op: {
        action: "build",
        args: { kind: "prop", name: "Group", center: [0, 0, 0], parts: selected.map(({ part, world }) => ({ ...part, pos: world })) },
      },
    });
  } else if (request.source) {
    const source = selected[0];
    next = entries.map((entry) => ({ owner: entry.owner, op: structuredClone(entry.op) }));
    const nextSource = next[source.ref.index];
    const nextSourceArgs = prop(nextSource, "source");
    nextSourceArgs.parts.splice(source.ref.partIndex, 1);
    const standalone = structuredClone(source.part);
    standalone.pos = [0, 0, 0];
    const standaloneArgs = { ...structuredClone(source.args), kind: "prop", center: source.world, parts: [standalone] };
    next.splice(source.ref.index, 1, ...(nextSourceArgs.parts.length === 0 ? [] : [nextSource]), {
      owner: null,
      op: { action: "build", args: standaloneArgs },
    });
  } else {
    next = removeSelected();
    next.push(...selected.map(({ part, args, world }) => {
      const standalone = structuredClone(part);
      standalone.pos = [0, 0, 0];
      return {
        owner: null,
        op: {
          action: "build" as const,
          args: { ...structuredClone(args), kind: "prop", center: world, parts: [standalone] },
        },
      };
    }));
  }
  const validated = validateStageOps(next.map((entry) => entry.op), "stage reparent");
  return { entries: next.map((entry, index) => ({ ...entry, op: validated[index] })), promotedOwners };
}
