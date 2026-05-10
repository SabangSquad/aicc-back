import 'dotenv/config';
import { StateGraph, END, START } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pool from "./db.js";
import axios from 'axios';

import { invokePrompt } from "./llm/client.js";
import { findSimilarContext } from "./services/searchService.js";

// PostgreSQL 체크포인터
const checkpointer = new PostgresSaver(pool);

// 토큰 오버플로우 방지: 한국어 1토큰 ≈ 1.5~2자 가정. 안전하게 1.5로 계산.
// 모델 컨텍스트 3072. 출력 512 + 시스템프롬프트 400 + 질문 50 = 약 962 예약. 입력 변수 합계 2000 토큰 이내 권장.
function truncate(text, maxChars, opts = {}) {
  if (!text) return text;
  const str = String(text);
  if (str.length <= maxChars) return str;
  const keepEnd = opts.keepEnd === true; // 최근 정보 보존(history용)
  if (keepEnd) {
    return "...(앞부분 생략)\n" + str.slice(-maxChars);
  }
  return str.slice(0, maxChars) + "\n...(이하 생략)";
}
const internalApiBaseUrl = (
  process.env.INTERNAL_API_BASE_URL ||
  (process.env.NODE_ENV === "production" ? "http://aicc-back:4000" : process.env.ROOT_URL)
).replace(/\/+$/, "");


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
    storeCategory: null,
    customerId: null,
    category: null,
    historySummary: null,
    intent: null,
    sourceData: null,
    retrievedContext: null,
    finalAnswer: null,
    loginMessage: null,
    showReservationForm: null,
    availableSlots: null,
    shipmentInfo: null,
    dateStart: null,
    dateEnd: null,
    productKeyword: null,
    reservationType: null,
    reason: null,
    retryCount: null,
    sources: null,
    apiCallTrace: null,
  }
};

// 가드레일 regex shortcut — 명백히 안전한 케이스는 LLM 없이 즉시 PASS
function isGuardrailObviouslySafe(q) {
  // 위험 패턴 한 가지라도 있으면 LLM에 맡김 (단, "주문/예약/송장번호"는 정상 문의이므로 제외)
  if (/주민번호|카드번호|계좌번호|비밀번호|시스템\s*프롬프트|jailbreak|ignore.*instruction/i.test(q)) {
    return false;
  }
  // 길이가 너무 길면 LLM에 맡김 (복잡한 의도일 수 있음)
  if (q.length > 200) return false;

  // "내 X" 본인 데이터 조회는 항상 안전
  if (/^내\s|내\s(주문|배송|예약|정보|계정|품목|상품|이력)/.test(q)) return true;

  // 가게 운영 관련 명백한 키워드 포함
  const safe = /(주문|배송|환불|교환|취소|예약|상품|메뉴|영업|위치|주소|주차|진료|편의|와이파이|화장실|픽업|포장|배달|결제|영수증|송장|운송장|택배|규정|정책)/;
  if (safe.test(q)) return true;

  // 인사/단답
  if (/^(안녕|반갑|감사|고마워|반가워|네|아니|알겠|ok|hi|hello|ㅎㅇ|ㅋ|ㅎ|응|넵|좋아)/i.test(q.trim())) {
    return true;
  }

  return false;
}

// 그래프 노드 정의
const guardrailNode = async (state) => {
  // 노드 1: 가드레일
  console.log(`\n🔍 [Node 1: Guardrail] 검사 시작...`);

  // Regex shortcut — 명백히 안전한 입력은 LLM 호출 생략
  if (isGuardrailObviouslySafe(state.userQuery)) {
    console.log(`   ⚡ [Skip LLM] regex로 PASS`);
    return { ...state };
  }

  const res = await invokePrompt("guardrail", {
    user_input: state.userQuery
  });

  let data = null;
  try {
    data = JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] || "null");
  } catch (err) {
    console.error("[Guardrail] JSON 파싱 실패:", err.message);
  }

  if (data?.status === "REJECT") {
    console.error(`🚨 [Node 1: Guardrail] 부적절한 요청 차단됨`);
    throw new Error("GUARDRAIL_BLOCKED");
  }
  return { ...state };
};

// 노드 2: Memory Loader
const memoryLoaderNode = async (state) => {
  console.log(`📂 [Node 2: Memory Loader] 로드 중...`);
  const { rows } = await pool.query(
    "SELECT speaker, content FROM messages WHERE case_id = $1 ORDER BY occurred_at DESC LIMIT 10",
    [state.caseId]
  );

  // 메시지 없음 → LLM 호출 스킵
  if (rows.length === 0) {
    console.log(`   └─ ⚡ [Skip LLM] 이전 메시지 없음`);
    return { historySummary: "이전 맥락 없음" };
  }

  const historyText = rows.reverse().map(r => `${r.speaker}: ${r.content}`).join("\n");

  // 메시지 3개 이하면 raw 그대로 사용 (요약 LLM 호출 불필요)
  if (rows.length <= 3) {
    console.log(`   └─ ⚡ [Skip LLM] 메시지 ${rows.length}개 → raw 사용`);
    return { historySummary: historyText };
  }

  // 4~10개일 때 LLM 요약 (구체 데이터 보존하면서 압축)
  const summary = await invokePrompt("memoryLoader", {
    past_logs: truncate(historyText, 2500, { keepEnd: true }),
    user_input: state.userQuery
  });
  return { historySummary: summary };
};

// Supervisor regex shortcut — 명백한 패턴은 LLM 없이 즉시 분류
function trySupervisorShortcut(state) {
  const q = state.userQuery.trim();
  const sc = state.storeCategory;

  // 1) 인사/단순 응답
  if (/^(안녕|반갑|감사|고마워|반가워|hi|hello|ㅎㅇ)/i.test(q) && q.length <= 15) {
    return {
      intent: 'greeting',
      sourceData: '고객이 인사 또는 단순 응답을 했습니다. 친절하게 인사하고 무엇을 도와드릴지 물어보세요.',
    };
  }

  // 2) "내 정보/계정/프로필" — 로그인 시 항상 api
  if (/^내\s*(정보|계정|프로필)\b/.test(q) && state.customerId) {
    return { intent: 'api' };
  }

  // 3) "내 주문/배송" 단순 조회 — 날짜/행동 동사 없을 때만, 이커머스/null 업종에서만
  const hasComplexity = /\d{1,2}월|\d{1,2}일|내일|모레|오늘|어제|이번\s*주|다음\s*주|취소|환불|교환|변경|할게|해줘|싶/;
  if (/^내\s*(주문|배송)\b/.test(q) && !hasComplexity.test(q) && state.customerId && (sc === '이커머스' || !sc)) {
    return { intent: 'api' };
  }

  return null;
}

// 노드 3: Supervisor
const supervisorNode = async (state) => {
  // pre 단계에서 이미 분류됐으면 스킵 (첫 턴 병렬 실행 케이스)
  if (state.intent) {
    console.log(`   ⚡ [Skip Supervisor] pre에서 이미 분류 완료: ${state.intent}`);
    return {};
  }

  // Regex shortcut — 명백한 패턴은 LLM 호출 생략
  const shortcut = trySupervisorShortcut(state);
  if (shortcut) {
    console.log(`   ⚡ [Skip LLM] regex 분류: ${shortcut.intent}`);
    return shortcut;
  }

  console.log(`🎯 [Node 3: Supervisor] 분류 중...`);
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    timeZone: 'Asia/Seoul'
  });
  const raw = await invokePrompt("supervisor", {
    user_input: state.userQuery,
    context: truncate(state.historySummary, 1000, { keepEnd: true }),
    category: state.category || "없음",
    store_category: state.storeCategory || "없음",
    today: today
  });
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  let intent = "rag";
  let dateStart = null;
  let dateEnd = null;
  let productKeyword = null;
  let reservationType = null;
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      intent = parsed.decision || "rag";
      dateStart = parsed.date_start || null;
      dateEnd = parsed.date_end || null;
      productKeyword = parsed.product_keyword || null;
      reservationType = parsed.reservation_type || null;
    } catch (e) { console.error("JSON 파싱 실패"); }
  }
  // 업종별 제약 체크 — Supervisor intent + 핵심 키워드 기반
  // 긴 메시지에서 부수적으로 포함된 키워드에 오판하지 않도록, intent가 해당 기능일 때만 차단
  const sc = state.storeCategory;
  const q = state.userQuery;
  if (sc) {
    const unsupported = (msg) => {
      console.log(`   └─ ⚠️ ${msg}`);
      return { intent: 'unsupported', finalAnswer: "__UNSUPPORTED__", suggestedQuestions: [] };
    };

    if (sc === '이커머스') {
      // Supervisor가 store로 분류 + 예약이 주요 의도인 경우만 차단
      if (intent === 'store' && q.match(/예약/) && !q.match(/환불|배송|상품|주문/)) return unsupported('이커머스에 예약 요청');
      if (intent === 'store' && q.match(/진료|과목/) && !q.match(/환불|배송|상품|주문/)) return unsupported('이커머스에 진료과목 요청');
      if (intent === 'store' && q.match(/메뉴/) && !q.match(/환불|배송|상품|주문/)) return unsupported('이커머스에 메뉴 요청');
    }
    if (sc === '병원') {
      if (intent === 'escalate') return unsupported('병원에 환불/교환/취소 요청');
      if (intent === 'store' && q.match(/메뉴/) && !q.match(/진료|예약/)) return unsupported('병원에 메뉴 요청');
    }
    if (sc === '식당') {
      if (intent === 'escalate') return unsupported('식당에 환불/교환/취소 요청');
      if (intent === 'store' && q.match(/진료|과목/) && !q.match(/예약|메뉴/)) return unsupported('식당에 진료과목 요청');
    }
  }

  // "예약" 키워드 처리 — 규정/절차 질문이면 rag, 본인 데이터면 api, 나머지는 store
  if (q.match(/예약/) && intent !== 'rag') {
    const isPolicyQuestion = q.match(/규정|절차|방법|어떻게|며칠|기간/);
    if (isPolicyQuestion) {
      intent = 'rag';
    } else if (q.match(/내\s*예약|예약.{0,4}확인|예약.{0,4}조회|취소된\s*예약|예약.{0,4}변경/)) {
      intent = 'api';
    } else {
      intent = 'store';
    }
  }

  // rag로 분류됐지만 규정/정책 질문이 아니면 store로 전환
  // 단, 인사/단순 응답은 rag 유지 (Composer가 자연스럽게 답변)
  if (sc && intent === 'rag') {
    const isGreeting = q.match(/^(안녕|반갑|감사|고마워|네|아니|알겠|ㅎㅇ|ㅋ|ㅎ|응|넵|좋아|오케이|ok|hi|hello)/i);
    if (isGreeting) {
      console.log(`   └─ 👋 인사/단순 응답 → composer로 직접 전달`);
      return { intent: 'greeting', sourceData: '고객이 인사 또는 단순 응답을 했습니다. 친절하게 인사하고 무엇을 도와드릴지 물어보세요.' };
    }
    const isActionRequest = q.match(/싶|할게|해주|해줘|하고|잡아|변경|취소/);
    const isPolicyQuestion = q.match(/규정|정책|절차|방법|어떻게|며칠|기간|이내|이후|가능|불가/);
    if (!isActionRequest && !isPolicyQuestion) {
      console.log(`   └─ 🔄 일반 정보 질문 → rag에서 store로 전환`);
      intent = "store";
    }
  }

  // escalate 시 비로그인이면 로그인 유도 (상담사 답변 알림을 위해 로그인 필수)
  if (intent === 'escalate' && !state.customerId) {
    console.log(`   └─ 🔒 에스컬레이션하려면 로그인 필요`);
    return { intent: 'escalate', finalAnswer: "__LOGIN_REQUIRED__", loginMessage: "상담사 연결을 위해 로그인이 필요합니다.", suggestedQuestions: [] };
  }

  // 유효하지 않은 intent는 rag로 기본 처리
  const validIntents = new Set(['api', 'rag', 'store', 'escalate']);
  if (!validIntents.has(intent)) {
    console.log(`   └─ ⚠️ 알 수 없는 intent "${intent}" → rag로 처리`);
    intent = "rag";
  }

  // reservation_type 확정 — 모든 intent 전환 끝난 후 마지막에 판정
  if (intent === 'store') {
    const isReservationQuery = !!q.match(/예약|언제|가능|빈|비어|자리/);
    if (isReservationQuery) {
      if (!reservationType) {
        const actionVerbs = /할래|할게|하자|하고\s*싶|해줘|해주세요|잡아|잡고\s*싶/;
        reservationType = actionVerbs.test(q) ? 'action' : 'inquiry';
      }
    } else {
      reservationType = null;
    }
  } else {
    reservationType = null;
  }

  console.log(`   └─ ✅ 최종 결정: [${intent.toUpperCase()}]${dateStart ? ` 날짜: ${dateStart}~${dateEnd}` : ''}${productKeyword ? ` 상품: ${productKeyword}` : ''}${reservationType ? ` 예약타입: ${reservationType}` : ''}`);
  return { intent, dateStart, dateEnd, productKeyword, reservationType };
};

// 노드 4: API Agent
const apiNode = async (state) => {
  console.log(`\n🚀 [Node 4: API Agent] 연쇄 호출 시작...`);

  // 비로그인 시 로그인 요청
  if (!state.customerId) {
    console.log(`   └─ 🔒 로그인 필요 — customer_id 없음`);
    let loginMessage = "해당 정보를 조회하려면 로그인이 필요합니다.";
    const q = state.userQuery;
    if (q.match(/주문|배송/)) loginMessage = "주문/배송 정보를 조회하려면 로그인이 필요합니다.";
    else if (q.match(/예약\s*(확인|조회)/)) loginMessage = "예약 정보를 확인하려면 로그인이 필요합니다.";
    else if (q.match(/내\s*정보/)) loginMessage = "고객 정보를 조회하려면 로그인이 필요합니다.";
    return {
      finalAnswer: "__LOGIN_REQUIRED__",
      loginMessage,
      suggestedQuestions: []
    };
  }

  // 가게 매뉴얼은 API 결정에 도움 안 되므로 pgvector 검색 생략 (성능)
  const apiSpec = "";

  let accumulatedContext = "아직 호출된 API 없음";
  let shipmentInfo = null;
  let iterations = 0;
  const dataSources = []; // 답변 근거가 된 API/DB 출처 목록
  const apiCallTrace = []; // 호출 경로 trace (디버그/관리자용)
  const pushSource = (type, id) => {
    if (id == null) return;
    const numId = typeof id === 'string' ? parseInt(id, 10) : id;
    if (Number.isNaN(numId)) return;
    if (!dataSources.find(s => s.type === type && s.id === numId)) {
      dataSources.push({ type, id: numId });
    }
  };
  // route → 단수 type 매핑
  const routeToType = (route) => {
    const head = String(route).split('/')[0];
    const map = {
      cases: 'case', orders: 'order', shipments: 'shipment',
      customers: 'customer', reservations: 'reservation',
      products: 'product', items: 'item', tracks: 'track',
    };
    return map[head] || head;
  };
  // cases pre-fetch이 1회차를 차지하고, 가장 긴 chain은 customers/orders → orders/shipments → shipments/tracks
  const maxIterations = 4;

  // 모든 사용자 데이터 조회는 cases 시작이 정해져 있으므로 LLM/HTTP 안 거치고 직접 SQL
  let caseRow = null;
  try {
    const { rows: caseRows } = await pool.query(
      `SELECT case_id, customer_id, store_id, order_id, reservation_id, category, status
       FROM cases WHERE case_id = $1`,
      [state.caseId]
    );
    if (caseRows.length === 0) throw new Error(`case_id ${state.caseId} not found`);
    caseRow = caseRows[0];
    const filteredCase = {
      ...caseRow,
      _note: "summary 무시. 질문에 맞는 ID로 다음 호출: 본인정보→customer_id, 주문/배송/품목→order_id, 예약→reservation_id."
    };
    accumulatedContext = `\n[1회차 결과 - cases/${state.caseId}]: ${JSON.stringify(filteredCase)}`;
    console.log(`   ⚡ [Skip LLM+HTTP] cases/${state.caseId} pre-fetch 완료 (customer_id=${caseRow.customer_id ?? 'none'}, order_id=${caseRow.order_id ?? 'none'}, reservation_id=${caseRow.reservation_id ?? 'none'})`);
    pushSource('case', state.caseId);
    apiCallTrace.push({ route: `cases/${state.caseId}`, method: 'SQL', ok: true });
    iterations = 1;
  } catch (e) {
    console.error(`   └─ ❌ cases pre-fetch 실패:`, e.message);
    // 실패해도 LLM에게 처음부터 결정하게 두기
  }

  // cases에 order_id 없는데 사용자가 주문 관련 질문 → 현재 가게의 주문 + 품목 + 상품명까지 한 번에 SQL prefetch
  if (caseRow && caseRow.order_id == null && caseRow.customer_id != null && /주문|배송|품목|상품|구매|결제|영수증|송장|운송장|택배/.test(state.userQuery)) {
    try {
      const { rows: orders } = await pool.query(
        `SELECT
           o.order_id, o.status, o.total_price, o.ordered_at,
           COALESCE(
             json_agg(
               json_build_object(
                 'product_id', i.product_id,
                 'product_name', p.name,
                 'quantity', i.quantity,
                 'total_price', i.total_price
               )
               ORDER BY i.item_id
             ) FILTER (WHERE i.item_id IS NOT NULL),
             '[]'::json
           ) AS items
         FROM orders o
         LEFT JOIN items i ON i.order_id = o.order_id
         LEFT JOIN products p ON p.product_id = i.product_id
         WHERE o.customer_id = $1 AND o.store_id = $2
         GROUP BY o.order_id, o.status, o.total_price, o.ordered_at
         ORDER BY o.ordered_at DESC
         LIMIT 5`,
        [caseRow.customer_id, caseRow.store_id]
      );
      const stepResult = `\n[2회차 결과 - customers/${caseRow.customer_id}/orders (현재 가게, items 포함)]: ${JSON.stringify({ data: orders })}`;
      accumulatedContext += stepResult;
      console.log(`   ⚡ [Skip LLM+HTTP] customers/${caseRow.customer_id}/orders+items pre-fetch 완료 (${orders.length}건)`);
      pushSource('customer', caseRow.customer_id);
      orders.forEach(o => pushSource('order', o.order_id));
      apiCallTrace.push({ route: `customers/${caseRow.customer_id}/orders`, method: 'SQL', ok: true, count: orders.length });
      iterations = 2;
    } catch (e) {
      console.error(`   └─ ❌ orders pre-fetch 실패:`, e.message);
    }
  }

  // cases에 reservation_id 없는데 사용자가 예약 관련 질문 → 현재 가게의 본인 예약 SQL prefetch
  if (caseRow && caseRow.reservation_id == null && caseRow.customer_id != null && /예약/.test(state.userQuery)) {
    try {
      const { rows: reservations } = await pool.query(
        `SELECT reservation_id, reserved_at, status, headcount
         FROM reservations
         WHERE customer_id = $1 AND store_id = $2
         ORDER BY reserved_at DESC
         LIMIT 5`,
        [caseRow.customer_id, caseRow.store_id]
      );
      const stepResult = `\n[${iterations + 1}회차 결과 - customers/${caseRow.customer_id}/reservations (현재 가게)]: ${JSON.stringify({ data: reservations })}`;
      accumulatedContext += stepResult;
      console.log(`   ⚡ [Skip LLM+HTTP] customers/${caseRow.customer_id}/reservations pre-fetch 완료 (${reservations.length}건)`);
      pushSource('customer', caseRow.customer_id);
      reservations.forEach(r => pushSource('reservation', r.reservation_id));
      apiCallTrace.push({ route: `customers/${caseRow.customer_id}/reservations`, method: 'SQL', ok: true, count: reservations.length });
      iterations++;
    } catch (e) {
      console.error(`   └─ ❌ reservations pre-fetch 실패:`, e.message);
    }
  }

  while (iterations < maxIterations) {
    console.log(`   --- [회차 ${iterations + 1} / ${maxIterations}] ---`);
    
    const rawParams = await invokePrompt("apiAgent", {
      user_input: state.userQuery,
      case_id: state.caseId,
      api_docs: apiSpec,
      context: truncate(accumulatedContext, 3000, { keepEnd: true })
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
      let targetUrl = `${internalApiBaseUrl}/${callInfo.r}`;

      // 경로 중복 방지
      if (targetId !== "null" && !callInfo.r.includes(targetId)) {
        targetUrl += `/${targetId}`;
      }

      // 무한 루프 방지: 이미 호출한 경로 또 호출하면 강제 finish
      if (accumulatedContext.includes(`결과 - ${callInfo.r}]`)) {
        console.log(`   └─ ⏹️ 이미 호출한 경로(${callInfo.r}) 재요청 → 강제 finish`);
        break;
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

      // 출처 추적
      const sourceType = routeToType(callInfo.r);
      pushSource(sourceType, targetId);
      apiCallTrace.push({ route: callInfo.r, id: targetId !== 'null' ? targetId : null, method: callInfo.m || 'GET', ok: true });

      // cases 조회 시 summary가 AI를 방해하지 않도록 처리
      let filteredData = res.data;
      if (callInfo.r === 'cases' || callInfo.r === 'case') {
        const { summary, ...rest } = res.data;
        filteredData = {
          ...rest,
          _note: "summary는 과거 상담 요약입니다. 무시하고 order_id 또는 reservation_id를 추출하세요."
        };
      }

      // 배송 관련 응답에서 구조화 메타데이터 추출 (프론트 전달용)
      if (/\/shipments$/.test(callInfo.r) || /shipments\/?$/.test(callInfo.r)) {
        const shipment = Array.isArray(res.data?.data) ? res.data.data[0] : null;
        if (shipment?.shipment_id) {
          shipmentInfo = { ...(shipmentInfo || {}), ...shipment };
          pushSource('shipment', shipment.shipment_id);
        }
      }
      if (/\/tracks$/.test(callInfo.r)) {
        const tracks = Array.isArray(res.data?.data) ? res.data.data : null;
        if (tracks) {
          shipmentInfo = { ...(shipmentInfo || {}), tracks };
        }
      }

      const stepResult = `\n[${iterations + 1}회차 결과 - ${callInfo.r}]: ${JSON.stringify(filteredData)}`;
      accumulatedContext = accumulatedContext === "아직 호출된 API 없음" ? stepResult : accumulatedContext + stepResult;
      iterations++;

      // LLM이 done:true로 마지막 호출이라고 표시하면 finish LLM 호출 생략
      if (callInfo.done === true) {
        console.log(`   └─ ⚡ [Skip LLM] done:true — finish 호출 생략`);
        break;
      }

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
    shipmentInfo,
    sources: dataSources,
    apiCallTrace,
    retryCount: (state.retryCount || 0) + 1
  };
};

// 노드 5: RAG Agent
const ragNode = async (state) => {
  console.log(`📚 [Node 5: RAG Agent] 지식 검색 중...`);
  const { context: docs, sources } = await retrieveKB(state.userQuery, state.storeId);
  const res = await invokePrompt("ragAgent", {
    user_query: state.userQuery,
    retrieved_context: truncate(docs, 2500),
    history: truncate(state.historySummary || "이전 맥락 없음", 1000, { keepEnd: true })
  });
  console.log(`   └─ 📎 매뉴얼 ${sources.length}건 매칭 (top score: ${sources[0]?.score ?? 'N/A'})`);
  return {
    sourceData: res,
    retrievedContext: docs,
    sources,
    retryCount: (state.retryCount || 0) + 1
  };
};

// 노드 5-2: Escalate (상담사 호출 + AI 요약/추천 답변 생성)
const escalateNode = async (state) => {
  console.log(`🚨 [Node 5-2: Escalate] 상담사 호출 처리 중...`);

  // 대화 조회 → AI 분석 (요약 + 감정 + 추천 답변)
  const { rows: msgs } = await pool.query(
    "SELECT speaker, content FROM messages WHERE case_id = $1 ORDER BY occurred_at ASC",
    [state.caseId]
  );

  let summary = null;
  let emotion = null;
  let category = null;

  if (msgs.length > 0) {
    try {
      const text = msgs.map(m => `${m.speaker}: ${m.content}`).join('\n');
      const analysis = await analyzeCaseConversation(text, state.storeCategory);
      const suggestedReply = analysis.json?.suggested_reply ?? null;
      summary = analysis.json?.summary ?? null;
      if (suggestedReply) summary += `\n\n[추천 답변] ${suggestedReply}`;
      emotion = analysis.json?.emotion ?? null;
      category = analysis.json?.category ?? null;
    } catch (err) {
      console.error('[Escalate] AI 분석 실패:', err.message);
    }
  }

  // summary + emotion + category + status='대기' 저장
  await pool.query(
    "UPDATE cases SET status = '대기', summary = $1, emotion = $2, category = COALESCE($3, category) WHERE case_id = $4",
    [summary, emotion, category, state.caseId]
  );

  return {
    finalAnswer: "죄송합니다. 고객님의 문의는 상담사가 직접 도움을 드려야 할 것 같습니다. 잠시만 기다려 주시면 상담사가 연결됩니다.",
    suggestedQuestions: []
  };
};


// 고객 질문에서 날짜 범위 추출
function extractDateRange(query) {
  const today = new Date();

  if (query.match(/내일/)) {
    const d = new Date(today); d.setDate(d.getDate() + 1);
    const end = new Date(d); end.setHours(23, 59, 59);
    d.setHours(0, 0, 0);
    return { start: d, end, label: '내일' };
  }
  if (query.match(/모레/)) {
    const d = new Date(today); d.setDate(d.getDate() + 2);
    const end = new Date(d); end.setHours(23, 59, 59);
    d.setHours(0, 0, 0);
    return { start: d, end, label: '모레' };
  }
  if (query.match(/이번\s*주/)) {
    const start = new Date(today); start.setHours(0, 0, 0);
    const end = new Date(today); end.setDate(end.getDate() + (7 - end.getDay())); end.setHours(23, 59, 59);
    return { start, end, label: '이번 주' };
  }
  if (query.match(/다음\s*주/)) {
    const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
    const dayMatch = query.match(/(월|화|수|목|금|토|일)요일/);
    if (dayMatch) {
      const target = dayMap[dayMatch[1]];
      const d = new Date(today);
      const daysUntilNextWeek = (7 - d.getDay()) + target || 7;
      d.setDate(d.getDate() + daysUntilNextWeek);
      const end = new Date(d); end.setHours(23, 59, 59);
      d.setHours(0, 0, 0);
      return { start: d, end, label: `다음 주 ${dayMatch[1]}요일` };
    }
    // 요일 없이 "다음 주"만
    const start = new Date(today);
    start.setDate(start.getDate() + (7 - start.getDay()) + 1); start.setHours(0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59);
    return { start, end, label: '다음 주' };
  }
  // "3월 26일" 패턴
  const dateMatch = query.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (dateMatch) {
    const d = new Date(today.getFullYear(), parseInt(dateMatch[1]) - 1, parseInt(dateMatch[2]));
    const end = new Date(d); end.setHours(23, 59, 59);
    d.setHours(0, 0, 0);
    return { start: d, end, label: `${dateMatch[1]}월 ${dateMatch[2]}일` };
  }
  // 요일 패턴
  const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
  const dayMatch = query.match(/(월|화|수|목|금|토|일)요일/);
  if (dayMatch) {
    const target = dayMap[dayMatch[1]];
    const d = new Date(today);
    const diff = (target - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    const end = new Date(d); end.setHours(23, 59, 59);
    d.setHours(0, 0, 0);
    return { start: d, end, label: `${dayMatch[1]}요일` };
  }
  // 기본: 오늘~7일 후
  const start = new Date(today); start.setHours(0, 0, 0);
  const end = new Date(today); end.setDate(end.getDate() + 7); end.setHours(23, 59, 59);
  return { start, end, label: '이번 주' };
}

// 노드 5-3: Store (가게 정보 조회 — 로그인 불필요)
const DAY_NAMES = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };

function formatStoreInfo(data) {
  const lines = [];
  lines.push(`가게명: ${data.name}`);
  lines.push(`업종: ${data.category}`);
  lines.push(`주소: ${data.address}`);
  lines.push(`전화: ${data.phone}`);

  if (data.business_hours) {
    const bh = typeof data.business_hours === 'string' ? JSON.parse(data.business_hours) : data.business_hours;
    const hours = Object.entries(bh)
      .map(([day, time]) => `${DAY_NAMES[day] || day}: ${time === 'off' ? '휴무' : time}`)
      .join(', ');
    lines.push(`영업시간: ${hours}`);
  }

  if (data.facilities) {
    const fac = typeof data.facilities === 'string' ? JSON.parse(data.facilities) : data.facilities;
    const items = Object.entries(fac).map(([k, v]) => `${k}: ${v ? 'O' : 'X'}`).join(', ');
    lines.push(`편의시설: ${items}`);
  }

  if (data.notice) lines.push(`공지: ${data.notice}`);

  if (data.store_items) {
    const si = typeof data.store_items === 'string' ? JSON.parse(data.store_items) : data.store_items;
    if (si.menu) {
      const menu = si.menu.map(m => `${m.name} ${m.price}원${m.description ? ` (${m.description})` : ''}`).join(', ');
      lines.push(`메뉴: ${menu}`);
    }
    if (si.department) {
      lines.push(`진료과목: ${si.department.join(', ')}`);
    }
  }

  return lines.join('\n');
}

const storeNode = async (state) => {
  console.log(`🏪 [Node 5-3: Store] 가게 정보 조회 중...`);
  try {
    const headers = { "x-internal-secret": process.env.INTERNAL_SECRET_KEY, "Content-Type": "application/json" };

    const storeRes = await axios({ method: 'GET', url: `${internalApiBaseUrl}/stores/${state.storeId}`, headers });
    let info = formatStoreInfo(storeRes.data);

    // 이커머스 상품 조회 — keyword 있으면 ILIKE 검색, 없으면 전체(최대 20개)
    if (state.storeCategory === '이커머스') {
      try {
        const prodRes = await axios({ method: 'GET', url: `${internalApiBaseUrl}/stores/${state.storeId}/products`, headers });
        let products = prodRes.data?.data || [];

        if (state.productKeyword) {
          const keyword = state.productKeyword;
          const filtered = products.filter(p => p.name.toLowerCase().includes(keyword.toLowerCase()));
          if (filtered.length > 0) {
            const list = filtered.map(p => `${p.name} ${p.price.toLocaleString()}원`).join(', ');
            info += `\n상품 검색 결과 (\"${keyword}\"): ${list}`;
          } else {
            info += `\n상품 검색 결과 (\"${keyword}\"): 해당 상품을 찾을 수 없습니다.`;
          }
        } else {
          const limited = products.slice(0, 20);
          if (limited.length > 0) {
            const list = limited.map(p => `${p.name} ${p.price.toLocaleString()}원`).join(', ');
            info += `\n상품 목록: ${list}${products.length > 20 ? ` 외 ${products.length - 20}개` : ''}`;
          } else {
            info += `\n상품 목록: 등록된 상품이 없습니다.`;
          }
        }
      } catch (e) {
        console.error('[Store] 상품 목록 조회 실패:', e.message);
      }
    }

    // 예약 관련 질문이면 해당 기간 예약 현황 조회 + 빈 슬롯 계산
    const reservationType = state.reservationType; // 'inquiry' | 'action' | null
    const isReservationQuery = !!reservationType;
    let availableSlots = null;

    if (isReservationQuery) {
      try {
        // Supervisor가 추출한 날짜 우선, 없으면 extractDateRange 폴백
        let start, end, label;
        if (state.dateStart) {
          start = new Date(state.dateStart); start.setHours(0, 0, 0);
          end = new Date(state.dateEnd || state.dateStart); end.setHours(23, 59, 59);
          label = state.dateStart === state.dateEnd
            ? new Date(state.dateStart).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
            : `${state.dateStart} ~ ${state.dateEnd}`;
        } else {
          ({ start, end, label } = extractDateRange(state.userQuery));
        }

        const startStr = start.toISOString();
        const endStr = end.toISOString();
        const reservRes = await axios({
          method: 'GET',
          url: `${internalApiBaseUrl}/stores/${state.storeId}/reservations?start=${startStr}&end=${endStr}`,
          headers
        });
        const toLocalDateStr = (d) =>
          `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const reservations = (reservRes.data?.data || []).filter(r => r.status === '완료');
        const bookedTimes = new Set(reservations.map(r => {
          const d = new Date(r.reserved_at);
          return `${toLocalDateStr(d)}_${d.getHours()}`;
        }));

        // 영업시간에서 빈 슬롯 계산
        const bh = storeRes.data.business_hours;
        if (bh) {
          const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
          availableSlots = [];
          const current = new Date(start);
          while (current <= end) {
            const dayKey = dayKeys[current.getDay()];
            const hours = typeof bh === 'string' ? JSON.parse(bh) : bh;
            const timeRange = hours[dayKey];
            if (timeRange && timeRange !== 'off') {
              const [openStr, closeStr] = timeRange.split('-');
              const openHour = parseInt(openStr.split(':')[0]);
              const closeHour = parseInt(closeStr.split(':')[0]);
              const dateStr = toLocalDateStr(current);
              for (let h = openHour; h < closeHour; h++) {
                const key = `${dateStr}_${h}`;
                if (!bookedTimes.has(key)) {
                  availableSlots.push({ date: dateStr, time: `${String(h).padStart(2, '0')}:00` });
                }
              }
            }
            current.setDate(current.getDate() + 1);
          }
        }

        // Composer용 텍스트도 추가
        if (reservations.length > 0) {
          const booked = reservations.map(r => {
            const d = new Date(r.reserved_at);
            const date = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
            const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
            return `${date} ${time} (${r.headcount || '?'}명)`;
          }).join('\n  ');
          info += `\n${label} 예약된 시간:\n  ${booked}`;
        } else {
          info += `\n${label} 예약된 시간: 없음 (전 시간 가능)`;
        }

        // 해당 기간 일자별 영업시간을 명시적으로 추출 (Composer가 쉽게 인용하도록)
        if (bh) {
          const hours = typeof bh === 'string' ? JSON.parse(bh) : bh;
          const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
          const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
          const dayLines = [];
          const cur = new Date(start);
          while (cur <= end) {
            const dk = dayKeys[cur.getDay()];
            const dn = dayNames[cur.getDay()];
            const tr = hours[dk];
            dayLines.push(`${cur.getMonth()+1}월 ${cur.getDate()}일(${dn}) ${tr === 'off' ? '휴무' : tr}`);
            cur.setDate(cur.getDate() + 1);
          }
          info += `\n해당 기간 영업시간: ${dayLines.join(', ')}`;
        }

        // reservation_type별 Composer 지시사항
        if (reservationType === 'inquiry') {
          info += `\n(지시: 고객이 예약 가능 여부만 확인하는 조회 질문입니다. 해당 일자의 영업시간과 예약 현황을 구체적으로 안내하고, "예약을 원하시면 말씀해 주세요"로 마무리하세요. "채팅창에서 바로 예약하실 수 있습니다" 문구는 사용하지 마세요.)`;
        } else if (reservationType === 'action') {
          info += `\n(지시: 고객이 예약을 진행하려는 질문입니다. 가능한 시간을 안내하고 "채팅창에서 바로 예약하실 수 있습니다"로 마무리하세요.)`;
        }
      } catch (e) {
        console.error('[Store] 예약 현황 조회 실패:', e.message);
      }
    }

    // 예약 action + 비로그인 → 로그인 유도 (가능한 시간은 참고로 함께 전달)
    if (reservationType === 'action' && !state.customerId) {
      console.log(`   └─ 🔒 예약 진행 — 로그인 필요`);
      let loginMessage = "예약을 진행하시려면 로그인이 필요해요. 로그인해주시면 바로 잡아드릴게요!";
      if (availableSlots && availableSlots.length > 0) {
        // 날짜별로 묶고, 연속된 시간대는 범위로 표시
        const byDate = {};
        for (const s of availableSlots) {
          if (!byDate[s.date]) byDate[s.date] = [];
          byDate[s.date].push(parseInt(s.time));
        }
        const formatRanges = (hours) => {
          hours.sort((a, b) => a - b);
          const ranges = [];
          let s = hours[0], prev = hours[0];
          for (let i = 1; i < hours.length; i++) {
            if (hours[i] === prev + 1) {
              prev = hours[i];
            } else {
              ranges.push(s === prev ? `${String(s).padStart(2,'0')}:00` : `${String(s).padStart(2,'0')}:00~${String(prev+1).padStart(2,'0')}:00`);
              s = prev = hours[i];
            }
          }
          ranges.push(s === prev ? `${String(s).padStart(2,'0')}:00` : `${String(s).padStart(2,'0')}:00~${String(prev+1).padStart(2,'0')}:00`);
          return ranges.join(', ');
        };
        const lines = Object.entries(byDate).slice(0, 3).map(([date, hours]) => {
          const [, m, d] = date.split('-');
          return `${parseInt(m)}월 ${parseInt(d)}일: ${formatRanges(hours)}`;
        });
        loginMessage += `\n\n참고로 가능한 시간은 아래와 같아요.\n${lines.join('\n')}`;
      }
      return {
        finalAnswer: "__LOGIN_REQUIRED__",
        loginMessage,
        suggestedQuestions: []
      };
    }

    return {
      sourceData: info,
      // 폼은 action + 로그인 상태에서만 (inquiry는 텍스트 답변만)
      showReservationForm: reservationType === 'action',
      // availableSlots도 폼 띄울 때만 프론트에 전달
      availableSlots: reservationType === 'action' ? availableSlots : null
    };
  } catch (err) {
    console.error('[Store] 가게 정보 조회 실패:', err.message);
    return {
      finalAnswer: "죄송합니다. 현재 가게 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      suggestedQuestions: []
    };
  }
};

// 노드 6: Composer (Verifier 역할 통합)
const composerNode = async (state) => {
  // Greeting은 LLM 호출 없이 즉시 응답
  if (state.intent === 'greeting') {
    console.log(`   ⚡ [Skip LLM] Greeting 템플릿 응답`);
    return {
      finalAnswer: '안녕하세요! 무엇을 도와드릴까요?',
      suggestedQuestions: [],
    };
  }

  console.log(`✍️ [Node 8/9: Composer] 답변 구성 중...`);

  const res = await invokePrompt("composer", {
    user_input: state.userQuery,
    source_data: truncate(state.sourceData, 3000),
    history: truncate(state.historySummary, 1000, { keepEnd: true })
  });

  // 혹시 LLM이 [답변] 라벨을 붙여 출력해도 깨끗이 추출
  const answerMatch = res.match(/\[답변\]\s*([\s\S]+)/);
  const finalAnswer = (answerMatch ? answerMatch[1] : res).trim();

  return {
    finalAnswer,
    suggestedQuestions: [],
  };
};

// 병렬 실행 노드: guardrail + memory + (첫 턴이면 supervisor까지) 동시 실행
const parallelPreNode = async (state) => {
  // 메시지 개수 확인 — 첫 턴이면 메모리 불필요, supervisor까지 병렬 가능
  const { rows: cntRows } = await pool.query(
    "SELECT COUNT(*)::int AS cnt FROM messages WHERE case_id = $1",
    [state.caseId]
  );
  const msgCount = cntRows[0]?.cnt ?? 0;

  if (msgCount === 0) {
    console.log(`\n⚡ [병렬] Guardrail + Supervisor 동시 실행 (첫 턴, memory 생략)...`);
    const stateForSup = { ...state, historySummary: "이전 맥락 없음" };
    const [, supResult] = await Promise.all([
      guardrailNode(state),
      supervisorNode(stateForSup),
    ]);
    return { ...supResult, historySummary: "이전 맥락 없음" };
  }

  console.log(`\n⚡ [병렬] Guardrail + Memory 동시 실행...`);
  const [, memoryResult] = await Promise.all([
    guardrailNode(state),
    memoryLoaderNode(state),
  ]);
  return memoryResult;
};

// 그래프 구축
const workflow = new StateGraph(graphState)
  .addNode("pre", parallelPreNode)
  .addNode("supervisor", supervisorNode)
  .addNode("api", apiNode)
  .addNode("rag", ragNode)
  .addNode("escalate", escalateNode)
  .addNode("store", storeNode)
  .addNode("composer", composerNode);

workflow.addEdge(START, "pre");
workflow.addEdge("pre", "supervisor");

workflow.addConditionalEdges("supervisor", (state) => {
  if (state.intent === 'unsupported') return 'end';
  if (state.intent === 'greeting') return 'composer';
  return state.intent;
}, {
  api: "api",
  rag: "rag",
  store: "store",
  escalate: "escalate",
  composer: "composer",
  end: END,
});

workflow.addConditionalEdges("api", (state) => {
  if (state.finalAnswer === "__LOGIN_REQUIRED__") return "end";
  return "composer";
}, { end: END, composer: "composer" });
workflow.addEdge("rag", "composer");
workflow.addConditionalEdges("store", (state) => {
  if (state.finalAnswer === "__LOGIN_REQUIRED__") return "end";
  if (state.finalAnswer) return "end";
  return "composer";
}, { end: END, composer: "composer" });
workflow.addEdge("escalate", END);
workflow.addEdge("composer", END);

const app = workflow.compile({ checkpointer });

// 노드별 프론트 표시 메시지
const NODE_MESSAGES = {
  pre:        "이전 대화를 확인하고 있습니다...",
  supervisor: "질문의 의도를 파악하는 중입니다...",
  rag:        "관련 규정을 찾는 중입니다...",
  api:        "관련 정보를 찾는 중입니다...",
  store:      "가게 정보를 확인하는 중입니다...",
  escalate:   "상담사에게 연결하는 중입니다...",
  composer:   "답변을 작성하는 중입니다...",
};

// AICC 메인 프로세스 (SSE 스트리밍)
export async function processAICC(userQuery, caseId, storeId, customerId, res) {
  try {
    const { rows: caseRows } = await pool.query(
      'SELECT c.category, s.category AS store_category FROM cases c LEFT JOIN stores s ON c.store_id = s.store_id WHERE c.case_id = $1',
      [caseId]
    );
    const category = caseRows[0]?.category || null;
    const storeCategory = caseRows[0]?.store_category || null;

    const startTime = Date.now();
    const config = { configurable: { thread_id: String(caseId) } };

    // 이전 체크포인트의 상태가 carry-over 되지 않도록 턴마다 명시적으로 리셋
    const stream = await app.stream(
      {
        userQuery, caseId, storeId, storeCategory, customerId, category,
        retryCount: 0,
        intent: null,
        sourceData: null,
        retrievedContext: null,
        finalAnswer: null,
        loginMessage: null,
        showReservationForm: null,
        availableSlots: null,
        shipmentInfo: null,
        dateStart: null,
        dateEnd: null,
        productKeyword: null,
        reservationType: null,
        reason: null,
        sources: null,
        apiCallTrace: null,
      },
      config
    );

    let finalState = {};
    const decisionTrace = [];

    for await (const chunk of stream) {
      const nodeName = Object.keys(chunk)[0];
      const stateUpdate = chunk[nodeName];

      // 상태 누적
      finalState = { ...finalState, ...stateUpdate };

      // 의사결정 trace 기록 (노드 단위 요약)
      const traceStep = { step: nodeName };
      switch (nodeName) {
        case 'pre':
          traceStep.result = 'guardrail_pass + memory_loaded';
          break;
        case 'supervisor':
          traceStep.result = stateUpdate.intent || 'unknown';
          if (stateUpdate.reservationType) traceStep.reservationType = stateUpdate.reservationType;
          if (stateUpdate.dateStart) traceStep.dateRange = `${stateUpdate.dateStart}~${stateUpdate.dateEnd || stateUpdate.dateStart}`;
          break;
        case 'rag': {
          const ss = stateUpdate.sources || [];
          traceStep.result = `manuals_top${ss.length}`;
          if (ss[0]) traceStep.topScore = ss[0].score;
          break;
        }
        case 'api': {
          const calls = stateUpdate.apiCallTrace || [];
          traceStep.result = stateUpdate.finalAnswer === '__LOGIN_REQUIRED__'
            ? 'login_required'
            : `api_calls=${calls.length}`;
          if (calls.length) traceStep.routes = calls.map(c => c.route);
          break;
        }
        case 'store':
          traceStep.result = stateUpdate.finalAnswer === '__LOGIN_REQUIRED__'
            ? 'login_required'
            : (stateUpdate.showReservationForm ? 'store_with_form' : 'store_info');
          break;
        case 'escalate':
          traceStep.result = 'agent_called';
          break;
        case 'composer':
          traceStep.result = 'answer_generated';
          break;
        default:
          break;
      }
      decisionTrace.push(traceStep);

      // SSE로 진행 상황 전송
      const message = NODE_MESSAGES[nodeName];
      if (message && res) {
        res.write(`data: ${JSON.stringify({ type: 'thinking', message })}\n\n`);
      }

      console.log(`  ✓ [${nodeName}] 완료`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱️ [MAS 전체 추론시간] ${elapsed}초`);

    // 미지원 기능 감지
    if (finalState.finalAnswer === "__UNSUPPORTED__") {
      return {
        ok: true,
        answer: "죄송합니다. 해당 서비스는 이 가게에서 지원하지 않습니다.",
        caseId: String(caseId),
        reason: "미지원 기능",
        decisionTrace
      };
    }


    // 로그인 필요 감지
    if (finalState.finalAnswer === "__LOGIN_REQUIRED__") {
      return {
        ok: true,
        loginRequired: true,
        answer: finalState.loginMessage || "해당 정보를 조회하려면 로그인이 필요합니다.",
        caseId: String(caseId),
        reason: "로그인 필요",
        decisionTrace
      };
    }

    const INTENT_REASONS = {
      rag:         "매뉴얼 기반 답변",
      api:         "데이터 조회 기반 답변",
      store:       "가게 정보 조회",
      greeting:    "인사",
      escalate:    "상담사 연결",
    };

    // 답변 근거(explanation) 구성 — intent 기반으로 사람이 읽기 쉬운 형태
    let explanation = null;
    if (finalState.intent === 'rag') {
      explanation = {
        answerType: 'manual_rag',
        reason: '매뉴얼에서 유사한 규정을 검색해 답변했습니다.',
        sources: finalState.sources || []
      };
    } else if (finalState.intent === 'api') {
      explanation = {
        answerType: 'customer_data',
        reason: '로그인 고객의 주문/배송/예약 데이터를 조회해 답변했습니다.',
        dataSources: finalState.sources || []
      };
    } else if (finalState.intent === 'store') {
      explanation = {
        answerType: 'store_info',
        reason: '가게 기본 정보(영업시간/메뉴/예약현황 등)를 기반으로 답변했습니다.',
        dataSources: [{ type: 'store', id: Number(storeId) }]
      };
    } else if (finalState.intent === 'greeting') {
      explanation = {
        answerType: 'greeting',
        reason: '인사/단순 응답이라 별도 데이터 조회 없이 답변했습니다.'
      };
    } else if (finalState.intent === 'escalate') {
      explanation = {
        answerType: 'escalate',
        reason: '상담사 개입이 필요한 요청이라 케이스를 대기 상태로 전환했습니다.',
        dataSources: [{ type: 'case', id: Number(caseId) }]
      };
    }

    const response = {
      ok: true,
      answer: finalState.finalAnswer,
      caseId: String(caseId),
      reason: INTENT_REASONS[finalState.intent] || "답변 완료",
      ...(finalState.showReservationForm && { showReservationForm: true }),
      ...(finalState.availableSlots && { availableSlots: finalState.availableSlots }),
      ...(finalState.shipmentInfo && { shipmentInfo: finalState.shipmentInfo }),
      ...(explanation && { explanation }),
      decisionTrace
    };

    console.log(`\n🎁 [Final Response]`);
    console.log(`   📝 답변 요약: ${response.answer?.substring(0, 40)}...`);

    return response;
  } catch (err) {
    if (err.message === "GUARDRAIL_BLOCKED") return { answer: "죄송합니다. 입력하신 내용 중에 보안 정책상 제한된 표현이나 개인정보가 포함되어 있어 답변을 드릴 수 없습니다.", reason: "보안 차단" };
    console.error("AICC Error:", err);
    throw err;
  }
}

// 상담 분석
export async function analyzeCaseConversation(conversationText, storeCategory = null) {
  const res = await invokePrompt("caseWriter", {
    conversation_text: truncate(conversationText, 3500, { keepEnd: true }),
    store_category: storeCategory || "없음"
  });
  try {
    const json = JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] || 'null');
    return { rawText: res, json };
  } catch (e) { return { rawText: res, json: null }; }
}

// 상담 솔루션 분석 — 숫자는 코드가 계산, AI는 해석+솔루션만
export async function analyzeSolutions(statsText, summaryText) {
  const params = { stats: statsText, summary_data: summaryText };

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await invokePrompt("solutionAnalyzer", params);
    try {
      // JSON 블록 추출 (```json ... ``` 또는 { ... } 패턴)
      const cleaned = res.replace(/```json\s*/g, '').replace(/```\s*/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('JSON not found');

      const json = JSON.parse(match[0]);
      if (json.headline && json.issues && json.strategies) return json;
      throw new Error('Incomplete JSON');
    } catch (e) {
      console.error(`[Solutions] JSON 파싱 실패 (시도 ${attempt + 1}/2):`, e.message);
      if (attempt === 0) continue; // 1회 재시도
      return { raw: res };
    }
  }
}

// 체크포인터 초기화
export async function initializeCheckpointer() {
  try {
    await checkpointer.setup();
    console.log("✅ [Checkpointer] 준비 완료");
  } catch (err) { console.error("❌ 초기화 실패:", err); }
}
