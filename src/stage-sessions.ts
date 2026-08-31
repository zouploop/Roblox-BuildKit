import { StageState } from "./stage-state.js";

export const DEFAULT_STAGE_SESSION = "default";
export const MAX_STAGE_SESSIONS = 6;

export type StageSession = {
  id: string;
  state: StageState;
  lastActive: number;
};

export function stageSessionId(value?: unknown): string {
  if (value === undefined) return DEFAULT_STAGE_SESSION;
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new Error("session must be 1-64 letters, numbers, underscores, or hyphens");
  }
  return value;
}

export class StageSessionRegistry {
  private readonly sessions = new Map<string, StageSession>();

  constructor(private readonly maxSessions = MAX_STAGE_SESSIONS) {}

  get(value?: unknown): StageState {
    const id = stageSessionId(value);
    const existing = this.sessions.get(id);
    if (existing) {
      existing.lastActive = Date.now();
      return existing.state;
    }

    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`maximum of ${this.maxSessions} active stage sessions reached`);
    }

    const session = { id, state: new StageState(), lastActive: Date.now() };
    this.sessions.set(id, session);
    return session.state;
  }

  list(): StageSession[] {
    return [...this.sessions.values()].map((session) => ({ ...session }));
  }

  remove(value?: unknown): boolean {
    return this.sessions.delete(stageSessionId(value));
  }
}
