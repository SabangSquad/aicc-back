import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { renderPrompt, PROMPTS } from "../prompts/index.js";

const modelName = process.env.VLLM_MODEL || "Qwen/Qwen2.5-7B-Instruct-AWQ";
const apiKey = process.env.VLLM_API_KEY || "dummy";
const baseURL = process.env.VLLM_BASE_URL || "http://vllm:8000/v1";
const temperature = Number(process.env.VLLM_TEMPERATURE ?? 0.2);

const model = new ChatOpenAI({
  model: modelName,
  apiKey,
  temperature: Number.isNaN(temperature) ? 0.2 : temperature,
  configuration: { baseURL },
});

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

export async function invokePrompt(promptId, variables = {}, options = {}) {
  if (!PROMPTS[promptId]) {
    throw new Error(`알 수 없는 프롬프트입니다: ${promptId}`);
  }

  const prompt = renderPrompt(promptId, variables);
  console.log(`📡 [vLLM] 프롬프트 호출 중: ${PROMPTS[promptId].label}`);

  const messages = [{ role: "system", content: prompt }];
  if (options.userMessage) {
    messages.push({ role: "user", content: String(options.userMessage) });
  }

  const res = await model.invoke(messages);
  return getTextContent(res.content).trim();
}
