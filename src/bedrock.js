import 'dotenv/config';
import { StateGraph, END, START } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pool from "./db.js";
import axios from 'axios';

import { findSimilarContext } from "./services/searchService.js";

const region = process.env.AWS_REGION || "ap-northeast-2";
const apiKey = process.env.BEDROCK_API_KEY;

// AWS SDK 클라이언트 초기화
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
};

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


// pgvector 조회 — 해당 가게 매뉴얼에서 유사도 검색
async function retrieveKB(query, storeId) {
  console.log(`   🔎 [pgvector] store_id=${storeId} 매뉴얼 검색 중...`);
  return await findSimilarContext(query, storeId);
}

// 그래프 상태 정의
const graphState = {
  channels: {
    userQuery: null,
    caseId: null,
    storeId: null,
    category: null,
    historySummary: null,
    intent: null,
    sourceData: null,
    retrievedContext: null,
    finalAnswer: null,
    reason: null,
    retryCount: null,
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
    context: state.historySummary,
    category: state.category || "없음"
  });
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  let intent = "rag";
  if (jsonMatch) {
    try { intent = JSON.parse(jsonMatch[0]).decision || "rag"; } catch (e) { console.error("JSON 파싱 실패"); }
  }
  console.log(`   └─ ✅ 최종 결정: [${intent.toUpperCase()}]`);
  return { intent };
};

// 노드 4: API Agent
const apiNode = async (state) => {
  console.log(`\n🚀 [Node 4: API Agent] 연쇄 호출 시작...`);
  
  const apiSpec = await retrieveKB(state.userQuery, state.storeId);
  
  let accumulatedContext = "아직 호출된 API 없음";
  let iterations = 0;
  const maxIterations = 2;

  while (iterations < maxIterations) {
    console.log(`   --- [회차 ${iterations + 1} / ${maxIterations}] ---`);
    
    const rawParams = await invokePrompt(process.env.BEDROCK_API_ARN, { 
      user_input: state.userQuery,
      case_id: state.caseId,
      api_docs: apiSpec,
      context: accumulatedContext 
    });


    try {
      const jsonStart = rawParams.indexOf('{');
      const jsonEnd = rawParams.lastIndexOf('}');
      
      if (jsonStart === -1 || jsonEnd === -1) {
        console.log(`   └─ ⏹️ JSON 형식을 찾을 수 없어 루프를 종료합니다.`);
        break;
      }

      const cleanJson = rawParams.substring(jsonStart, jsonEnd + 1);
      const callInfo = JSON.parse(cleanJson);

      if (callInfo.action === "finish") {
        // 상품 정보를 물었는데 아직 product_id가 없다면 더 돌도록 유도
        if (state.userQuery.includes("상품") && !accumulatedContext.includes("product_id")) {
          accumulatedContext += "\n[시스템 알림]: 아직 상품 상세 정보(product_id)를 찾지 못했습니다. 추가 조회가 필요합니다.";
          iterations++;
          continue;
        }
        console.log(`   └─ ✅ 모든 정보 확보 완료.`);
        break;
      }

      // ID 값에서 중괄호 {} 제거
      const targetId = String(callInfo.i || state.caseId).replace(/\{|\}/g, "");
      let targetUrl = `${process.env.ROOT_URL}/${callInfo.r}`;
      
      // 경로 중복 방지
      if (targetId !== "null" && !callInfo.r.includes(targetId)) {
        targetUrl += `/${targetId}`;
      }

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

      console.log(`   └─ 🟢 [성공] ${callInfo.r} 데이터 획득`);
      
      // cases 조회 시 summary가 AI를 방해하지 않도록 처리
      let filteredData = res.data;
      if (callInfo.r === 'cases' || callInfo.r === 'case') {
        const { summary, ...rest } = res.data;
        filteredData = {
          ...rest,
          _note: "summary는 과거 상담 요약입니다. 무시하고 order_id 또는 reservation_id를 추출하세요."
        };
      }

      const stepResult = `\n[${iterations + 1}회차 결과 - ${callInfo.r}]: ${JSON.stringify(filteredData)}`;
      accumulatedContext = accumulatedContext === "아직 호출된 API 없음" ? stepResult : accumulatedContext + stepResult;
      iterations++;

    } catch (e) {
      console.error(`   └─ ❌ [파싱/호출 에러]:`, e.message);
      // 에러 발생 시 AI에게 상황을 알려주고 다시 시도하게 함
      accumulatedContext += `\n[에러]: ${e.message}. 올바른 JSON 형식과 경로로 다시 시도하세요.`;
      iterations++;
    }
  }

  return { 
    sourceData: accumulatedContext, 
    retrievedContext: apiSpec,
    retryCount: (state.retryCount || 0) + 1
  };
};

// 노드 5: RAG Agent
const ragNode = async (state) => {
  console.log(`📚 [Node 5: RAG Agent] 지식 검색 중...`);
  const docs = await retrieveKB(state.userQuery, state.storeId);
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

// 노드 5-2: Escalate (상담사 호출)
const escalateNode = async (state) => {
  console.log(`🚨 [Node 5-2: Escalate] 상담사 호출 처리 중...`);
  await pool.query(
    "UPDATE cases SET status = '대기' WHERE case_id = $1",
    [state.caseId]
  );
  return {
    finalAnswer: "죄송합니다. 고객님의 문의는 상담사가 직접 도움을 드려야 할 것 같습니다. 잠시만 기다려 주시면 상담사가 연결됩니다.",
    suggestedQuestions: []
  };
};

// 노드 6: Composer (Verifier 역할 통합)
const composerNode = async (state) => {
  console.log(`✍️ [Node 8/9: Composer] 답변 및 추천 질문 구성 중...`);
  
  const res = await invokePrompt(process.env.BEDROCK_COMPOSER_ARN, {
    user_input: state.userQuery,
    source_data: state.sourceData,
    history: state.historySummary
  });

  // [답변]과 [추천질문] 섹션을 정규표현식으로 분리
  const answerMatch = res.match(/\[답변\]\s*([\s\S]+?)(?=\[추천질문\]|$)/);
  const suggestionsMatch = res.match(/\[추천질문\]\s*([\s\S]+)/);

  const finalAnswer = answerMatch ? answerMatch[1].trim() : res.trim();
  
  // 추천 질문을 배열 형태로 변환 (숫자나 불렛 기호 제거)
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

// 병렬 실행 노드: guardrail + memory를 동시에 실행
const parallelPreNode = async (state) => {
  console.log(`\n⚡ [병렬] Guardrail + Memory 동시 실행...`);
  const [, memoryResult] = await Promise.all([
    guardrailNode(state),
    memoryLoaderNode(state),
  ]);
  return memoryResult; // guardrail은 차단 시 throw, 통과 시 결과 불필요
};

// 그래프 구축
const workflow = new StateGraph(graphState)
  .addNode("pre", parallelPreNode)
  .addNode("supervisor", supervisorNode)
  .addNode("api", apiNode)
  .addNode("rag", ragNode)
  .addNode("escalate", escalateNode)
  .addNode("composer", composerNode);

workflow.addEdge(START, "pre");
workflow.addEdge("pre", "supervisor");

workflow.addConditionalEdges("supervisor", (state) => state.intent, {
  api: "api",
  rag: "rag",
  escalate: "escalate",
});

workflow.addEdge("api", "composer");
workflow.addEdge("rag", "composer");
workflow.addEdge("escalate", END);
workflow.addEdge("composer", END);

const app = workflow.compile({ checkpointer });

// AICC 메인 프로세스
export async function processAICC(userQuery, caseId, storeId) {
  try {
    const { rows: caseRows } = await pool.query(
      'SELECT category FROM cases WHERE case_id = $1',
      [caseId]
    );
    const category = caseRows[0]?.category || null;

    const config = { configurable: { thread_id: String(caseId) } };
    const finalState = await app.invoke({ userQuery, caseId, storeId, category, retryCount: 0 }, config);
    const response = {
      ok: true,
      answer: finalState.finalAnswer, // 메인 답변
      suggestions: finalState.suggestedQuestions || [], // AI가 제안하는 다음 질문들
      caseId: String(caseId),
      reason: "완료"
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

// 상담 솔루션 분석 — 숫자는 코드가 계산, AI는 해석+솔루션만
export async function analyzeSolutions(statsText, summaryText) {
  const res = await invokePrompt(process.env.BEDROCK_SOLUTION_ANALYZER_ARN, {
    stats: statsText,
    summary_data: summaryText
  });
  try {
    const json = JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] || 'null');
    return json || { raw: res };
  } catch (e) { return { raw: res }; }
}

// 체크포인터 초기화
export async function initializeCheckpointer() {
  try {
    await checkpointer.setup();
    console.log("✅ [Checkpointer] 준비 완료");
  } catch (err) { console.error("❌ 초기화 실패:", err); }
}