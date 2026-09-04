import { validateBatchOps } from "./schemas.js";
import { normalizeStageConnections } from "./stage-connections.js";
import type { StageOp } from "./stage-state.js";

export const STAGE_FORMAT = "buildkit-stage" as const;
export const STAGE_VERSION = 1 as const;
export const MAX_STAGE_ITEMS = 5000;

export type StageArtifact = {
  format: typeof STAGE_FORMAT;
  version: typeof STAGE_VERSION;
  name: string;
  created: string;
  ops: StageOp[];
};

export type StageArtifactInput = {
  format?: unknown;
  version?: unknown;
  name: unknown;
  created?: unknown;
  ops: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid .bkstage ${field}: expected a non-empty string`);
  }
  return value;
}

export function validateStageOps(value: unknown, label = ".bkstage"): StageOp[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label} ops: expected an array`);
  }

  const rawOps = value.map((value, index) => {
    if (!isRecord(value) || (value.action !== "build" && value.action !== "edit") || !isRecord(value.args)) {
      throw new Error(`Invalid ${label} op ${index + 1}: expected {action:'build'|'edit',args:{...}}`);
    }
    return { action: value.action, args: { ...value.args } } as StageOp;
  });

  const partCount = rawOps.reduce(
    (total, op) => total + (Array.isArray(op.args.parts) ? op.args.parts.length : 0),
    0,
  );
  if (rawOps.length + partCount > MAX_STAGE_ITEMS) {
    throw new Error(`Invalid ${label} ops: imported ops and parts exceed the ${MAX_STAGE_ITEMS}-item cap`);
  }

  let validated: { action: "build" | "edit"; args: unknown }[];
  try {
    validated = validateBatchOps(rawOps, { validateEdits: false });
  } catch (error) {
    throw new Error(`Invalid ${label} ops: ${error instanceof Error ? error.message : String(error)}`);
  }

  return normalizeStageConnections(validated.map((op, index) => {
    if (!isRecord(op.args)) {
      throw new Error(`Invalid ${label} op ${index + 1}: args must be an object`);
    }
    return { action: op.action, args: { ...op.args } };
  }));
}

export function validateStageArtifact(value: unknown): StageArtifact {
  if (!isRecord(value)) {
    throw new Error("Invalid .bkstage data: expected an object");
  }
  if (value.format !== STAGE_FORMAT) {
    throw new Error(`Unsupported .bkstage format: ${String(value.format)}`);
  }
  if (value.version !== STAGE_VERSION) {
    throw new Error(`Unsupported .bkstage version: ${String(value.version)}`);
  }

  return {
    format: STAGE_FORMAT,
    version: STAGE_VERSION,
    name: readString(value.name, "name"),
    created: readString(value.created, "created"),
    ops: validateStageOps(value.ops),
  };
}

export function encodeStageArtifact(input: StageArtifactInput): string;
export function encodeStageArtifact(name: string, ops: unknown, created?: string): string;
export function encodeStageArtifact(
  inputOrName: StageArtifactInput | string,
  ops?: unknown,
  created?: string,
): string {
  const input: StageArtifactInput =
    typeof inputOrName === "string"
      ? { name: inputOrName, ops, created }
      : inputOrName;
  const artifact = validateStageArtifact({
    format: input.format ?? STAGE_FORMAT,
    version: input.version ?? STAGE_VERSION,
    name: input.name,
    created: input.created ?? new Date().toISOString(),
    ops: input.ops,
  });
  return JSON.stringify(artifact);
}

export function decodeStageArtifact(serialized: string): StageArtifact;
export function decodeStageArtifact(data: unknown): StageArtifact;
export function decodeStageArtifact(serializedOrData: string | unknown): StageArtifact {
  let data: unknown = serializedOrData;
  if (typeof serializedOrData === "string") {
    try {
      data = JSON.parse(serializedOrData);
    } catch (error) {
      throw new Error(`Invalid .bkstage JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return validateStageArtifact(data);
}
