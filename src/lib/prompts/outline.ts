import type { ProjectSpec } from "@/lib/core/spec";

export const OUTLINE_SYSTEM = `You are a research planner. Given a project specification, produce a detailed report outline in markdown.

The outline should:
- Have clear section headings (## level)
- Note what each section will cover
- Match the deliverables and success criteria
- Be thorough but focused — this is a model-knowledge-only report (no web search)

Output markdown only. No preamble.`;

export function outlineUserPrompt(spec: ProjectSpec): string {
  return `Project specification:

Title: ${spec.title}

Goal: ${spec.goal}

Deliverables:
${spec.deliverables.map((d) => `- ${d}`).join("\n")}

Constraints:
${spec.constraints.map((c) => `- ${c}`).join("\n")}

Success criteria:
${spec.success_criteria.map((c) => `- ${c}`).join("\n")}

Assumptions:
${spec.assumptions.map((a) => `- ${a}`).join("\n")}

Produce the report outline.`;
}
