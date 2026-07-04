import { describe, expect, it } from "vitest";
import { PROJECT_STATES, isTerminal, type ProjectState } from "./states";
import {
  PhaseTransitionError,
  phaseTransition,
  transition,
  TransitionError,
} from "./transitions";

describe("project transitions", () => {
  it("walks the Phase 1 happy path", () => {
    let s: ProjectState = "draft";
    s = transition(s, { type: "intake_started" });
    expect(s).toBe("specifying");
    s = transition(s, { type: "spec_ready" });
    expect(s).toBe("awaiting_plan_approval");
    s = transition(s, { type: "plan_approved" });
    expect(s).toBe("running");
    s = transition(s, { type: "run_completed" });
    expect(s).toBe("review");
    s = transition(s, { type: "delivery_accepted" });
    expect(s).toBe("done");
  });

  it("allows failure and cancellation from any active state", () => {
    for (const from of PROJECT_STATES.filter((s) => !isTerminal(s))) {
      expect(transition(from, { type: "run_failed", reason: "boom" })).toBe("failed");
      expect(transition(from, { type: "cancelled" })).toBe("cancelled");
    }
  });

  it("rejects illegal transitions", () => {
    expect(() => transition("draft", { type: "plan_approved" })).toThrow(TransitionError);
    expect(() => transition("running", { type: "spec_ready" })).toThrow(TransitionError);
    expect(() => transition("review", { type: "run_completed" })).toThrow(TransitionError);
  });

  it("rejects any event from a terminal state", () => {
    for (const from of ["done", "failed", "cancelled"] as const) {
      expect(() => transition(from, { type: "plan_approved" })).toThrow(TransitionError);
      expect(() => transition(from, { type: "cancelled" })).toThrow(TransitionError);
    }
  });
});

describe("phase transitions", () => {
  it("walks pending -> running -> done", () => {
    expect(phaseTransition("pending", { type: "phase_started" })).toBe("running");
    expect(phaseTransition("running", { type: "phase_done" })).toBe("done");
  });

  it("allows running -> failed", () => {
    expect(phaseTransition("running", { type: "phase_failed", reason: "boom" })).toBe(
      "failed",
    );
  });

  it("rejects illegal phase transitions", () => {
    expect(() => phaseTransition("pending", { type: "phase_done" })).toThrow(
      PhaseTransitionError,
    );
    expect(() => phaseTransition("done", { type: "phase_started" })).toThrow(
      PhaseTransitionError,
    );
  });
});
