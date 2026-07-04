import { isTerminal, type PhaseState, type ProjectState } from "./states";

// The only legal way to compute a next state. The workflow runner applies the
// result with a conditional UPDATE (WHERE state = <from>) so concurrent
// transitions lose cleanly instead of corrupting the machine.

export type ProjectEvent =
  | { type: "intake_started" } // draft -> specifying
  | { type: "spec_ready" } // specifying -> awaiting_plan_approval
  | { type: "plan_approved" } // awaiting_plan_approval -> running
  | { type: "run_completed" } // running -> review
  | { type: "delivery_accepted" } // review -> done
  | { type: "run_failed"; reason: string } // any active -> failed
  | { type: "cancelled" }; // any active -> cancelled

export class TransitionError extends Error {
  constructor(
    public readonly from: ProjectState,
    public readonly event: ProjectEvent["type"],
  ) {
    super(`Illegal project transition: ${event} from '${from}'`);
    this.name = "TransitionError";
  }
}

export function transition(from: ProjectState, event: ProjectEvent): ProjectState {
  if (isTerminal(from)) {
    throw new TransitionError(from, event.type);
  }
  switch (event.type) {
    case "intake_started":
      if (from === "draft") return "specifying";
      throw new TransitionError(from, event.type);
    case "spec_ready":
      if (from === "specifying") return "awaiting_plan_approval";
      throw new TransitionError(from, event.type);
    case "plan_approved":
      if (from === "awaiting_plan_approval") return "running";
      throw new TransitionError(from, event.type);
    case "run_completed":
      if (from === "running") return "review";
      throw new TransitionError(from, event.type);
    case "delivery_accepted":
      if (from === "review") return "done";
      throw new TransitionError(from, event.type);
    case "run_failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default: {
      const exhaustive: never = event;
      throw new Error(`Unhandled event: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export type PhaseEvent =
  | { type: "phase_started" } // pending -> running
  | { type: "phase_done" } // running -> done
  | { type: "phase_failed"; reason: string }; // running -> failed

export class PhaseTransitionError extends Error {
  constructor(
    public readonly from: PhaseState,
    public readonly event: PhaseEvent["type"],
  ) {
    super(`Illegal phase transition: ${event} from '${from}'`);
    this.name = "PhaseTransitionError";
  }
}

export function phaseTransition(from: PhaseState, event: PhaseEvent): PhaseState {
  switch (event.type) {
    case "phase_started":
      if (from === "pending") return "running";
      throw new PhaseTransitionError(from, event.type);
    case "phase_done":
      if (from === "running") return "done";
      throw new PhaseTransitionError(from, event.type);
    case "phase_failed":
      if (from === "running") return "failed";
      throw new PhaseTransitionError(from, event.type);
    default: {
      const exhaustive: never = event;
      throw new Error(`Unhandled event: ${JSON.stringify(exhaustive)}`);
    }
  }
}
