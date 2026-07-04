import { z } from "zod";

// Spec-as-code. These schemas are the contract between intake, planning,
// the runner, and the UI. Kept free of numeric/string constraints that the
// structured-outputs API doesn't enforce server-side.

export const DeliverableSchema = z.object({
  kind: z.enum(["report", "spreadsheet", "code"]),
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

export const PHASE_TYPES = [
  "spec_extraction",
  "planning",
  "synthesis_outline",
  "synthesis_draft",
  "summarize_digest",
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

export const PhaseResultSchema = z.object({
  output_summary: z.string(),
});

export type PhaseResult = z.infer<typeof PhaseResultSchema>;

/** The hardcoded Phase 1 Research plan. The planner service replaces this in Phase 3. */
export const RESEARCH_PLAN: WorkflowPlan = {
  template: "research",
  phases: [
    { idx: 0, name: "Outline", phase_type: "synthesis_outline" },
    { idx: 1, name: "Draft report", phase_type: "synthesis_draft" },
  ],
};
