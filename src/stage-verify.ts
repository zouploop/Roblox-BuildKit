import { compareStageGeometry, scanStageIssues, type SeamIssue } from "../viewer/seam-qa.js";
import type { StageCameraAngle, StageCaptureOptions } from "./stage-render.js";
import type { StageOp } from "./stage-state.js";

type StageIssueReport = ReturnType<typeof scanStageIssues>;
type StageParityReport = ReturnType<typeof compareStageGeometry>;
type StageDump = Parameters<typeof compareStageGeometry>[1];

export type StageVerifyRequest = {
  session: string;
  ops: readonly StageOp[];
  errors?: readonly string[];
  details?: boolean;
  scanOptions?: Parameters<typeof scanStageIssues>[1];
  render?: {
    angles?: StageCameraAngle[];
    options?: StageCaptureOptions;
  };
  parity?: {
    target: string;
    tolerance?: number;
  };
};

export type StageVerifyDeps = {
  getRevision: () => number;
  scan?: (ops: readonly StageOp[], options?: Parameters<typeof scanStageIssues>[1]) => StageIssueReport;
  compare?: (ops: readonly StageOp[], dump: StageDump, tolerance?: number) => StageParityReport;
  render?: (session: string, angles?: StageCameraAngle[], options?: StageCaptureOptions) => Promise<Buffer[]>;
  readback?: (target: string) => Promise<StageDump>;
};

export type StageVerifySummary = {
  clean: boolean;
  noBlockingErrors: boolean;
  needsReview: boolean;
  visualFidelity: "not-certified";
  stale: boolean;
  revision: number;
  currentRevision: number;
  session: string;
  ops: { total: number };
  errors: { stage: string[]; issues: number; total: number };
  issues: { total: number; shown: number; errors: number; warnings: number };
  coverage: {
    status: string;
    scope: string;
    parts: number;
    unsupportedParts: number;
    pairsChecked: number;
    authoredChecked: number;
    budgetExceeded: boolean;
    resultsTruncated: boolean;
    unsupportedScope: string;
    unchecked: string;
    unsupported?: unknown[];
  };
  reasons: string[];
  issueDetails?: SeamIssue[];
  render?: StageVerifyRenderSummary["render"];
  parity?: StageVerifyParitySummary["parity"];
};

export type StageVerifyRenderSummary = {
  render: {
    count: number;
    revision: number;
    currentRevision: number;
    stale: boolean;
    focusedOpIndex?: number;
  };
};

export type StageVerifyParitySummary = {
  parity: {
    target: string;
    clean: boolean;
    stale: boolean;
    revision: number;
    currentRevision: number;
    coverage: string;
    checked: number;
    unchecked: number;
    issues: number;
    extraParts: number;
    scope: string;
    issueDetails?: unknown[];
    extraPartDetails?: unknown[];
  };
};

export type StageVerifyResult = {
  summary: StageVerifySummary;
  images: Buffer[];
};

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function coverageSummary(report: StageIssueReport, details: boolean) {
  const raw = report.coverage as Record<string, unknown>;
  const unsupported = Array.isArray(raw.unsupported) ? raw.unsupported.slice(0, 25) : undefined;
  return {
    status: raw.status === "complete" ? "complete" : "partial",
    scope: typeof raw.scope === "string" ? raw.scope : "unknown",
    parts: finiteNonNegative(raw.parts),
    unsupportedParts: finiteNonNegative(raw.unsupportedParts),
    pairsChecked: finiteNonNegative(raw.pairsChecked),
    authoredChecked: finiteNonNegative(raw.authoredChecked),
    budgetExceeded: raw.budgetExceeded === true,
    resultsTruncated: raw.resultsTruncated === true,
    unsupportedScope: typeof raw.unchecked === "string"
      ? raw.unchecked
      : "Unsupported geometry and undeclared openings are not certified.",
    unchecked: typeof raw.unchecked === "string" ? raw.unchecked : "coverage is unavailable",
    ...(details && unsupported ? { unsupported } : {}),
  };
}

function paritySummary(
  target: string,
  revision: number,
  currentRevision: number,
  stale: boolean,
  result: StageParityReport,
  details: boolean,
): StageVerifyParitySummary {
  return {
    parity: {
      target,
      clean: !stale && result.clean,
      stale,
      revision,
      currentRevision,
      coverage: result.coverage,
      checked: result.checked,
      unchecked: result.unchecked,
      issues: result.issues.length,
      extraParts: result.extraParts.length,
      scope: result.scope,
      ...(details ? { issueDetails: result.issues.slice(0, 50), extraPartDetails: result.extraParts.slice(0, 50) } : {}),
    },
  };
}

export function summarizeStageVerification(input: {
  session: string;
  revision: number;
  currentRevision: number;
  ops: readonly StageOp[];
  errors?: readonly string[];
  report: StageIssueReport;
  details?: boolean;
  render?: StageVerifyRenderSummary;
  parity?: StageVerifyParitySummary;
}): StageVerifySummary {
  const details = input.details === true;
  const stageErrors = (input.errors ?? []).filter((value): value is string => typeof value === "string" && value.length > 0);
  const issueErrors = input.report.counts.errors;
  const issueWarnings = input.report.counts.warnings;
  const coverage = coverageSummary(input.report, details);
  const stale = input.currentRevision !== input.revision || input.render?.render.stale === true || input.parity?.parity.stale === true;
  const reasons: string[] = [];
  if (input.ops.length === 0) reasons.push("empty-stage");
  if (stageErrors.length) reasons.push("stage-errors");
  if (issueErrors) reasons.push("issue-errors");
  if (issueWarnings) reasons.push("issue-warnings");
  if (coverage.status !== "complete") reasons.push("partial-coverage");
  if (coverage.unsupportedParts > 0) reasons.push("unsupported-coverage");
  if (coverage.budgetExceeded) reasons.push("coverage-budget");
  if (coverage.resultsTruncated) reasons.push("coverage-truncated");
  if (input.render?.render.stale) reasons.push("render-stale");
  if (input.parity?.parity.stale) reasons.push("parity-stale");
  if (input.parity && !input.parity.parity.clean && !input.parity.parity.stale) reasons.push("studio-parity");
  if (stale) reasons.push("revision-changed");
  const noBlockingErrors = stageErrors.length === 0 && issueErrors === 0
    && (!input.parity || (input.parity.parity.issues === 0 && input.parity.parity.extraParts === 0));
  const clean = input.ops.length > 0 && noBlockingErrors && issueWarnings === 0 && !stale && coverage.status === "complete"
    && coverage.unsupportedParts === 0
    && !coverage.budgetExceeded && !coverage.resultsTruncated && (!input.parity || input.parity.parity.clean);
  return {
    clean,
    noBlockingErrors,
    needsReview: !clean,
    visualFidelity: "not-certified",
    stale,
    revision: input.revision,
    currentRevision: input.currentRevision,
    session: input.session,
    ops: { total: input.ops.length },
    errors: { stage: stageErrors, issues: issueErrors, total: stageErrors.length + issueErrors },
    issues: {
      total: input.report.counts.total,
      shown: input.report.counts.shown,
      errors: input.report.counts.errors,
      warnings: input.report.counts.warnings,
    },
    coverage,
    reasons: [...new Set(reasons)],
    ...(details ? { issueDetails: input.report.issues.slice(0, 100) } : {}),
    ...(input.render ?? {}),
    ...(input.parity ?? {}),
  };
}

export async function verifyStage(request: StageVerifyRequest, deps: StageVerifyDeps): Promise<StageVerifyResult> {
  if (!request.session.trim()) throw new Error("session is required");
  if (request.render && !deps.render) throw new Error("Stage render is unavailable");
  if (request.parity && !deps.readback) throw new Error("Studio parity readback is unavailable");
  const scan = deps.scan ?? scanStageIssues;
  const compare = deps.compare ?? compareStageGeometry;
  const revision = deps.getRevision();
  const report = scan(request.ops, request.scanOptions);
  let currentRevision = deps.getRevision();
  let renderSummary: StageVerifyRenderSummary | undefined;
  let paritySummaryValue: StageVerifyParitySummary | undefined;
  const images: Buffer[] = [];

  if (request.render) {
    const captured = await deps.render!(request.session, request.render.angles, request.render.options);
    currentRevision = deps.getRevision();
    const stale = currentRevision !== revision;
    renderSummary = {
      render: {
        count: captured.length,
        revision,
        currentRevision,
        stale,
        ...(request.render.options?.opIndex === undefined ? {} : { focusedOpIndex: request.render.options.opIndex }),
      },
    };
    images.push(...captured);
  }

  if (request.parity) {
    const dump = await deps.readback!(request.parity.target);
    currentRevision = deps.getRevision();
    paritySummaryValue = paritySummary(
      request.parity.target,
      revision,
      currentRevision,
      currentRevision !== revision,
      compare(request.ops, dump, request.parity.tolerance),
      request.details === true,
    );
  }

  currentRevision = deps.getRevision();
  return {
    summary: summarizeStageVerification({
      session: request.session,
      revision,
      currentRevision,
      ops: request.ops,
      errors: request.errors,
      report,
      details: request.details,
      render: renderSummary,
      parity: paritySummaryValue,
    }),
    images,
  };
}
