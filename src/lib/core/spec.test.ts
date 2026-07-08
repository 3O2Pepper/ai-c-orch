import { describe, expect, it } from "vitest";
import {
  PlanValidationError,
  ProjectSpecSchema,
  RESEARCH_PLAN,
  templateForDeliverable,
  validatePlannedPhases,
  WorkflowPlanSchema,
  type PlannedPhases,
} from "./spec";

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

  it("accepts the Phase 3 deliverable kinds and rejects unknown ones", () => {
    for (const kind of ["report", "spreadsheet", "code"]) {
      const result = ProjectSpecSchema.safeParse({
        title: "x",
        goal: "y",
        deliverables: [{ kind, description: "d" }],
        constraints: [],
        success_criteria: [],
        assumptions: [],
        blocking_questions: [],
      });
      expect(result.success).toBe(true);
    }
    const bad = ProjectSpecSchema.safeParse({
      title: "x",
      goal: "y",
      deliverables: [{ kind: "video", description: "nope" }],
      constraints: [],
      success_criteria: [],
      assumptions: [],
      blocking_questions: [],
    });
    expect(bad.success).toBe(false);
  });
});

describe("templateForDeliverable", () => {
  it("maps every deliverable kind to a template", () => {
    expect(templateForDeliverable("report")).toBe("research");
    expect(templateForDeliverable("code")).toBe("build");
    expect(templateForDeliverable("spreadsheet")).toBe("analyze");
  });
});

describe("RESEARCH_PLAN", () => {
  it("is a valid WorkflowPlan with sequential phase indices", () => {
    const plan = WorkflowPlanSchema.parse(RESEARCH_PLAN);
    plan.phases.forEach((p, i) => expect(p.idx).toBe(i));
  });

  it("gathers before outlining before drafting", () => {
    expect(RESEARCH_PLAN.phases.map((p) => p.phase_type)).toEqual([
      "research_gather",
      "outline",
      "draft",
    ]);
  });
});

describe("validatePlannedPhases", () => {
  const ALL = ["research_gather", "draft", "implement_code", "xlsx_build"] as const;

  const planned = (types: string[]): PlannedPhases => ({
    phases: types.map((t, i) => ({
      name: `Phase ${i}`,
      phase_type: t as PlannedPhases["phases"][number]["phase_type"],
      objective: "obj",
    })),
  });

  it("accepts a valid build plan", () => {
    expect(() =>
      validatePlannedPhases("build", planned(["research_gather", "implement_code"]), ALL),
    ).not.toThrow();
  });

  it("accepts a valid analyze plan", () => {
    expect(() =>
      validatePlannedPhases("analyze", planned(["research_gather", "draft"]), ALL),
    ).not.toThrow();
  });

  it("rejects phase types outside the template's allowlist", () => {
    expect(() =>
      validatePlannedPhases("build", planned(["outline", "implement_code"]), ALL),
    ).toThrow(PlanValidationError);
    // xlsx_build belongs to analyze, not build
    expect(() =>
      validatePlannedPhases("build", planned(["xlsx_build"]), ALL),
    ).toThrow(PlanValidationError);
  });

  it("rejects capability-gated phases when unavailable", () => {
    // Without sandbox+storage, xlsx_build is not available
    const withoutXlsx = ["research_gather", "draft"] as const;
    expect(() =>
      validatePlannedPhases("analyze", planned(["research_gather", "xlsx_build"]), withoutXlsx),
    ).toThrow(PlanValidationError);
  });

  it("rejects plans that do not end with an artifact-producing phase", () => {
    expect(() =>
      validatePlannedPhases("build", planned(["implement_code", "research_gather"]), ALL),
    ).toThrow(PlanValidationError);
  });

  it("rejects plans with zero or multiple artifact phases", () => {
    expect(() =>
      validatePlannedPhases("analyze", planned(["research_gather"]), ALL),
    ).toThrow(PlanValidationError);
    expect(() =>
      validatePlannedPhases("analyze", planned(["draft", "xlsx_build"]), ALL),
    ).toThrow(PlanValidationError);
  });

  it("rejects oversized plans", () => {
    expect(() =>
      validatePlannedPhases(
        "analyze",
        planned([
          "research_gather",
          "research_gather",
          "research_gather",
          "research_gather",
          "research_gather",
          "draft",
        ]),
        ALL,
      ),
    ).toThrow(PlanValidationError);
  });
});
