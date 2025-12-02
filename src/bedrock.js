// src/bedrock.js
// AWS Bedrock REST API + Bedrock API 키 사용

const region = process.env.AWS_REGION ?? "ap-northeast-2";
const promptArn = process.env.BEDROCK_PROMPT_ARN;          // Prompt Management 프롬프트 ARN
const modelArn = process.env.BEDROCK_INFERENCE_PROFILE_ID;
const apiKey = process.env.BEDROCK_API_KEY;
const casePromptArn = process.env.BEDROCK_CASE_PROMPT_ARN; // 케이스 감정/요약용 Prompt Management ARN

/**
 * 공용 헤더
 */
function bedrockHeaders() {
  if (!apiKey) {
    throw new Error("AWS_BEARER_TOKEN_BEDROCK 환경변수가 없습니다.");
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

/**
 * 1) 실시간 챗봇 응답용
 * Prompt Management 프롬프트에 {{user_utterance}} 변수를 꽂아서 호출.
 *
 * @param {string} userMessage
 * @returns {Promise<{ rawText: string, answer: string, reason: string | null }>}
 */
export async function runAiccPrompt(userMessage) {
  if (!promptArn) {
    throw new Error("BEDROCK_PROMPT_ARN 환경변수가 없습니다.");
  }

  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(
    promptArn
  )}/converse`;

  // Prompt Management + Converse: promptVariables 값은 { text: "..." } 형태여야 함
  const body = {
    promptVariables: {
      // 프롬프트 템플릿에 {{user_utterance}} 라고 써놨다고 가정
      user_utterance: {
        text: String(userMessage),
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: bedrockHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Bedrock HTTP ${res.status} ${res.statusText} - ${
        text || "no body"
      }`
    );
  }

  const data = await res.json();

  // ---- 텍스트 추출 ----
  let rawText = "";

  const contentBlocks = data?.output?.message?.content;
  if (Array.isArray(contentBlocks)) {
    const textBlock = contentBlocks.find(
      (block) => typeof block?.text === "string" && block.text.trim()
    );
    if (textBlock) {
      rawText = textBlock.text;
    }
  }

  if (!rawText) {
    rawText = JSON.stringify(data);
  }

  // ---- [응답] / [근거] 파싱 ----
  const answerMatch = rawText.match(/\[응답\]\s*([^\[]+)/s);
  const reasonMatch = rawText.match(/\[근거\]\s*([\s\S]+)/);

  const answer = answerMatch ? answerMatch[1].trim() : rawText.trim();
  const reason = reasonMatch ? reasonMatch[1].trim() : null;

  return {
    rawText,
    answer,
    reason,
  };
}

/**
 * 2) 케이스 전체 대화 분석용 (Prompt Management 사용)
 * - 대화 로그 전체(conversationText)를 입력으로 넘김
 * - 프롬프트 관리에서 정의한 {{conversation_text}} 변수에 꽂아서 호출
 *
 * @param {string} conversationText - "고객: ...\n상담사: ..." 형태의 전체 로그
 * @returns {Promise<{ rawText: string, json: any | null }>}
 */
export async function analyzeCaseConversation(conversationText) {
  if (!casePromptArn) {
    throw new Error("BEDROCK_CASE_PROMPT_ARN 환경변수가 없습니다.");
  }

  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(
    casePromptArn
  )}/converse`;

  // ⚠ Prompt Management 호출이기 때문에
  // - messages / system / inferenceConfig 같은 건 여기서 보내지 않고
  // - promptVariables 만 보낸다.
  //
  // 프롬프트 안에서 {{conversation_text}} 라는 변수 이름을 썼다고 가정.
  const body = {
    promptVariables: {
      conversation_text: {
        text: String(conversationText),
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: bedrockHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Bedrock HTTP ${res.status} ${res.statusText} - ${
        text || "no body"
      }`
    );
  }

  const data = await res.json();

  // ---- 텍스트 추출 (기존 로직 재사용) ----
  let rawText = "";
  const contentBlocks = data?.output?.message?.content;
  if (Array.isArray(contentBlocks)) {
    const textBlock = contentBlocks.find(
      (block) => typeof block?.text === "string" && block.text.trim()
    );
    if (textBlock) {
      rawText = textBlock.text;
    }
  }
  if (!rawText) {
    rawText = JSON.stringify(data);
  }

  // ```json ... ``` 같은 코드블록 제거
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "");
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();
  }

  let json = null;
  try {
    json = JSON.parse(cleaned);
  } catch {
    // 파싱 실패하면 json은 null (rawText 보고 디버깅)
  }

  return {
    rawText,
    json,
  };
}

