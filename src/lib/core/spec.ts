import { z } from "zod";

// Spec-as-code. These schemas are the contract between intake, planning,
// the runner, and the UI. Kept free of numeric/string constraints that the
// structured-outputs API doesn't enforce server-side.

// Phase 3 unlocked "spreadsheet" (Analyze template) and "code" (Build
// template) alongside Phase 1's "report".
export const DELIVERABLE_KINDS = ["report", "spreadsheet", "code"] as const;

export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

export const DeliverableSchema = z.object({
  kind: z.enum(DELIVERABLE_KINDS),
  description: z.string(),
});

export const ProjectSpecSchema = z.object({
  title: z.string().describe("Short project title, max ~8 words"),
  goal: z.string().describe("One-paragraph restatement of what the user wants"),
  deliverables: z.array(DeliverableSchema),
  constraints: z.array(z.string()),
  success_criteria: z.array(z.string()),
  assumptions: z
    .array(z.string())
    .describe("Non-blocking ambiguities resolved by assumption, recorded for review"),
  blocking_questions: z
    .array(z.string())
    .describe("At most 3 questions whose answers materially change the deliverable"),
});

export type ProjectSpec = z.infer<typeof ProjectSpecSchema>;

// Phase types, aligned with PLAN.md §6. Phase 2 added "revision"; Phase 3
// added "planning" (LLM-parameterized plans), "research_gather" (web
// search), and the sandbox-backed "implement_code" / "xlsx_build".
// [Later: P4] critique.
export const PHASE_TYPES = [
  "spec_extraction",
  "planning",
  "outline",
  "research_gather",
  "draft",
  "implement_code",
  "xlsx_build",
  "digest",
  "revision",
] as const;

export type PhaseType = (typeof PHASE_TYPES)[number];

export const WORKFLOW_TEMPLATES = ["research", "build", "analyze"] as const;

export type WorkflowTemplate = (typeof WORKFLOW_TEMPLATES)[number];

/** Deliverable kind -> template. First deliverable decides (intake maps every request onto >=1). */
export function templateForDeliverable(kind: DeliverableKind): WorkflowTemplate {
  switch (kind) {
    case "report":
      return "research";
    case "code":
      return "build";
    case "spreadsheet":
      return "analyze";
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled deliverable kind: ${exhaustive}`);
    }
  }
}

export const WorkflowPlanSchema = z.object({
  template: z.enum(WORKFLOW_TEMPLATES),
  phases: z.array(
    z.object({
      idx: z.number().int(),
      name: z.string(),
      phase_type: z.enum(PHASE_TYPES),
    }),
  ),
});

export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>;

export const OutlineSchema = z.object({
  sections: z.array(
    z.object({
      heading: z.string(),
      notes: z.string().describe("What this section must cover"),
    }),
  ),
  blocking_question: z
    .object({
      question: z.string(),
      recommended_default: z
        .string()
        .describe("The answer to proceed with if the user does not respond"),
    })
    .nullable()
    .describe(
      "ONLY when a material ambiguity would change the report's structure or " +
        "conclusions AND no reasonable assumption exists. Null for most projects.",
    ),
});

export type Outline = z.infer<typeof OutlineSchema>;

export const PhaseResultSchema = z.object({
  output_summary: z.string(),
});

export type PhaseResult = z.infer<typeof PhaseResultSchema>;

/** Output of a research_gather phase, persisted in phases.output. */
export const GatherNotesSchema = z.object({
  notes: z.string(),
  sources: z.array(z.object({ url: z.string(), title: z.string() })),
});

export type GatherNotes = z.infer<typeof GatherNotesSchema>;

/**
 * The fixed Research plan. Phase 3 added the web-search gather phase in
 * front of the stable Phase 2 outline -> draft flow; projects created
 * before P3 have no gather row and the workflow skips the step for them.
 * Build/Analyze plans are planner-generated instead.
 */
export const RESEARCH_PLAN: WorkflowPlan = {
  template: "research",
  phases: [
    { idx: 0, name: "Gather sources", phase_type: "research_gather" },
    { idx: 1, name: "Outline", phase_type: "outline" },
    { idx: 2, name: "Draft report", phase_type: "draft" },
  ],
};

// ---- Planner (Phase 3) ------------------------------------------------

/**
 * Phase types the planner may emit per template. The planner LLM is
 * constrained to these both in its schema-enforced output AND by hard
 * validation after the call — a plan is data, never instructions.
 * "planning" itself is excluded: it is the planner call, materialized as
 * its own phase row by the workflow, not something a plan can contain.
 */
export const TEMPLATE_ALLOWED_PHASES: Record<
  Exclude<WorkflowTemplate, "research">,
  readonly PhaseType[]
> = {
  build: ["research_gather", "implement_code"],
  analyze: ["research_gather", "draft", "xlsx_build"],
};

/** Phase types that produce the run's deliverable artifact. */
export const ARTIFACT_PHASE_TYPES: readonly PhaseType[] = [
  "draft",
  "implement_code",
  "xlsx_build",
];

export const PlannedPhasesSchema = z.object({
  phases: z
    .array(
      z.object({
        name: z.string().describe("Short human-readable phase name"),
        phase_type: z.enum(PHASE_TYPES),
        objective: z.string().describe("One sentence: what this phase must produce"),
      }),
    )
    .describe("2-5 phases, in execution order, ending with the artifact-producing phase"),
});

export type PlannedPhases = z.infer<typeof PlannedPhasesSchema>;

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

/**
 * Hard guardrails on a planner-produced plan. Throws PlanValidationError.
 * `availablePhaseTypes` lets the caller subtract capability-gated phases
 * (e.g. xlsx_build requires the sandbox + object storage to be configured).
 */
export function validatePlannedPhases(
  template: Exclude<WorkflowTemplate, "research">,
  planned: PlannedPhases,
  availablePhaseTypes: readonly PhaseType[],
): void {
  const allowed = TEMPLATE_ALLOWED_PHASES[template].filter((t) =>
    availablePhaseTypes.includes(t),
  );
  const { phases } = planned;
  if (phases.length < 1 || phases.length > 5) {
    throw new PlanValidationError(`Plan must have 1-5 phases, got ${phases.length}`);
  }
  for (const p of phases) {
    if (!allowed.includes(p.phase_type)) {
      throw new PlanValidationError(
        `Phase type '${p.phase_type}' is not allowed for the ${template} template`,
      );
    }
  }
  const last = phases[phases.length - 1];
  if (!ARTIFACT_PHASE_TYPES.includes(last.phase_type)) {
    throw new PlanValidationError(
      `Plan must end with an artifact-producing phase, got '${last.phase_type}'`,
    );
  }
  const artifactCount = phases.filter((p) =>
    ARTIFACT_PHASE_TYPES.includes(p.phase_type),
  ).length;
  if (artifactCount !== 1) {
    throw new PlanValidationError(
      `Plan must contain exactly one artifact-producing phase, got ${artifactCount}`,
    );
  }
}
