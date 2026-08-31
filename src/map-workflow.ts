import { watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { z } from "zod";

export const MAP_RULE_CAP = 256;
export const MAP_PAYLOAD_CAP = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 100;

const point = z.array(z.number().finite()).length(3);
const count = z.number().int().min(1).max(500);
const region = z.union([
  z.object({ center: point, radius: z.number().positive() }),
  z.object({ min: point, max: point }),
]);
const line = z
  .object({
    from: point,
    to: point,
    spacing: z.number().positive().optional(),
    count: count.optional(),
    via: point.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.spacing === undefined) === (value.count === undefined)) {
      ctx.addIssue({ code: "custom", path: ["spacing"], message: "line needs exactly one of spacing or count" });
    }
  });

const MAP_RULE = z
  .object({
    id: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, "id must use letters, numbers, ., _, :, or -"),
    prefab: z.string().trim().min(1),
    place: z.object({ at: point, rotation: point.optional() }).optional(),
    at: point.optional(),
    line: line.optional(),
    grid: z.object({ origin: point, rows: count, cols: count, spacingX: z.number().positive(), spacingZ: z.number().positive() }).optional(),
    ring: z.object({ center: point, radius: z.number().positive(), count, startAngle: z.number().finite().optional() }).optional(),
    scatter: z.object({ region, count }).optional(),
    rotation: point.optional(),
    ground: z.boolean().optional(),
    snap: z.number().positive().optional(),
    rotate: z.enum(["none", "random", "align"]).optional(),
    jitter: z.union([z.number().nonnegative(), point.refine((values) => values.every((value) => value >= 0), "jitter components must be non-negative")]).optional(),
    seed: z.number().int().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const verbs = ["place", "line", "grid", "ring", "scatter"].filter((verb) => value[verb] !== undefined);
    if (value.at !== undefined) verbs.push("place");
    if (verbs.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["id"], message: "rule needs exactly one of place, line, grid, ring, or scatter" });
    }
    if ((value.jitter !== undefined || value.scatter !== undefined) && value.seed === undefined) {
      ctx.addIssue({ code: "custom", path: ["seed"], message: "scatter and jitter need seed" });
    }
    if (value.grid && value.grid.rows * value.grid.cols > 500) {
      ctx.addIssue({ code: "custom", path: ["grid"], message: "grid is capped at 500 instances" });
    }
  });

export type MapPlacementRule = z.infer<typeof MAP_RULE>;
export type MapFileState = { name: string; rules: MapPlacementRule[]; error?: string };

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^(?:Error|[A-Za-z]+Error):\s*/, "");
}

function namedError(filename: string, error: unknown): Error {
  const message = errorText(error);
  return new Error(message.startsWith(`${filename}:`) ? message : `${filename}: ${message}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exportedSource(source: string): string {
  return source
    .replace(/\bexport\s+default\s+function\s+place\b/g, "function place")
    .replace(/\bexport\s+(async\s+)?function\s+place\b/g, "$1function place")
    .replace(/\bexport\s+(const|let|var)\s+place\s*=/g, "$1 place =")
    .replace(/\bexport\s+default\s+/g, "module.exports.default = ")
    .replace(/\bexport\s*\{\s*place\s*\}\s*;?/g, "");
}

export function normalizeMapRules(raw: unknown, filename = "map.js", maxRules = MAP_RULE_CAP): MapPlacementRule[] {
  if (!Array.isArray(raw)) throw new Error(`${filename}: place() must return an array of rules`);
  if (raw.length > maxRules) throw new Error(`${filename}: ${raw.length} rules exceeds the ${maxRules}-rule limit`);
  const ids = new Set<string>();
  const rules = raw.map((value, index) => {
    let rule: MapPlacementRule;
    try {
      rule = MAP_RULE.parse(value);
    } catch (error) {
      const message = error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("; ") : errorText(error);
      throw new Error(`${filename}: rule ${index + 1}: ${message}`);
    }
    if (ids.has(rule.id)) throw new Error(`${filename}: duplicate rule id '${rule.id}'`);
    ids.add(rule.id);
    return rule;
  });
  if (Buffer.byteLength(JSON.stringify(rules), "utf8") > MAP_PAYLOAD_CAP) {
    throw new Error(`${filename}: rule payload exceeds the ${MAP_PAYLOAD_CAP}-byte limit`);
  }
  return rules;
}

export function runMapSource(source: string, filename = "map.js", options: { timeoutMs?: number; args?: unknown } = {}): MapPlacementRule[] {
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const sandbox = Object.create(null) as Record<string, unknown>;
  const module = { exports: {} as Record<string, unknown> };
  sandbox.module = module;
  sandbox.exports = module.exports;
  sandbox.args = options.args ?? {};
  sandbox.process = undefined;
  sandbox.require = undefined;
  sandbox.fs = undefined;
  sandbox.console = { log() {}, warn() {}, error() {} };
  const code = exportedSource(source);
  const script = `(function(module, exports, args) {
"use strict";
${code}
module.exports.place = module.exports.place || (typeof place === "function" ? place : undefined);
const __place = typeof module.exports === "function" ? module.exports : module.exports.place || module.exports.default;
if (typeof __place !== "function") throw new Error("map must export place()");
return __place(args);
})(module, exports, args)`;
  let result: unknown;
  try {
    result = new vm.Script(script, { filename }).runInNewContext(sandbox, {
      timeout: timeoutMs,
      breakOnSigint: false,
      contextCodeGeneration: { strings: false, wasm: false },
    });
  } catch (error) {
    throw namedError(filename, error);
  }
  try {
    return normalizeMapRules(result, filename);
  } catch (error) {
    throw namedError(filename, error);
  }
}

async function mapFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".js")
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function loadMaps(directory: string, previous: Map<string, MapFileState> = new Map(), options: { timeoutMs?: number } = {}): Promise<MapFileState[]> {
  await mkdir(directory, { recursive: true });
  const states: MapFileState[] = [];
  for (const name of await mapFiles(directory)) {
    const prior = previous.get(name);
    try {
      const source = await readFile(path.join(directory, name), "utf8");
      states.push({ name, rules: runMapSource(source, name, options) });
    } catch (error) {
      states.push({ name, rules: prior?.rules ?? [], error: errorText(error) });
    }
  }
  return states;
}

export type MapWatcherOptions = { debounceMs?: number; onChange: (states: MapFileState[], removed: string[]) => void | Promise<void>; onError?: (error: unknown) => void };

export class MapWatcher {
  private watcher: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private states = new Map<string, MapFileState>();
  private refreshPromise: Promise<MapFileState[]> | undefined;

  constructor(private readonly directory: string, private readonly options: MapWatcherOptions) {}

  async start(): Promise<MapFileState[]> {
    await mkdir(this.directory, { recursive: true });
    this.watcher = watch(this.directory, { persistent: false }, () => this.schedule());
    this.watcher.on("error", (error) => this.options.onError?.(error));
    return this.refresh();
  }

  async refresh(): Promise<MapFileState[]> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = loadMaps(this.directory, this.states).then(async (states) => {
      const next = new Map(states.map((state) => [state.name, state]));
      const removed = [...this.states.keys()].filter((name) => !next.has(name));
      this.states = next;
      await this.options.onChange(states, removed);
      return states;
    }).finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.watcher?.close();
    this.watcher = undefined;
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh().catch((error) => this.options.onError?.(error));
    }, Math.max(25, Math.floor(this.options.debounceMs ?? 100)));
    this.timer.unref?.();
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function ruleKey(rule: MapPlacementRule): string {
  const copy = { ...rule } as Record<string, unknown>;
  delete copy.id;
  return JSON.stringify(canonical(copy));
}

export type MapRuleDiff = {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  addedIds: string[];
  changedIds: string[];
  removedIds: string[];
};

export function diffMapRules(previous: readonly MapPlacementRule[], next: readonly MapPlacementRule[]): MapRuleDiff {
  const oldById = new Map(previous.map((rule) => [rule.id, rule]));
  const newById = new Map(next.map((rule) => [rule.id, rule]));
  const addedIds = [...newById.keys()].filter((id) => !oldById.has(id)).sort();
  const removedIds = [...oldById.keys()].filter((id) => !newById.has(id)).sort();
  const changedIds = [...newById.keys()].filter((id) => oldById.has(id) && ruleKey(oldById.get(id)!) !== ruleKey(newById.get(id)!)).sort();
  return {
    added: addedIds.length,
    changed: changedIds.length,
    removed: removedIds.length,
    unchanged: next.length - addedIds.length - changedIds.length,
    addedIds,
    changedIds,
    removedIds,
  };
}
