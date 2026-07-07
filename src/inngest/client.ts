import { eventType, Inngest, staticSchema } from "inngest";

// Durable workflow events (Phase 2). Gates are literally waitForEvent on
// these — the API routes resolve a gate by updating the DB and sending the
// matching event via `inngest.send(<eventType>.create({...}))`.

export const planApproved = eventType("project/plan.approved", {
  schema: staticSchema<{ projectId: string; userId: string }>(),
});

export const inputProvided = eventType("project/input.provided", {
  schema: staticSchema<{ projectId: string; approvalId: string; answer: string }>(),
});

export const reviewResolved = eventType("project/review.resolved", {
  schema: staticSchema<{
    projectId: string;
    approvalId: string; // waits match on this — a stale round's event can't satisfy a later gate
    action: "accept" | "revise";
    instructions?: string;
  }>(),
});

export const budgetRaised = eventType("project/budget.raised", {
  schema: staticSchema<{ projectId: string; approvalId: string; newBudgetUsd: number }>(),
});

export const projectCancelled = eventType("project/cancelled", {
  schema: staticSchema<{ projectId: string }>(),
});

export const inngest = new Inngest({
  id: "ai-project-router",
  isDev: process.env.NODE_ENV !== "production",
});
