import { PROMPT_TEMPLATES } from "./templates.js";

function normalizeValue(value) {
  if (value == null || value === "") return "정보 없음";
  return String(value);
}

function renderTemplate(template, variables = {}) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => normalizeValue(variables[key]));
}

export const PROMPTS = {
  guardrail: { id: "guardrail", label: "Guardrail", template: PROMPT_TEMPLATES.guardrail },
  memoryLoader: { id: "memoryLoader", label: "Memory Loader", template: PROMPT_TEMPLATES.memoryLoader },
  supervisor: { id: "supervisor", label: "Supervisor", template: PROMPT_TEMPLATES.supervisor },
  apiAgent: { id: "apiAgent", label: "API Agent", template: PROMPT_TEMPLATES.apiAgent },
  ragAgent: { id: "ragAgent", label: "RAG Agent", template: PROMPT_TEMPLATES.ragAgent },
  composer: { id: "composer", label: "Composer", template: PROMPT_TEMPLATES.composer },
  caseWriter: { id: "caseWriter", label: "Case Writer", template: PROMPT_TEMPLATES.caseWriter },
  solutionAnalyzer: { id: "solutionAnalyzer", label: "Solution Analyzer", template: PROMPT_TEMPLATES.solutionAnalyzer },
};

export function renderPrompt(promptId, variables = {}) {
  const prompt = PROMPTS[promptId];
  if (!prompt) {
    throw new Error(`알 수 없는 프롬프트입니다: ${promptId}`);
  }
  return renderTemplate(prompt.template, variables);
}
