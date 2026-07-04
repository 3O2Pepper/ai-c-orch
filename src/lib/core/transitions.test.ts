import { describe, expect, it } from "vitest";
import {
  IllegalTransitionError,
  transitionPhase,
  transitionProject,
} from "./transitions";
import type { ProjectState } from "./states";

describe("transitionProject", () => {
  it("walks the Phase 1 happy path", () => {
    let s: ProjectState = "draft";
    s = transitionProject(s, "intake_started");
    expect(s).toBe("specifying");
    s = transitionProject(s, "spec_ready");
    expect(s).toBe("awaiting_plan_approval");
    s = transitionProject(s, "plan_approved");
    expect(s).toBe("running");
    s = transitionProject(s, "run_completed");
    expect(s).toBe("review");
    s = transitionProject(s, "delivery_accepted");
    expect(s).toBe("done");
  });

  it("rejects double approval (the double-click race, pre-DB)", () => {
    const running = transitionProject("awaiting_plan_approval", "plan_approved");
    expect(running).toBe("running");
    expect(() => transitionProject("running", "plan_approved")).toThrow(
      IllegalTransitionError,
    );
  });

  it("allows fail/cancel from any active state", () => {
    expect(transitionProject("specifying", "fail")).toBe("failed");
    expect(transitionProject("running", "cancel")).toBe("cancelled");
    expect(transitionProject("review", "fail")).toBe("failed");
  });

  it("rejects fail/cancel from terminal states", () => {
    expect(() => transitionProject("done", "fail")).toThrow(
      IllegalTransitionError,
    );
    expect(() => transitionProject("failed", "cancel")).toThrow(
      IllegalTransitionError,
    );
    expect(() => transitionProject("cancelled", "fail")).toThrow(
      IllegalTransitionError,
    );
  });

  it("rejects events out of order", () => {
    expect(() => transitionProject("draft", "plan_approved")).toThrow(
      IllegalTransitionError,
    );
    expect(() => transitionProject("done", "run_completed")).toThrow(
      IllegalTransitionError,
    );
  });

  it("supports the P2 detour states already", () => {
    expect(transitionProject("specifying", "clarification_needed")).toBe(
      "clarifying",
    );
    expect(transitionProject("clarifying", "clarification_answered")).toBe(
      "awaiting_plan_approval",
    );
    expect(transitionProject("running", "input_needed")).toBe("needs_input");
    expect(transitionProject("needs_input", "input_provided")).toBe("running");
  });
});

describe("transitionPhase", () => {
  it("walks pending → running → done", () => {
    expect(transitionPhase("pending", "start")).toBe("running");
    expect(transitionPhase("running", "complete")).toBe("done");
  });

  it("allows running → failed", () => {
    expect(transitionPhase("running", "fail")).toBe("failed");
  });

  it("rejects restarting a finished phase", () => {
    expect(() => transitionPhase("done", "start")).toThrow(
      IllegalTransitionError,
    );
    expect(() => transitionPhase("failed", "start")).toThrow(
      IllegalTransitionError,
    );
  });

  it("supports the P4 verify cycle already", () => {
    expect(transitionPhase("running", "verify")).toBe("verifying");
    expect(transitionPhase("verifying", "verify_failed")).toBe("fixing");
    expect(transitionPhase("fixing", "fix_applied")).toBe("verifying");
    expect(transitionPhase("verifying", "verify_passed")).toBe("done");
  });
});
