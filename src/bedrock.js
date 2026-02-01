import 'dotenv/config';
import { StateGraph, END, START } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import * as BedrockRuntime from "@aws-sdk/client-bedrock-runtime";
import * as BedrockAgent from "@aws-sdk/client-bedrock-agent-runtime";
import pool from "./db.js";
import axios from 'axios';

const runtimeModule = BedrockRuntime.default || BedrockRuntime;
const agentModule = BedrockAgent.default || BedrockAgent;
const { BedrockRuntimeClient, ApplyGuardrailCommand } = runtimeModule;
const { BedrockAgentRuntimeClient, RetrieveCommand } = agentModule;

const region = process.env.AWS_REGION || "ap-northeast-2";
const apiKey = process.env.BEDROCK_API_KEY;

// AWS SDK 클라이언트 초기화
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
};
const bedrockRuntime = new BedrockRuntimeClient({ region, credentials });
const bedrockAgentRuntime = new BedrockAgentRuntimeClient({ region, credentials });

// PostgreSQL 체크포인터
const checkpointer = new PostgresSaver(pool);


// Bedrock 프롬프트 관리 호출 (Fetch 기반)
async function invokePrompt(arn, inputs) {
  if (!arn) throw new Error(`ARN이 설정되지 않았습니다.`);
  if (!apiKey) throw new Error("BEDROCK_API_KEY(ABSK)가 없습니다.");

  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(arn)}/converse`;

  const promptVariables = {};
  for (const [key, value] of Object.entries(inputs)) {
    promptVariables[key] = { text: String(value || "정보 없음") };
  }

  console.log(`📡 [Fetch] 프롬프트 호출 중: ${arn.split('/').pop()}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ 
      promptVariables
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Bedrock HTTP ${res.status}: ${errorBody}`);
  }

  const data = await res.json();
  return data.output.message.content.find(c => c.text)?.text || "";
}

// 특정 지식 기반 검색

async function retrieveKB(query, kbId) {
  if (!kbId) return "지식 베이스 ID가 설정되지 않았습니다.";
  const command = new RetrieveCommand({
    knowledgeBaseId: kbId,
    retrievalQuery: { text: query },
    retrievalConfiguration: {
      vectorSearchConfiguration: { numberOfResults: 2 }
    }
  });
  const response = await bedrockAgentRuntime.send(command);
  return response.retrievalResults.map(res => res.content.text).join('\n\n');
}

// 그래프 상태 정의
const graphState = {
  channels: {
    userQuery: null,
    caseId: null,
    historySummary: null,
    intent: null,
    sourceData: null,
    retrievedContext: null,
    verificationStatus: null,
    finalAnswer: null,
    reason: null,
    retryCount: null,
    apiIterations: null,
  }
};

// 그래프 노드 정의
const guardrailNode = async (state) => {
  // 노드 1: 가드레일
  console.log(`\n🔍 [Node 1: Guardrail] 검사 시작...`);
  const guardrailId = process.env.BEDROCK_GUARDRAIL_ARN.split('/').pop();
  const url = `https://bedrock-runtime.${region}.amazonaws.com/guardrail/${guardrailId}/version/DRAFT/apply`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      source: "INPUT",
      content: [{ text: { text: state.userQuery } }]
    }),
  });

  const data = await res.json();
  if (data.action === "GUARDRAIL_INTERVENED") {
    console.error(`🚨 [Node 1: Guardrail] 부적절한 요청 차단됨`);
    throw new Error("GUARDRAIL_BLOCKED");
  }
  return { ...state };
};

// 노드 2: Memory Loader
const memoryLoaderNode = async (state) => {
  console.log(`📂 [Node 2: Memory Loader] 로드 중...`);
  const { rows } = await pool.query(
    "SELECT speaker, content FROM messages WHERE case_id = $1 ORDER BY occurred_at DESC LIMIT 5",
    [state.caseId]
  );
  const historyText = rows.reverse().map(r => `${r.speaker}: ${r.content}`).join("\n");

  const summary = await invokePrompt(process.env.BEDROCK_MEMORY_LOADER_ARN, { 
    past_logs: historyText || "이전 맥락 없음",
    user_input: state.userQuery 
  });
  return { historySummary: summary };
};

// 노드 3: Supervisor
const supervisorNode = async (state) => {
  console.log(`🎯 [Node 3: Supervisor] 분류 중...`);
  const raw = await invokePrompt(process.env.BEDROCK_SUPERVISOR_ARN, { 
    user_input: state.userQuery, 
    context: state.historySummary 
  });
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  let intent = "rag";
  if (jsonMatch) {
    try { intent = JSON.parse(jsonMatch[0]).decision || "rag"; } catch (e) { console.error("JSON 파싱 실패"); }
  }
  console.log(`   └─ ✅ 최종 결정: [${intent.toUpperCase()}]`);
  return { intent };
};


// 노드 4-1: API Planner (AI가 다음 할 일을 결정)
const apiPlannerNode = async (state) => {
  console.log(`\n🚀 [Node 4-1: API Planner] 분석 중... (${(state.apiIterations || 0) + 1}/4)`);
  
  // API 명세 로드 및 토큰 방어
  let apiSpec = state.retrievedContext;
  if (!apiSpec) {
    apiSpec = await retrieveKB(state.userQuery, process.env.BEDROCK_API_KNOWLEDGE_BASE_ID);
    if (apiSpec.length > 7000) apiSpec = apiSpec.substring(0, 7000) + "...";
  }

  // 컨텍스트 길이 제한
  let currentContext = state.sourceData || "아직 호출된 API 없음";
  if (currentContext.length > 10000) {
    currentContext = "...(이전 데이터 중략)..." + currentContext.slice(-8000);
  }

  const rawParams = await invokePrompt(process.env.BEDROCK_API_ARN, { 
    user_input: state.userQuery,
    case_id: state.caseId,
    api_docs: apiSpec,
    context: currentContext 
  });

  return { 
    reason: rawParams, 
    retrievedContext: apiSpec,
    apiIterations: state.apiIterations || 0 
  };
};

// 노드 4-2: API Executor (실제 API 호출 실행)
const apiExecutorNode = async (state) => {
  const rawParams = state.reason;
  console.log(`   --- [회차 ${(state.apiIterations || 0) + 1} 실행] ---`);

  try {
    const jsonStart = rawParams.indexOf('{');
    const jsonEnd = rawParams.lastIndexOf('}');
    if (jsonStart === -1) throw new Error("JSON 형식을 찾을 수 없습니다.");

    const cleanJson = rawParams.substring(jsonStart, jsonEnd + 1);
    const callInfo = JSON.parse(cleanJson);

    const targetId = String(callInfo.i || state.caseId).replace(/\{|\}/g, "");
    let targetUrl = `${process.env.ROOT_URL}/${callInfo.r}`;
    if (targetId !== "null" && !callInfo.r.includes(targetId)) targetUrl += `/${targetId}`;

    console.log(`   📡 [API 호출]: ${callInfo.m || 'GET'} ${targetUrl}`);

    const res = await axios({
      method: callInfo.m || 'GET',
      url: targetUrl,
      params: callInfo.p,
      headers: {
        "x-internal-secret": process.env.INTERNAL_SECRET_KEY,
        "Content-Type": "application/json"
      }
    });

    // 데이터 필터링
    let filteredData = res.data;
    if (callInfo.r === 'cases' || callInfo.r === 'case') {
      const { memo, content, ...rest } = res.data;
      filteredData = { ...rest, past_memo_summary: memo?.substring(0, 20) + "..." };
    }

    const stepResult = `\n[${state.apiIterations + 1}회차 결과 - ${callInfo.r}]: ${JSON.stringify(filteredData).substring(0, 3000)}`;
    const updatedContext = (state.sourceData === "아직 호출된 API 없음" || !state.sourceData) 
      ? stepResult 
      : state.sourceData + stepResult;

    return { 
      sourceData: updatedContext, 
      apiIterations: state.apiIterations + 1 
    };

  } catch (e) {
    console.error(`   └─ ❌ [에러]:`, e.message);
    return { 
      sourceData: (state.sourceData || "") + `\n[에러]: ${e.message}`, 
      apiIterations: state.apiIterations + 1 
    };
  }
};

// 노드 5: RAG Agent
const ragNode = async (state) => {
  console.log(`📚 [Node 5: RAG Agent] 지식 검색 중...`);
  const docs = await retrieveKB(state.userQuery, process.env.BEDROCK_POLICY_KNOWLEDGE_BASE_ID);
  const res = await invokePrompt(process.env.BEDROCK_RAG_ARN, { 
    user_query: state.userQuery,
    retrieved_context: docs 
  });
  return { 
    sourceData: res, 
    retrievedContext: docs,
    retryCount: (state.retryCount || 0) + 1
  };
};

// 노드 6: FT Agent
const ftNode = async (state) => {
  console.log(`🎭 [Node 6: FT Agent] 감정 케어 중...`);
  const res = await invokePrompt(process.env.BEDROCK_FINE_TUNING_ARN, { 
    memory_context: state.historySummary,
    rag_data: state.intent === 'rag' ? state.sourceData : "해당 없음",
    api_data: state.intent === 'api' ? state.sourceData : "해당 없음",
    user_input: state.userQuery 
  });
  return { 
    sourceData: res,
    retryCount: (state.retryCount || 0) + 1
  };
};

// 노드 7: Verifier
const verifierNode = async (state) => {
  console.log(`⚖️ [Node 7: Verifier] 교차 검증 및 경로 최적화 중...`);
  const res = await invokePrompt(process.env.BEDROCK_VERIFIER_ARN, { 
    current_intent: state.intent,
    retrieved_data: state.sourceData, // RAG 답변 혹은 API 로우 데이터
    user_input: state.userQuery,
    history: state.historySummary
  });

  const status = res.match(/"status":\s*"([^"]+)"/)?.[1] || "P";
  console.log(`   🔍 [검증 결과]: ${status} (현재 시도 횟수: ${state.retryCount || 0}/1)`);
  return { verificationStatus: status };
};

// 노드 8: Composer
const composerNode = async (state) => {
  console.log(`✍️ [Node 8/9: Composer] 답변 및 추천 질문 구성 중...`);
  
  const res = await invokePrompt(process.env.BEDROCK_COMPOSER_ARN, {
    user_input: state.userQuery,
    verification_status: state.verificationStatus,
    source_data: state.sourceData,
    history: state.historySummary
  });

  // [답변]과 [추천질문] 섹션을 정규표현식으로 분리
  const answerMatch = res.match(/\[답변\]\s*([\s\S]+?)(?=\[추천질문\]|$)/);
  const suggestionsMatch = res.match(/\[추천질문\]\s*([\s\S]+)/);

  const finalAnswer = answerMatch ? answerMatch[1].trim() : res.trim();
  
  // 추천 질문을 배열 형태로 변환
  const suggestions = suggestionsMatch 
    ? suggestionsMatch[1]
        .split('\n')
        .map(s => s.replace(/^\d+\.\s*|^\-\s*/, '').trim())
        .filter(s => s && s.length > 0)
    : ["다른 궁금한 점이 있으신가요?"];

  return { 
    finalAnswer, 
    suggestedQuestions: suggestions.slice(0, 3) // 상위 3개만 제안
  };
};

// 그래프 구축
const workflow = new StateGraph(graphState)
  .addNode("guardrail", guardrailNode)
  .addNode("memory", memoryLoaderNode)
  .addNode("supervisor", supervisorNode)
  .addNode("api_planner", apiPlannerNode)
  .addNode("api_executor", apiExecutorNode)
  .addNode("rag", ragNode)
  .addNode("ft", ftNode)
  .addNode("verifier", verifierNode)
  .addNode("composer", composerNode);

workflow.addEdge(START, "guardrail");
workflow.addEdge("guardrail", "memory");
workflow.addEdge("memory", "supervisor");

workflow.addConditionalEdges("supervisor", (state) => state.intent, {
  api: "api_planner",
  rag: "rag",
  ft: "ft"
});

workflow.addConditionalEdges("api_planner", (state) => {
  const raw = state.reason || "";
  const iterations = state.apiIterations || 0;
  
  // finish 액션이거나 4번 시도했을 때 verifier로 이동
  if (raw.includes('"action":"finish"') || iterations >= 4) {
    return "verifier";
  }
  return "executor";
}, {
  verifier: "verifier",
  executor: "api_executor"
});


workflow.addEdge("api_executor", "api_planner");
workflow.addEdge("rag", "verifier");
workflow.addEdge("ft", "verifier");

workflow.addConditionalEdges("verifier", (state) => {
  const status = state.verificationStatus;
  const count = state.retryCount || 0;
  const currentIntent = state.intent; // 현재 어디를 갔다 왔는지 확인

  // 시도 횟수가 2회 미만일 때만 유턴 허용
  if (count < 2) {
    if (status === "RETRY_API" && currentIntent !== "api") return "api_planner";
    if (status === "RETRY_RAG" && currentIntent !== "rag") return "rag";
    if (status === "RETRY_FT" && currentIntent !== "ft") return "ft";
  }

  console.log(`   🏁 [최종 종료]: 더 이상의 유턴 없이 답변을 작성합니다.`);
  return "composer"; 
}, {
  api: "api_planner",
  rag: "rag",
  ft: "ft",
  composer: "composer"
});

workflow.addEdge("composer", END);

const app = workflow.compile({ checkpointer });

// AICC 메인 프로세스
export async function processAICC(userQuery, caseId) {
  try {
    const config = { configurable: { thread_id: String(caseId) } };
    const finalState = await app.invoke({ userQuery, caseId, retryCount: 0 }, config);
    const response = {
      ok: true,
      answer: finalState.finalAnswer, // 메인 답변
      suggestions: finalState.suggestedQuestions || [], // AI가 제안하는 다음 질문들
      caseId: String(caseId),
      reason: finalState.verificationStatus === "P" ? "검증 완료" : "데이터 확인 필요"
    };

    // 서버 로그 확인용
    console.log(`\n🎁 [Final Response] 질문 유도형 응답 생성:`);
    console.log(`   📝 답변 요약: ${response.answer.substring(0, 40)}...`);
    console.log(`   💡 추천 질문:`, response.suggestions);

    return response;
  } catch (err) {
    if (err.message === "GUARDRAIL_BLOCKED") return { answer: "죄송합니다. 입력하신 내용 중에 보안 정책상 제한된 표현이나 개인정보가 포함되어 있어 답변을 드릴 수 없습니다.", reason: "보안 차단" };
    console.error("AICC Error:", err);
    throw err;
  }
}

// 상담 분석
export async function analyzeCaseConversation(conversationText) {
  const res = await invokePrompt(process.env.BEDROCK_CASE_WRITER_ARN, { 
    conversation_text: conversationText 
  });
  try {
    const json = JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] || 'null');
    return { rawText: res, json };
  } catch (e) { return { rawText: res, json: null }; }
}

// 체크포인터 초기화
export async function initializeCheckpointer() {
  try {
    await checkpointer.setup();
    console.log("✅ [Checkpointer] 준비 완료");
  } catch (err) { console.error("❌ 초기화 실패:", err); }
}