import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { renderPrompt, PROMPTS } from "../prompts/index.js";

const modelName = process.env.VLLM_MODEL || "Qwen/Qwen3-8B-AWQ";
const apiKey = process.env.VLLM_API_KEY || "dummy";
const baseURL = process.env.VLLM_BASE_URL || "http://vllm:8000/v1";
const temperature = Number(process.env.VLLM_TEMPERATURE ?? 0.2);
const defaultMaxTokens = Number(process.env.VLLM_MAX_TOKENS ?? 512);
const noThinkEnabled = process.env.VLLM_NO_THINK !== "false";

const MAX_TOKENS_BY_PROMPT = {
  guardrail: 64,
  supervisor: 128,
  apiAgent: 128,
  memoryLoader: 192,
  ragAgent: 384,
  composer: 320,  // 추론/룰 강화로 프롬프트 길어진 상태, ContextOverflow 마진 확보
  caseWriter: 512,
  solutionAnalyzer: 512,
};

function createModel(maxTokens) {
  return new ChatOpenAI({
    model: modelName,
    apiKey,
    temperature: Number.isNaN(temperature) ? 0.2 : temperature,
    maxTokens,
    configuration: { baseURL },
  });
}

function getTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return "";
}

function withNoThink(text) {
  if (!noThinkEnabled) return text;
  return `${text}\n\n/no_think`;
}

function stripThinkTags(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function invokePrompt(promptId, variables = {}, options = {}) {
  if (!PROMPTS[promptId]) {
    throw new Error(`알 수 없는 프롬프트입니다: ${promptId}`);
  }

  const prompt = withNoThink(renderPrompt(promptId, variables));
  const maxTokens = Number(
    options.maxTokens ??
    MAX_TOKENS_BY_PROMPT[promptId] ??
    defaultMaxTokens
  );
  const effectiveMaxTokens = Number.isNaN(maxTokens) ? 512 : maxTokens;
  const startedAt = Date.now();
  console.log(`📡 [vLLM] ${PROMPTS[promptId].label} 호출: model=${modelName}, maxTokens=${effectiveMaxTokens}, noThink=${noThinkEnabled}`);

  const messages = [{ role: "system", content: prompt }];
  if (options.userMessage) {
    messages.push({ role: "user", content: withNoThink(String(options.userMessage)) });
  }

  const model = createModel(effectiveMaxTokens);
  const res = await model.invoke(messages);
  const elapsed = Date.now() - startedAt;
  console.log(`✅ [vLLM] ${PROMPTS[promptId].label} 완료: ${elapsed}ms`);
  return stripThinkTags(getTextContent(res.content));
}
