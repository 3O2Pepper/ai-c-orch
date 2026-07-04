import { describe, expect, it } from "vitest";
import { ProjectSpecSchema, RESEARCH_PLAN, WorkflowPlanSchema } from "./spec";

describe("ProjectSpecSchema", () => {
  it("accepts a complete spec", () => {
    const spec = ProjectSpecSchema.parse({
      title: "CRM comparison",
      goal: "Compare top CRM tools for a 10-person sales team",
      deliverables: [{ kind: "report", description: "Markdown comparison report" }],
      constraints: ["Focus on pricing"],
      success_criteria: ["Covers at least 5 tools"],
      assumptions: ["US pricing"],
      blocking_questions: [],
    });
    expect(spec.deliverables[0].kind).toBe("report");
  });

  it("rejects non-report deliverable kinds in Phase 1", () => {
    // "spreadsheet" and "code" are [Later] kinds (Phase 3 templates) and
    // must not be selectable before those templates exist.
    for (const kind of ["spreadsheet", "code", "video"]) {
      const result = ProjectSpecSchema.safeParse({
        title: "x",
        goal: "y",
        deliverables: [{ kind, description: "nope" }],
        constraints: [],
        success_criteria: [],
        assumptions: [],
        blocking_questions: [],
      });
      expect(result.success).toBe(false);
    }
  });
});

describe("RESEARCH_PLAN", () => {
  it("is a valid WorkflowPlan with sequential phase indices", () => {
    const plan = WorkflowPlanSchema.parse(RESEARCH_PLAN);
    plan.phases.forEach((p, i) => expect(p.idx).toBe(i));
  });
});
