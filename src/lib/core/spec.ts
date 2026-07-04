/**
 * Domain Zod schemas. ProjectSpec is what intake extracts from messy text;
 * WorkflowPlan/PhaseResult shape the runner's inputs and outputs.
 * PURE MODULE — no Next/DB/SDK imports.
 */
import { z } from "zod";

export const ProjectSpecSchema = z.object({
  title: z
    .string()
    .describe("Short human-readable project title, max ~8 words"),
  goal: z.string().describe("One-paragraph statement of what the user wants"),
  deliverables: z
    .array(z.string())
    .describe("Concrete outputs the project must produce"),
  constraints: z
    .array(z.string())
    .describe("Hard requirements: tone, length, format, scope limits"),
  success_criteria: z
    .array(z.string())
    .describe("How we know the deliverable is good enough"),
  assumptions: z
    .array(z.string())
    .describe("Things we assumed because the request did not say"),
  blocking_questions: z
    .array(z.string())
    .describe(
      "Questions that materially change the output if answered differently. Empty if none.",
    ),
});

export type ProjectSpec = z.infer<typeof ProjectSpecSchema>;

export const PhaseTypeSchema = z.enum([
  "spec_extraction",
  "planning",
  "research_gather", // [P3]
  "synthesis_draft",
  "implement_code", // [P3]
  "debug_fix", // [P3]
  "xlsx_build", // [P3]
  "summarize_digest",
  "critique", // [P4]
  "revision", // [P2]
]);

export type PhaseType = z.infer<typeof PhaseTypeSchema>;

export const WorkflowPlanSchema = z.object({
  template: z.enum(["research"]), // 'build' | 'analyze' arrive in P3
  phases: z.array(
    z.object({
      idx: z.number().int().nonnegative(),
      name: z.string(),
      phase_type: PhaseTypeSchema,
    }),
  ),
});

export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>;

export const PhaseResultSchema = z.object({
  output_summary: z.string(),
  artifact: z
    .object({
      kind: z.enum(["report"]),
      filename: z.string(),
      content: z.string(),
    })
    .nullable(),
});

export type PhaseResult = z.infer<typeof PhaseResultSchema>;

/** The hardcoded Phase 1 Research workflow. */
export const RESEARCH_WORKFLOW: WorkflowPlan = {
  template: "research",
  phases: [
    { idx: 0, name: "Outline", phase_type: "planning" },
    { idx: 1, name: "Draft report", phase_type: "synthesis_draft" },
  ],
};
