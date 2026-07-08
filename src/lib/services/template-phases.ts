import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  CodeArtifactSchema,
  PlanValidationError,
  PlannedPhasesSchema,
  TEMPLATE_ALLOWED_PHASES,
  validatePlannedPhases,
  type GatherNotes,
  type PhaseType,
  type PlannedPhases,
  type ProjectSpec,
  type WorkflowTemplate,
} from "@/lib/core/spec";
import { getDb } from "@/lib/db/client";
import { artifacts, messages, phases } from "@/lib/db/schema";
import { generateObject, generateText } from "@/lib/gateway";
import {
  ANALYSIS_DRAFT_SYSTEM,
  analysisDraftPrompt,
  IMPLEMENT_SYSTEM,
  implementPrompt,
  PLANNER_SYSTEM,
  plannerPrompt,
  XLSX_SCRIPT_SYSTEM,
  xlsxScriptPrompt,
} from "@/lib/prompts/templates";
import { runPythonInSandbox, sandboxConfigured } from "@/lib/sandbox";
import { storageConfigured } from "@/lib/storage";
import { storeArtifactBinary } from "./artifacts";
import { assembleContext, CONTEXT_BUDGET_TOKENS, recordArtifactDigest } from "./context";
import { appendEvent } from "./events";
import {
  findArtifactVersion,
  slugify,
  writeTextArtifact,
} from "./phases";
import { resolveRoute } from "./router";
import { applyPhaseTransition } from "./state";

// Build/Analyze template execution (P3). Same replay-safety contract as
// phases.ts: persisted outputs, tolerated transitions, one artifact per
// phase. The planner's output is DATA validated against hard guardrails —
// it parameterizes the workflow, it never becomes instructions.

/** Phase types the current environment can actually execute. */
export function availablePhaseTypes(): PhaseType[] {
  const all: PhaseType[] = ["research_gather", "draft", "implement_code"];
  // xlsx needs BOTH the sandbox (to run the build script) and object
  // storage (binary artifacts have no inline path).
  if (sandboxConfigured() && storageConfigured()) all.push("xlsx_build");
  return all;
}

export interface PlannedPhaseRow {
  phaseId: string;
  idx: number;
  name: string;
  phaseType: PhaseType;
  objective: string;
}

const XLSX_DEGRADATION_NOTE =
  "This environment cannot produce .xlsx files (code sandbox and/or object " +
  "storage are not configured). Deliver the analysis as a markdown report " +
  "with data tables instead.";

async function phaseRows(projectId: string) {
  return getDb()
    .select()
    .from(phases)
    .where(eq(phases.projectId, projectId))
    .orderBy(asc(phases.idx));
}

/**
 * Planning phase: materialize the planning row, run the planner (Opus),
 * validate hard, then materialize the planned phase rows. Fully replay-safe
 * — a re-run reuses the persisted plan and existing rows.
 */
export async function runPlanningPhase(
  projectId: string,
  template: Exclude<WorkflowTemplate, "research">,
  spec: ProjectSpec,
): Promise<{ phases: PlannedPhaseRow[] }> {
  const db = getDb();

  // Materialize (or find) the planning phase row.
  let rows = await phaseRows(projectId);
  let planning = rows.find((r) => r.phaseType === "planning");
  if (!planning) {
    [planning] = await db
      .insert(phases)
      .values({
        projectId,
        idx: 0,
        name: "Plan workflow",
        phaseType: "planning",
        state: "pending",
      })
      .returning();
  }

  // Replay guard: plan already produced — rebuild the row list from the DB.
  if (planning.state === "done" && planning.output) {
    const planned = PlannedPhasesSchema.parse(planning.output);
    rows = await phaseRows(projectId);
    return { phases: toPlannedRows(rows, planned) };
  }

  const available = availablePhaseTypes();
  const allowed = TEMPLATE_ALLOWED_PHASES[template].filter((t) =>
    available.includes(t),
  );
  const degraded =
    template === "analyze" && !allowed.includes("xlsx_build")
      ? XLSX_DEGRADATION_NOTE
      : null;

  if (planning.state === "pending") {
    await applyPhaseTransition(projectId, planning.id, "pending", {
      type: "phase_started",
    });
  }

  const route = await resolveRoute("planning");
  const call = (extraNote: string | null) =>
    generateObject({
      projectId,
      phaseId: planning.id,
      purpose: "planning",
      model: route.model,
      system: PLANNER_SYSTEM,
      prompt:
        plannerPrompt(template, spec, allowed, degraded) +
        (extraNote ? `\n\nPrevious attempt was rejected: ${extraNote}` : ""),
      schema: PlannedPhasesSchema,
      maxTokens: route.maxTokens,
      effort: route.effort,
      fallbackModel: route.fallbackModel,
    });

  // Semantic guardrails get ONE feedback retry (schema validity itself is
  // server-enforced, PLAN §0.4 — this is plan-shape validation on top).
  let planned: PlannedPhases;
  try {
    planned = (await call(null)).object;
    validatePlannedPhases(template, planned, available);
  } catch (err) {
    if (!(err instanceof PlanValidationError)) throw err;
    planned = (await call(err.message)).object;
    validatePlannedPhases(template, planned, available);
  }

  if (degraded) {
    await db.insert(messages).values({
      projectId,
      role: "system",
      content:
        "Spreadsheet output is unavailable in this environment (sandbox/object " +
        "storage not configured) — delivering the analysis as a markdown report.",
    });
    await appendEvent(projectId, "capability_degraded", {
      wanted: "xlsx_build",
      reason: "sandbox/storage not configured",
    });
  }

  // Materialize planned phase rows (idx 1..n), idempotent by (project, idx).
  const existing = await phaseRows(projectId);
  for (const [i, p] of planned.phases.entries()) {
    const idx = i + 1;
    if (existing.some((r) => r.idx === idx)) continue;
    await db.insert(phases).values({
      projectId,
      idx,
      name: p.name,
      phaseType: p.phase_type,
      state: "pending",
      input: { objective: p.objective },
    });
  }

  await db
    .update(phases)
    .set({
      output: planned,
      outputSummary:
        `Planned ${planned.phases.length} phases: ` +
        planned.phases.map((p) => p.name).join(" → "),
      modelUsed: route.model,
      attempts: sql`${phases.attempts} + 1`,
    })
    .where(eq(phases.id, planning.id));
  await applyPhaseTransition(projectId, planning.id, "running", {
    type: "phase_done",
  });

  const finalRows = await phaseRows(projectId);
  return { phases: toPlannedRows(finalRows, planned) };
}

function toPlannedRows(
  rows: (typeof phases.$inferSelect)[],
  planned: PlannedPhases,
): PlannedPhaseRow[] {
  return planned.phases.map((p, i) => {
    const idx = i + 1;
    const row = rows.find((r) => r.idx === idx);
    if (!row) throw new Error(`Planned phase row idx ${idx} missing`);
    return {
      phaseId: row.id,
      idx,
      name: row.name,
      phaseType: row.phaseType as PhaseType,
      objective:
        (row.input as { objective?: string } | null)?.objective ?? p.objective,
    };
  });
}

/** Tolerate replayed transitions the same way phases.ts does. */
async function startPhase(projectId: string, phaseId: string): Promise<void> {
  const [row] = await getDb().select().from(phases).where(eq(phases.id, phaseId));
  if (row?.state === "pending") {
    await applyPhaseTransition(projectId, phaseId, "pending", {
      type: "phase_started",
    });
  }
}

async function finishPhase(
  projectId: string,
  phaseId: string,
  summary: string,
  model: string,
  output?: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db
    .update(phases)
    .set({
      ...(output ? { output } : {}),
      outputSummary: summary,
      modelUsed: model,
      attempts: sql`${phases.attempts} + 1`,
    })
    .where(eq(phases.id, phaseId));
  await applyPhaseTransition(projectId, phaseId, "running", { type: "phase_done" });
}

const SANDBOX_SKIP_NOTE =
  "Code was generated but NOT executed: the sandbox (E2B_API_KEY) is not " +
  "configured. Treat the artifact as unverified.";

/** implement_code: one self-contained file, smoke-run when the sandbox exists. */
export async function runImplementPhase(
  projectId: string,
  phaseId: string,
  spec: ProjectSpec,
  objective: string,
  gather: GatherNotes | null,
): Promise<{ artifactVersion: number }> {
  const db = getDb();
  const route = await resolveRoute("implement_code");

  const already = await findArtifactVersion(phaseId);
  if (already !== null) return { artifactVersion: already };

  await startPhase(projectId, phaseId);
  const context = await assembleContext(projectId, CONTEXT_BUDGET_TOKENS);
  const result = await generateObject({
    projectId,
    phaseId,
    purpose: "implement_code",
    model: route.model,
    system: IMPLEMENT_SYSTEM,
    prompt: implementPrompt(objective, gather, context),
    schema: CodeArtifactSchema,
    maxTokens: route.maxTokens,
    effort: route.effort,
    fallbackModel: route.fallbackModel,
  });
  const artifact = result.object;

  // Model-chosen filename is data — sanitize to a safe basename.
  const safeName =
    artifact.filename.toLowerCase().replace(/[^a-z0-9._-]/g, "").split("/").pop() ||
    "main.py";

  const version = await writeTextArtifact(
    projectId,
    phaseId,
    artifact.code,
    result.costUsd,
    { kind: "code", filename: safeName },
  );

  // Verification (P3 level): smoke-run python in the sandbox when
  // available; anything else is recorded as not-run, never faked.
  let verification: Record<string, unknown>;
  if (artifact.language.toLowerCase() === "python" && sandboxConfigured()) {
    const run = await runPythonInSandbox({ code: artifact.code });
    verification = {
      ran: true,
      ok: run.ok,
      stdout: run.stdout.slice(-2000),
      stderr: run.stderr.slice(-2000),
      error: run.error,
    };
  } else {
    const reason = sandboxConfigured()
      ? `no sandbox runner for language '${artifact.language}'`
      : "sandbox not configured";
    verification = { ran: false, reason };
    if (!sandboxConfigured()) {
      await db.insert(messages).values({
        projectId,
        role: "system",
        content: SANDBOX_SKIP_NOTE,
      });
      await appendEvent(projectId, "capability_degraded", {
        wanted: "sandbox_run",
        reason: "E2B_API_KEY not configured",
      });
    }
  }
  await db
    .update(artifacts)
    .set({ verification })
    .where(eq(artifacts.phaseId, phaseId));

  await finishPhase(
    projectId,
    phaseId,
    `Implemented ${safeName} (${artifact.language}); ` +
      (verification.ran
        ? `sandbox run ${verification.ok ? "passed" : "FAILED"}`
        : "not executed"),
    route.model,
    { usage_notes: artifact.usage_notes },
  );
  return { artifactVersion: version };
}

/** Analyze template's report phase — findings + data tables, no outline. */
export async function runAnalysisDraftPhase(
  projectId: string,
  phaseId: string,
  spec: ProjectSpec,
  objective: string,
  gather: GatherNotes | null,
): Promise<{ artifactVersion: number }> {
  const route = await resolveRoute("draft");

  const already = await findArtifactVersion(phaseId);
  if (already !== null) return { artifactVersion: already };

  await startPhase(projectId, phaseId);
  const context = await assembleContext(projectId, CONTEXT_BUDGET_TOKENS);
  const result = await generateText({
    projectId,
    phaseId,
    purpose: "analysis_draft",
    model: route.model,
    system: ANALYSIS_DRAFT_SYSTEM,
    prompt: analysisDraftPrompt(objective, gather, context),
    maxTokens: route.maxTokens,
    effort: route.effort,
    fallbackModel: route.fallbackModel,
  });

  const version = await writeTextArtifact(projectId, phaseId, result.text, result.costUsd, {
    kind: "report",
    filename: `${slugify(spec.title)}.md`,
  });
  await finishPhase(
    projectId,
    phaseId,
    `Drafted analysis (${result.text.length} chars)`,
    route.model,
  );
  return { artifactVersion: version };
}

const XLSX_OUTPUT_PATH = "/home/user/output.xlsx";

/**
 * xlsx_build: model writes a Python build script, the sandbox runs it,
 * the workbook lands in object storage. Requires BOTH seams configured —
 * the planner never emits this phase otherwise.
 */
export async function runXlsxBuildPhase(
  projectId: string,
  phaseId: string,
  spec: ProjectSpec,
  objective: string,
  gather: GatherNotes | null,
  revisionInstructions?: string | null,
): Promise<{ artifactVersion: number }> {
  if (!sandboxConfigured() || !storageConfigured()) {
    throw new Error(
      "xlsx_build requires the sandbox (E2B_API_KEY) and object storage (R2_*) — " +
        "the planner should not have emitted this phase",
    );
  }
  const db = getDb();
  const route = await resolveRoute("xlsx_build");

  const already = await findArtifactVersion(phaseId);
  if (already !== null) return { artifactVersion: already };

  await startPhase(projectId, phaseId);
  const context = await assembleContext(projectId, CONTEXT_BUDGET_TOKENS);
  const result = await generateObject({
    projectId,
    phaseId,
    purpose: "xlsx_build",
    model: route.model,
    system: XLSX_SCRIPT_SYSTEM,
    prompt: xlsxScriptPrompt(objective, gather, context, revisionInstructions),
    schema: CodeArtifactSchema,
    maxTokens: route.maxTokens,
    effort: route.effort,
    fallbackModel: route.fallbackModel,
  });
  const script = result.object;

  const run = await runPythonInSandbox({
    code: script.code,
    collectFiles: [XLSX_OUTPUT_PATH],
  });
  const workbook = run.files.find((f) => f.path === XLSX_OUTPUT_PATH);
  if (!run.ok || !workbook) {
    throw new Error(
      `xlsx build script failed: ${run.error ?? "no output.xlsx produced"}\n` +
        run.stderr.slice(-2000),
    );
  }

  const filename = `${slugify(spec.title)}.xlsx`;
  const [latest] = await db
    .select({ version: artifacts.version })
    .from(artifacts)
    .where(eq(artifacts.projectId, projectId))
    .orderBy(desc(artifacts.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  const stored = await storeArtifactBinary(
    projectId,
    filename,
    version,
    Buffer.from(workbook.contentBase64, "base64"),
  );
  const [artifact] = await db
    .insert(artifacts)
    .values({
      projectId,
      phaseId,
      kind: "spreadsheet",
      filename,
      content: null,
      storageKey: stored.storageKey,
      version,
      digest: script.usage_notes,
      verification: {
        ran: true,
        ok: true,
        stdout: run.stdout.slice(-2000),
      },
    })
    .onConflictDoNothing()
    .returning({ id: artifacts.id });
  if (!artifact) {
    const v = await findArtifactVersion(phaseId);
    if (v !== null) return { artifactVersion: v };
    throw new Error(`Artifact insert for phase ${phaseId} conflicted but none found`);
  }
  await recordArtifactDigest(projectId, artifact.id, script.usage_notes);
  await appendEvent(projectId, "artifact_created", {
    artifactId: artifact.id,
    filename,
    kind: "spreadsheet",
    version,
    costUsd: result.costUsd,
  });

  // The build script itself is auditable via phase output.
  await finishPhase(projectId, phaseId, `Built ${filename}`, route.model, {
    script: script.code,
  });
  return { artifactVersion: version };
}

/** Latest artifact row — the revision router needs its kind. */
export async function latestArtifact(projectId: string) {
  const [row] = await getDb()
    .select()
    .from(artifacts)
    .where(eq(artifacts.projectId, projectId))
    .orderBy(desc(artifacts.version))
    .limit(1);
  return row ?? null;
}

/** Find a planned phase row by type (revision needs the xlsx objective). */
export async function findPhaseByType(projectId: string, phaseType: PhaseType) {
  const [row] = await getDb()
    .select()
    .from(phases)
    .where(and(eq(phases.projectId, projectId), eq(phases.phaseType, phaseType)))
    .orderBy(asc(phases.idx))
    .limit(1);
  return row ?? null;
}
