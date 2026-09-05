import type { StageOp } from "./stage-state.js";
import { validateStageOps } from "./stage-share.js";

export const STAGE_COMMIT_MODES = ["append", "update-existing"] as const;
export type StageCommitMode = (typeof STAGE_COMMIT_MODES)[number];

export type StageCommitOptions = {
  mode: StageCommitMode;
  buildId: string;
  rootName?: string;
};

export type StageCommitRequest = StageCommitOptions & {
  ops: StageOp[];
};

const STABLE_BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_ROOT_NAME_LENGTH = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateStageCommitOptions(value: unknown): StageCommitOptions {
  if (!isRecord(value)) throw new Error("stage commit options must be an object");
  if (!STAGE_COMMIT_MODES.includes(value.mode as StageCommitMode)) {
    throw new Error("stage commit mode must be 'append' or 'update-existing'");
  }
  if (typeof value.buildId !== "string" || !STABLE_BUILD_ID.test(value.buildId)) {
    throw new Error("stage commit buildId must be 1-64 letters, numbers, underscores, or hyphens");
  }

  let rootName: string | undefined;
  if (value.rootName !== undefined) {
    if (typeof value.rootName !== "string") throw new Error("stage commit rootName must be a string");
    rootName = value.rootName.trim();
    if (!rootName || rootName.length > MAX_ROOT_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(rootName)) {
      throw new Error("stage commit rootName must be 1-100 printable characters");
    }
  }

  return { mode: value.mode as StageCommitMode, buildId: value.buildId, ...(rootName ? { rootName } : {}) };
}

export function prepareStageCommit(ops: unknown, options: unknown): StageCommitRequest {
  const prepared = validateStageCommitOptions(options);
  const validated = validateStageOps(ops, "stage commit");
  if (validated.length === 0) throw new Error("stage commit needs a non-empty ops array");

  const unsupported = validated.findIndex((op) => op.action !== "build");
  if (unsupported >= 0) {
    throw new Error(`stage commit op ${unsupported + 1}: ${validated[unsupported].action} is unsupported; commit build ops only`);
  }

  return { ...prepared, ops: structuredClone(validated) };
}

export function validateStageCommitRequest(value: unknown): StageCommitRequest {
  if (!isRecord(value)) throw new Error("stage commit request must be an object");
  return prepareStageCommit(value.ops, value);
}
