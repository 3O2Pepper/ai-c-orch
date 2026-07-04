import type { Outline, ProjectSpec } from "@/lib/core/spec";

// Research template prompts (Phase 1: model-knowledge-only — no web search
// until Phase 3). Stable instructions first, volatile spec/outline last.

export const OUTLINE_SYSTEM = `You are the planning analyst for a research \
report. Produce a section outline that fully covers the project's goal and \
success criteria. 4-8 sections, each with concrete notes on what it must \
cover. Do not include generic filler sections.`;

export function outlinePrompt(spec: ProjectSpec): string {
  return `Project spec:\n${JSON.stringify(spec, null, 2)}\n\nProduce the section outline.`;
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

export function draftPrompt(spec: ProjectSpec, outline: Outline): string {
  return [
    `Project spec:\n${JSON.stringify(spec, null, 2)}`,
    `Approved outline:\n${JSON.stringify(outline, null, 2)}`,
    `Write the full report now.`,
  ].join("\n\n");
}

export const DIGEST_SYSTEM = `Summarize the given artifact in 100-200 tokens \
for use as machine-readable context. Cover: what it is, what it concludes, \
and what it deliberately leaves out. No preamble.`;
