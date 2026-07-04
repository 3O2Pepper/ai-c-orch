import type { Outline, ProjectSpec } from "@/lib/core/spec";

// Research template prompts (Phase 1: model-knowledge-only — no web search
// until Phase 3). Stable instructions first, volatile spec/outline last.

export const OUTLINE_SYSTEM = `You are the planning analyst for a research \
report. Produce a section outline that fully covers the project's goal and \
success criteria. 4-8 sections, each with concrete notes on what it must \
cover. Do not include generic filler sections.

blocking_question rule: set it ONLY if a material ambiguity would change the \
report's structure or conclusions AND no reasonable assumption exists. When \
in doubt, resolve by assumption and leave it null — most projects need no \
question. If you do ask, provide a recommended_default the system can \
proceed with unattended.`;

export function outlinePrompt(spec: ProjectSpec, decision?: string | null): string {
  return [
    `Project spec:\n${JSON.stringify(spec, null, 2)}`,
    ...(decision ? [`User decision on the open question:\n${decision}`] : []),
    `Produce the section outline.`,
  ].join("\n\n");
}

export const DRAFT_SYSTEM = `You are the research writer for AI Project \
Router. Write a complete, well-structured markdown report.

Rules:
- Follow the provided outline exactly — one section per outline entry.
- Start with a title (H1) and a short executive summary; no preamble like
  "Here is the report".
- You have no web access in this run. Write from your own knowledge, and
  where a figure or fact may be outdated or uncertain, say so inline rather
  than inventing precision.
- Honor every constraint and aim every section at the success criteria.
- Record the spec's assumptions in a short "Assumptions" section at the end.`;

export function draftPrompt(
  spec: ProjectSpec,
  outline: Outline,
  decision?: string | null,
): string {
  return [
    `Project spec:\n${JSON.stringify(spec, null, 2)}`,
    `Approved outline:\n${JSON.stringify(outline.sections, null, 2)}`,
    ...(decision
      ? [
          `User decision (recorded at the needs-input gate — honor it):\n${decision}`,
        ]
      : []),
    `Write the full report now.`,
  ].join("\n\n");
}

export const REVISION_SYSTEM = `You are revising an existing markdown \
research report based on a user's revision request.

Rules:
- Apply the requested changes fully; keep everything else intact unless the
  request implies otherwise.
- Return the COMPLETE revised report, not a diff or the changed sections.
- Keep the original structure, tone, and formatting conventions.
- You have no web access. Where new content requires facts you are unsure
  of, say so inline rather than inventing precision.`;

export function revisionPrompt(
  spec: ProjectSpec,
  previousReport: string,
  instructions: string,
): string {
  return [
    `Project spec:\n${JSON.stringify(spec, null, 2)}`,
    `Current report:\n---\n${previousReport}\n---`,
    `Revision request from the user:\n${instructions}`,
    `Return the complete revised report.`,
  ].join("\n\n");
}

export const DIGEST_SYSTEM = `Summarize the given artifact in 100-200 tokens \
for use as machine-readable context. Cover: what it is, what it concludes, \
and what it deliberately leaves out. No preamble.`;
