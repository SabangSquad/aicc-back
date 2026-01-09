

const region = "ap-northeast-2"; 
const apiKey = process.env.BEDROCK_API_KEY;

const MODEL_ID = "amazon.nova-pro-v1:0"; 

function bedrockHeaders() {
  if (!apiKey) throw new Error("BEDROCK_API_KEY 환경변수가 없습니다.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

/**
 * 1) 실시간 챗봇 응답용
 */
export async function runAiccPrompt(userMessage) {
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${MODEL_ID}/converse`;

  const systemPrompt = `[System Role: AICC Prototype Chatbot - Test Mode]
너는 AWS Bedrock 환경에서 동작하는 AICC(AI Contact Center) 테스트용 LLM이다.
현재 목적은 상담 응답 품질·규정 준수·톤 일관성을 검증하기 위한 실험 환경(Test Phase)이다.
---
## 🎯 목표
- 고객의 텍스트 질의에 대해 상담사처럼 자연스러운 답변을 생성하라.
- 각 응답에는 “규정 준수 여부” 또는 “답변 이유”를 함께 제공하라.
---
## 🗂️ 규정 예시
- 배송 지연 시: 사과 + 배송사 전달 + 예상 도착 안내
- 반품 요청 시: 반품 절차 안내 + 수거 일정 확인
- 욕설, 비속어 포함 시: 정중한 경고 + 대화 종료
- 상품 문의 시: 고객센터 연결 안내
---
## 💬 응답 형식 (항상 아래 형식 유지)
[응답] 실제 고객에게 전달할 상담 답변
[근거] 사용한 규정 또는 판단 이유를 간략히 설명
---
## ⚙️ 제약 조건
- 허위 정보 생성 금지, 공손한 상담사 말투, 3문장 이하 간결 유지, 모든 출력 한글 작성.`;

  const body = {
    system: [{ text: systemPrompt }],
    messages: [
      {
        role: "user",
        content: [{ text: String(userMessage) }]
      }
    ],
    inferenceConfig: { maxTokens: 1000, temperature: 0 }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: bedrockHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorDetail = await res.text().catch(() => "");
    throw new Error(`Bedrock HTTP ${res.status} - ${errorDetail}`);
  }

  const data = await res.json();
  const rawText = data?.output?.message?.content?.[0]?.text || "";

  const answerMatch = rawText.match(/\[응답\]\s*([^\[]+)/s);
  const reasonMatch = rawText.match(/\[근거\]\s*([\s\S]+)/);

  return {
    rawText,
    answer: answerMatch ? answerMatch[1].trim() : rawText.trim(),
    reason: reasonMatch ? reasonMatch[1].trim() : null,
  };
}

/**
 * 2) 케이스 전체 대화 분석용
 */
export async function analyzeCaseConversation(conversationText) {
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${MODEL_ID}/converse`;

  const systemPrompt = `너는 콜센터 AICC 시스템의 분석용 어시스턴트다.
입력으로 한 건의 상담 대화 전체가 한국어로 주어진다.
너의 작업은 이 대화를 분석해서 아래 형식의 JSON 하나만 생성하는 것이다.
{
  "emotion": "평온 | 기쁨 | 슬픔 | 화남 | 짜증 중 하나",
  "summary": "대화 내용을 2~3문장으로 한국어 요약",
  "suggested_reply": "상담사가 다음 턴에 고객에게 보내면 좋은 한국어 답변 한 문단"
}
규칙:
- emotion 은 고객의 전체적인 감정 상태를 고른다.
- summary 는 문제 상황과 처리 결과 위주로 요약한다.
- suggested_reply 는 공손하고 친절한 존댓말로 작성한다.
- 반드시 위 JSON 형식만 출력하며, 마크다운 코드블록을 포함한 어떠한 부연 설명도 하지 마라.`;

  const body = {
    system: [{ text: systemPrompt }],
    messages: [
      {
        role: "user",
        content: [{ text: `대화 내용 분석:\n${conversationText}` }]
      }
    ],
    inferenceConfig: { maxTokens: 2000, temperature: 0 }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: bedrockHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorDetail = await res.text().catch(() => "");
    throw new Error(`Bedrock HTTP ${res.status} - ${errorDetail}`);
  }

  const data = await res.json();
  const rawText = data?.output?.message?.content?.[0]?.text || "";

  // 기존과 동일한 JSON 정제 로직
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }

  let json = null;
  try {
    json = JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON 파싱 에러:", e);
  }

  return { rawText, json };
}