import { readFileSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { validateBatchOps } from "./schemas.js";
import { normalizeStageConnections } from "./stage-connections.js";
import type { GenerationState, StageOp } from "./stage-state.js";

export type GeneratorOptions = {
  timeoutMs?: number;
  maxOps?: number;
  args?: unknown;
};

export type GeneratorState = GenerationState;

const DEFAULT_TIMEOUT_MS = 100;
const DEFAULT_MAX_OPS = 5_000;
// Read trusted local source once; create the functions inside each VM so their
// constructors/prototypes never provide a new route to the host Function.
const BUILDKIT_SOURCE = readFileSync(new URL("../viewer/build-primitives.js", import.meta.url), "utf8")
  .replace(/\bexport\s+function\s+/g, "function ");

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
  // Generators are plain files, not a Node package. Accept the two common export
  // spellings without adding a transpiler or giving the sandbox module access.
  return source
    .replace(/\bexport\s+default\s+function\s+generate\b/g, "function generate")
    .replace(/\bexport\s+(async\s+)?function\s+generate\b/g, "$1function generate")
    .replace(/\bexport\s+(const|let|var)\s+generate\s*=/g, "$1 generate =")
    .replace(/\bexport\s+default\s+/g, "module.exports.default = ")
    .replace(/\bexport\s*\{\s*generate\s*\}\s*;?/g, "");
}

function generatedOps(raw: unknown, filename: string, maxOps: number): StageOp[] {
  if (!Array.isArray(raw)) throw new Error(`${filename}: generate(args) must return an array of ops`);
  if (raw.length > maxOps) throw new Error(`${filename}: generated ${raw.length} ops; limit is ${maxOps}`);

  const shaped = raw.map((op, index) => {
    if (!record(op) || (op.action !== "build" && op.action !== "edit") || !record(op.args)) {
      throw new Error(`${filename}: op ${index + 1} must be {action:'build'|'edit',args:{...}}`);
    }
    return { action: op.action, args: op.args } as { action: "build" | "edit"; args: Record<string, unknown> };
  });

  return normalizeStageConnections(validateBatchOps(shaped) as StageOp[]);
}

export function runGeneratorSource(source: string, filename = "generator.js", options: GeneratorOptions = {}): StageOp[] {
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const maxOps = Math.max(1, Math.floor(options.maxOps ?? DEFAULT_MAX_OPS));
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
  const script = `(function(module, exports, args, buildkit) {
"use strict";
${code}
module.exports.generate = module.exports.generate || (typeof generate === "function" ? generate : undefined);
const __generate = typeof module.exports === "function" ? module.exports : module.exports.generate || module.exports.default;
if (typeof __generate !== "function") throw new Error("generator must export generate(args)");
return __generate(args);
})(module, exports, args, (function() {
"use strict";
${BUILDKIT_SOURCE}
return Object.freeze({ beamBetween, railingPath, bridgeBetween });
})())`;
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
    return generatedOps(result, filename, maxOps);
  } catch (error) {
    throw namedError(filename, error);
  }
}

async function generatorFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".js")
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function loadGenerators(
  directory: string,
  previous: Map<string, GeneratorState> = new Map(),
  options: GeneratorOptions = {},
): Promise<GeneratorState[]> {
  await mkdir(directory, { recursive: true });
  const states: GeneratorState[] = [];
  for (const name of await generatorFiles(directory)) {
    const prior = previous.get(name);
    try {
      const source = await readFile(path.join(directory, name), "utf8");
      states.push({ name, enabled: prior?.enabled ?? true, ops: runGeneratorSource(source, name, options) });
    } catch (error) {
      const message = errorText(error);
      states.push({ name, enabled: prior?.enabled ?? true, ops: prior?.ops ?? [], error: message });
    }
  }
  return states;
}

export type GeneratorWatcherOptions = GeneratorOptions & {
  debounceMs?: number;
  onChange: (states: GeneratorState[]) => void | Promise<void>;
  onError?: (error: unknown) => void;
};

export class GeneratorWatcher {
  private watcher: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private states = new Map<string, GeneratorState>();
  private refreshPromise: Promise<GeneratorState[]> | undefined;

  constructor(private readonly directory: string, private readonly options: GeneratorWatcherOptions) {}

  async start(): Promise<GeneratorState[]> {
    await mkdir(this.directory, { recursive: true });
    this.watcher = watch(this.directory, { persistent: false }, () => this.schedule());
    this.watcher.on("error", (error) => this.options.onError?.(error));
    return this.refresh();
  }

  async refresh(): Promise<GeneratorState[]> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = loadGenerators(this.directory, this.states, this.options).then(async (states) => {
      this.states = new Map(states.map((state) => [state.name, state]));
      await this.options.onChange(states);
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
