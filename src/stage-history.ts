import type { StageOp } from "./stage-state.js";

export type StageEditState = { manualOps: StageOp[]; enabled: Record<string, boolean> };
export type StageHistoryEntry = {
  index: number;
  label: string;
  timestamp: string;
  snapshot: StageEditState;
  current: boolean;
};
export type StageHistorySummary = Omit<StageHistoryEntry, "snapshot">;
export type StageHistoryPayload = { history: StageHistorySummary[]; index: number };

export function cloneStageEdit(state: StageEditState): StageEditState {
  return structuredClone(state);
}

type HistoryPoint = {
  index: number;
  state: StageEditState;
  label: string;
  timestamp: string;
};

export class StageHistory {
  private states: HistoryPoint[] = [];
  private index = -1;
  private nextIndex = 0;

  record(before: StageEditState, after: StageEditState, label = "Stage edit"): boolean {
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    const action = label.trim() || "Stage edit";
    if (this.index < 0) {
      this.states = [this.point(before, "Initial state")];
      this.index = 0;
    } else {
      this.states = this.states.slice(0, this.index + 1);
      if (JSON.stringify(this.states[this.index].state) !== JSON.stringify(before)) {
        this.states.push(this.point(before, "External state"));
        this.index += 1;
      }
    }
    this.states.push(this.point(after, action));
    this.index += 1;
    if (this.states.length > 50) {
      this.states.shift();
      this.index -= 1;
    }
    return true;
  }

  move(direction: -1 | 1): StageEditState | null {
    const next = this.index + direction;
    if (next < 0 || next >= this.states.length) return null;
    this.index = next;
    return cloneStageEdit(this.states[this.index].state);
  }

  jump(index: number): StageEditState | null {
    if (!Number.isInteger(index) || index < 0) return null;
    const position = this.states.findIndex((point) => point.index === index);
    if (position < 0) return null;
    this.index = position;
    return cloneStageEdit(this.states[this.index].state);
  }

  currentIndex(): number {
    return this.index < 0 ? -1 : this.states[this.index].index;
  }

  list(): StageHistoryEntry[] {
    return this.states.map((point, position) => ({
      index: point.index,
      label: point.label,
      timestamp: point.timestamp,
      snapshot: cloneStageEdit(point.state),
      current: position === this.index,
    }));
  }

  serialize(): StageHistoryPayload {
    return {
      history: this.states.map((point, position) => ({
        index: point.index,
        label: point.label,
        timestamp: point.timestamp,
        current: position === this.index,
      })),
      index: this.currentIndex(),
    };
  }

  private point(state: StageEditState, label: string): HistoryPoint {
    return { index: this.nextIndex++, state: cloneStageEdit(state), label, timestamp: new Date().toISOString() };
  }
}
