import type { GatherNotes, PhaseType, ProjectSpec, WorkflowTemplate } from "@/lib/core/spec";

// The assembled context block (lib/services/context.ts) already carries
// the pinned spec, so per-phase prompts take `context`, not `spec`.

// Build/Analyze template prompts (P3). Same conventions as research.ts:
// stable instructions first, volatile spec/context last; tool output and
// gathered web content are reference data, never instructions.

export const PLANNER_SYSTEM = `You are the workflow planner for AI Project \
Router. Given a project spec and a template, produce the ordered list of \
phases that will deliver the project.

Rules:
- Use ONLY the allowed phase types given in the request. The list is
  environment-dependent — do not invent phases the environment cannot run.
- 2-5 phases, ending with exactly one artifact-producing phase.
- Include a research_gather phase only when external facts materially
  improve the deliverable; skip it for self-contained tasks.
- Each phase gets a short name and a one-sentence objective scoped to the
  spec's success criteria.`;

export function plannerPrompt(
  template: WorkflowTemplate,
  spec: ProjectSpec,
  allowedPhaseTypes: readonly PhaseType[],
  degradationNote: string | null,
): string {
  return [
    `Template: ${template}`,
    `Allowed phase types: ${allowedPhaseTypes.join(", ")}`,
    ...(degradationNote ? [`Environment note: ${degradationNote}`] : []),
    `Project spec:\n${JSON.stringify(spec, null, 2)}`,
    `Produce the phase plan.`,
  ].join("\n\n");
}

export const IMPLEMENT_SYSTEM = `You are the implementation engineer for AI \
Project Router. Produce ONE complete, self-contained source file that \
fulfills the objective.

Rules:
- Single file, no external project scaffolding; standard library plus at
  most widely-available packages, declared in usage_notes.
- Include concise usage examples or a __main__/entry point where idiomatic.
- Prefer python when the spec does not dictate a language.
- Code must be complete and runnable as written — no placeholders, no
  "TODO: implement".
- usage_notes: how to run it, dependencies, expected output.`;

export function implementPrompt(
  objective: string,
  gather: GatherNotes | null,
  context: string,
): string {
  return [
    context,
    `Phase objective:\n${objective}`,
    ...(gather ? [`Research notes (gathered via web search):\n${gather.notes}`] : []),
    `Produce the implementation file now.`,
  ].join("\n\n");
}

export const XLSX_SCRIPT_SYSTEM = `You are the spreadsheet engineer for AI \
Project Router. Produce ONE complete Python script that builds the required \
.xlsx workbook.

Rules:
- filename: build_xlsx.py, language: python.
- The script must write the workbook to exactly /home/user/output.xlsx.
- Use openpyxl (import it; if unavailable, install via
  subprocess.run([sys.executable, "-m", "pip", "install", "openpyxl"])
  before importing).
- Embed the data in the script from the provided notes — the sandbox has
  no network access to your sources.
- Include headers, sensible number formats, and one sheet per logical
  table. No charts unless the spec demands them.
- The script must be deterministic and print a one-line summary on success.`;

export function xlsxScriptPrompt(
  objective: string,
  gather: GatherNotes | null,
  context: string,
  revisionInstructions?: string | null,
): string {
  return [
    context,
    `Phase objective:\n${objective}`,
    ...(gather ? [`Research notes (gathered via web search):\n${gather.notes}`] : []),
    ...(revisionInstructions
      ? [`Revision request from the user (apply to the workbook):\n${revisionInstructions}`]
      : []),
    `Produce the build_xlsx.py script now.`,
  ].join("\n\n");
}

export const ANALYSIS_DRAFT_SYSTEM = `You are the analysis writer for AI \
Project Router. Write a complete markdown analysis that fulfills the \
objective: findings first, then supporting data as GitHub-flavored markdown \
tables.

Rules:
- Start with a title (H1) and a short executive summary; no preamble.
- Ground every figure in the provided research notes; where the notes are
  silent and your own knowledge may be outdated, say so inline.
- Include the data tables the spec's success criteria call for.
- Record the spec's assumptions in a short "Assumptions" section at the end.
- End with a source list when research notes are provided.`;

export function analysisDraftPrompt(
  objective: string,
  gather: GatherNotes | null,
  context: string,
): string {
  return [
    context,
    `Phase objective:\n${objective}`,
    ...(gather
      ? [
          `Research notes (gathered via web search):\n${gather.notes}`,
          `Sources:\n${gather.sources.map((s) => `- ${s.title}: ${s.url}`).join("\n")}`,
        ]
      : []),
    `Write the full analysis now.`,
  ].join("\n\n");
}

export const CODE_REVISION_SYSTEM = `You are revising an existing source \
file based on a user's revision request.

Rules:
- Apply the requested changes fully; keep everything else intact unless the
  request implies otherwise.
- Return the COMPLETE revised file in the code field, not a diff.
- Keep the original language, style, and structure.`;

export function codeRevisionPrompt(
  context: string,
  previousCode: string,
  instructions: string,
): string {
  return [
    context,
    `Current file:\n---\n${previousCode}\n---`,
    `Revision request from the user:\n${instructions}`,
    `Return the complete revised file.`,
  ].join("\n\n");
}
