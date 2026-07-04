import { z } from "zod";

// Spec-as-code. These schemas are the contract between intake, planning,
// the runner, and the UI. Kept free of numeric/string constraints that the
// structured-outputs API doesn't enforce server-side.

// Phase 1 produces markdown research reports ONLY. "spreadsheet" and "code"
// are [Later] deliverable kinds (Phase 3 Analyze/Build templates) — they are
// deliberately excluded from the schema so neither the intake model (the
// structured-outputs schema is enforced server-side) nor a user edit can
// select them before the templates exist.
export const DELIVERABLE_KINDS = ["report"] as const;
export const LATER_DELIVERABLE_KINDS = ["spreadsheet", "code"] as const; // [Later: P3]

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

// Phase types, aligned with PLAN.md §6. Phase 2 added "revision" (the
// review-gate loop). Multi-template types (planning, research_gather,
// implement_code, critique, ...) arrive with their templates in Phases 3-4.
export const PHASE_TYPES = [
  "spec_extraction",
  "outline",
  "draft",
  "digest",
  "revision",
] as const;

export type PhaseType = (typeof PHASE_TYPES)[number];

export const WorkflowPlanSchema = z.object({
  template: z.literal("research"),
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

/** The hardcoded Phase 1 Research plan. The planner service replaces this in Phase 3. */
export const RESEARCH_PLAN: WorkflowPlan = {
  template: "research",
  phases: [
    { idx: 0, name: "Outline", phase_type: "outline" },
    { idx: 1, name: "Draft report", phase_type: "draft" },
  ],
};
