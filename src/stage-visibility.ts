import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { CONFIG_DIR } from "./config.js";

export const STAGE_VISIBILITY_PATH = path.join(CONFIG_DIR, "stage-visibility.json");

export type StageVisibilityState = Record<string, string[]>;
type GeneratorStateLike = { name: string; enabled: boolean };

const FORMAT_VERSION = 1;
const SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function validGeneratorName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\\/]/.test(value);
}

function cloneState(state: StageVisibilityState): StageVisibilityState {
  const clone = Object.create(null) as StageVisibilityState;
  for (const [session, names] of Object.entries(state)) clone[session] = [...names];
  return clone;
}

function normalizeState(value: unknown): StageVisibilityState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const root = value as Record<string, unknown>;
  if (root.version !== FORMAT_VERSION || !root.sessions || typeof root.sessions !== "object" || Array.isArray(root.sessions)) return {};
  const state = Object.create(null) as StageVisibilityState;
  for (const [session, value] of Object.entries(root.sessions as Record<string, unknown>)) {
    if (!SESSION_PATTERN.test(session) || !Array.isArray(value)) continue;
    const names = [...new Set(value.filter(validGeneratorName))].sort();
    if (names.length) state[session] = names;
  }
  return state;
}

export async function loadStageVisibility(): Promise<StageVisibilityState> {
  try {
    return normalizeState(JSON.parse(await readFileAsync(STAGE_VISIBILITY_PATH, "utf8")));
  } catch {
    return {};
  }
}

export function saveStageVisibility(state: StageVisibilityState): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const target = path.resolve(STAGE_VISIBILITY_PATH);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  const data = `${JSON.stringify({ version: FORMAT_VERSION, sessions: state }, null, 2)}\n`;
  try {
    writeFileSync(temporary, data, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      renameSync(temporary, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
    }
    const backup = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.bak`);
    try {
      renameSync(target, backup);
      try {
        renameSync(temporary, target);
      } catch (error) {
        renameSync(backup, target);
        throw error;
      }
      try { unlinkSync(backup); } catch {}
    } catch (error) {
      try { unlinkSync(temporary); } catch {}
      throw error;
    }
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

export class StageVisibilityStore {
  private state = Object.create(null) as StageVisibilityState;

  constructor(private readonly save = saveStageVisibility) {}

  async load(): Promise<void> {
    this.state = await loadStageVisibility();
  }

  apply<T extends GeneratorStateLike>(session: string, states: readonly T[]): T[] {
    const disabled = new Set(Object.prototype.hasOwnProperty.call(this.state, session) ? this.state[session] : []);
    return states.map((state) => disabled.has(state.name) ? { ...state, enabled: false } : { ...state });
  }

  commit(session: string, enabled: Record<string, boolean>): boolean {
    if (!SESSION_PATTERN.test(session)) throw new Error("invalid Stage session id");
    const known = new Set(Object.keys(enabled));
    const current = Object.prototype.hasOwnProperty.call(this.state, session) ? this.state[session] : [];
    const next = new Set(current.filter((name) => !known.has(name)));
    for (const [name, value] of Object.entries(enabled)) if (value === false) next.add(name);
    const names = [...next].sort();
    const previous = current;
    if (JSON.stringify(previous) === JSON.stringify(names)) return false;
    const nextState = cloneState(this.state);
    if (names.length) nextState[session] = names;
    else delete nextState[session];
    this.save(nextState);
    this.state = nextState;
    return true;
  }

  seedFromSnapshot<T extends GeneratorStateLike>(session: string, states: readonly T[]): boolean {
    const enabled = Object.fromEntries(states.map((state) => [state.name, state.enabled]));
    return this.commit(session, enabled);
  }
}
