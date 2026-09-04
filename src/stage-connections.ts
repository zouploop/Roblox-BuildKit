import { randomUUID } from "node:crypto";
import { STAGE_CONNECTION } from "./schemas.js";
import type { StageOp } from "./stage-state.js";

type Part = Record<string, unknown>;
const record = (value: unknown): value is Part => !!value && typeof value === "object" && !Array.isArray(value);
const parts = (op: StageOp): Part[] => op.action === "build" && op.args.kind === "prop" && Array.isArray(op.args.parts)
  ? op.args.parts.filter(record) : [];

/** Keep endpoint coordinates in part-local space; size is their immutable reference size. */
export function normalizeStageConnections(ops: StageOp[]): StageOp[] {
  if (!ops.some(op => op.args.connections !== undefined || parts(op).some(part => part.connections !== undefined))) return ops;
  const next = structuredClone(ops);
  const groups = next.map(parts);
  const all = groups.flat();
  const byId = new Map<string, Part[]>();
  for (const part of all) if (typeof part.id === "string") {
    const matches = byId.get(part.id) ?? [];
    matches.push(part);
    byId.set(part.id, matches);
  }
  const resolve = (ref: string, local: Part[]): Part | undefined => {
    const localIds = local.filter(part => part.id === ref);
    if (localIds.length) return localIds.length === 1 ? localIds[0] : undefined;
    const globalIds = byId.get(ref);
    if (globalIds) return globalIds.length === 1 ? globalIds[0] : undefined;
    const names = local.filter(part => part.name === ref);
    return names.length === 1 ? names[0] : undefined;
  };
  // Resolve against original identities before repairing IDs on duplicate library copies.
  const pending: { op: StageOp; rule: unknown; a?: Part; b?: Part }[] = [];
  next.forEach((op, index) => {
    for (const owner of [op.args, ...groups[index]]) {
      if (!Array.isArray(owner.connections)) continue;
      const rules = owner.connections;
      delete owner.connections;
      for (const rule of rules) {
        const parsed = STAGE_CONNECTION.safeParse(rule);
        pending.push({ op, rule, ...(parsed.success ? {
          a: resolve(parsed.data.a.part, groups[index]), b: resolve(parsed.data.b.part, groups[index]),
        } : {}) });
      }
    }
  });
  // An unresolved collision must remain ambiguous for QA, never become a unique wrong target.
  const blocked = new Set<string>();
  for (const { rule, a, b } of pending) if ((!a || !b) && record(rule)) {
    for (const endpoint of [rule.a, rule.b]) if (record(endpoint) && typeof endpoint.part === "string" && (byId.get(endpoint.part)?.length ?? 0) > 1) blocked.add(endpoint.part);
  }
  const used = new Set(byId.keys());
  for (const part of all) {
    if (typeof part.id === "string" && part.id.trim() && ((byId.get(part.id)?.length ?? 0) === 1 || blocked.has(part.id))) continue;
    let id: string;
    do { id = randomUUID(); } while (used.has(id));
    used.add(id);
    part.id = id;
  }
  const validSize = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === "number" && Number.isFinite(n) && n > 0);
  for (const { op, rule, a, b } of pending) {
    if (!record(rule)) {
      if (!Array.isArray(op.args.connections)) op.args.connections = [];
      (op.args.connections as unknown[]).push(rule);
      continue;
    }
    const canonical = a && b && !blocked.has(a.id as string) && !blocked.has(b.id as string)
      && record(rule.a) && record(rule.b) && validSize(rule.a.size ?? a.size) && validSize(rule.b.size ?? b.size);
    const owner = canonical ? a! : op.args;
    // Preserve malformed metadata rather than overwriting it with canonical rules.
    if (owner.connections !== undefined && !Array.isArray(owner.connections)) {
      throw new Error("Invalid stage connections: expected an array");
    }
    const rules = (owner.connections ??= []) as unknown[];
    rules.push(canonical ? {
      ...rule,
      a: { ...(rule.a as Part), part: a!.id, size: structuredClone((rule.a as Part).size ?? a!.size) },
      b: { ...(rule.b as Part), part: b!.id, size: structuredClone((rule.b as Part).size ?? b!.size) },
    } : rule);
  }
  return next;
}
