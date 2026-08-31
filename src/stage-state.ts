export type StageAction = "build" | "edit";

export type StageOp = {
  action: StageAction;
  args: Record<string, unknown>;
};

export type GenerationState = {
  name: string;
  enabled: boolean;
  ops: StageOp[];
  error?: string;
};

export type StageSnapshot = {
  ops: StageOp[];
  generations: GenerationState[];
  errors: string[];
};

export class StageState {
  private manualOps: StageOp[] = [];
  private generations: GenerationState[] = [];

  setGenerations(next: GenerationState[]) {
    const previous = new Map(this.generations.map((g) => [g.name, g]));
    this.generations = next.map((g) => {
      const prior = previous.get(g.name);
      return {
        name: g.name,
        enabled: prior?.enabled ?? g.enabled,
        ops: [...(g.error && prior ? prior.ops : g.ops)],
        ...(g.error ? { error: g.error } : {}),
      };
    });
  }

  setGenerationEnabled(name: string, value: boolean): boolean {
    const generation = this.generations.find((g) => g.name === name);
    if (!generation) return false;
    generation.enabled = value;
    return true;
  }

  appendManual(ops: StageOp[]) {
    this.manualOps.push(...ops.map((op) => ({ action: op.action, args: { ...op.args } })));
  }

  clearManual() {
    this.manualOps = [];
  }

  getOps(): StageOp[] {
    return [
      ...this.generations.filter((g) => g.enabled).flatMap((g) => g.ops),
      ...this.manualOps,
    ].map((op) => ({ action: op.action, args: { ...op.args } }));
  }

  snapshot(): StageSnapshot {
    const generations = this.generations.map((g) => ({
      name: g.name,
      enabled: g.enabled,
      ops: g.ops.map((op) => ({ action: op.action, args: { ...op.args } })),
      ...(g.error ? { error: g.error } : {}),
    }));
    return {
      ops: this.getOps(),
      generations,
      errors: generations.filter((g) => g.error).map((g) => `${g.name}: ${g.error}`),
    };
  }
}
