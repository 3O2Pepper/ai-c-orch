import type { ProjectSpec } from "@/lib/core/spec";

export const DRAFT_SYSTEM = `You are a research writer. Write a complete, polished markdown report based on the project spec and outline.

Requirements:
- Follow the outline structure
- Write in clear, professional prose
- Use markdown formatting (headings, lists, bold where helpful)
- Meet the deliverables and success criteria
- This is model-knowledge-only — do not claim to have browsed the web
- Output the full report markdown only. No preamble or meta-commentary.`;

export function draftUserPrompt(spec: ProjectSpec, outline: string): string {
  return `Project specification:

Title: ${spec.title}
Goal: ${spec.goal}

Deliverables:
${spec.deliverables.map((d) => `- ${d}`).join("\n")}

Constraints:
${spec.constraints.map((c) => `- ${c}`).join("\n")}

Success criteria:
${spec.success_criteria.map((c) => `- ${c}`).join("\n")}

---

Approved outline:

${outline}

---

Write the complete report.`;
}
