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
async function retrieveKB(query, storeId, categoryHint = null) {
  console.log(`   🔎 [pgvector] store_id=${storeId} 매뉴얼 검색 중${categoryHint ? ` (카테고리 hint=${categoryHint})` : ''}...`);
  return await findSimilarContext(query, storeId, categoryHint);
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
  const safe = /(주문|배송|도착|수령|환불|교환|취소|반품|예약|진료|상품|메뉴|가격|영업|운영|매장|가게|병원|식당|쇼핑몰|위치|주소|주차|편의|와이파이|화장실|픽업|포장|배달|결제|영수증|송장|운송장|택배|규정|정책|문의|상담|몇\s*시|언제|몇\s*요일|쉬는\s*날|휴무)/;
  if (safe.test(q)) return true;

  // 인사/단답
  if (/^(안녕|반갑|감사|고마워|반가워|네|아니|알겠|ok|hi|hello|ㅎㅇ|ㅋ|ㅎ|응|넵|좋아)/i.test(q.trim())) {
    return true;
  }

  // 짧은 정보 문의 — "X 어떤 거" / "X 뭐예요" / "X 뭔지" / "X 알려" / "X 모르" 패턴
  // (상품/메뉴/진료과목 등 카탈로그 명사형 질문이 키워드 없이 들어올 때 차단되는 문제 방지)
  // 단, 가게 무관 단어("연예인/뉴스/날씨" 등)는 LLM에 맡김
  if (q.length <= 50 && /어떤\s*(거|건|것|지)|뭐예요|뭐야|뭔지|뭔가요|어떻게\s*돼|알려|설명|뭡니까|모르겠/.test(q)) {
    const offTopic = /손흥민|연예인|아이돌|배우|가수|영화|드라마|소설|시|뉴스|날씨|기온|정치|선거|대통령|스포츠|축구|야구|농구|일반\s*상식/;
    if (!offTopic.test(q)) return true;
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

  // 1-2) 단순 불만/감정 표현 — LLM 호출 없이 빠른 사과 + 재질문 (composer 템플릿)
  // "왜 이렇게 어렵죠/어려워요", "짜증나", "답답하네", "불편해요" 류
  if (q.length <= 40 && /왜\s*이렇게\s*(어렵|어려|복잡|불편|힘들|싫|짜증)|짜증\s*나|화\s*나|답답해?|답답하|불편해|어렵네요?|어려워|싫어요?/.test(q)) {
    return { intent: 'complaint' };
  }

  // 2) "내 정보/계정/프로필" — 로그인 시 항상 api
  // 한글에서 \b는 단어경계로 작동 안 하므로 (\s|$|을|를|이|가) 명시적으로 처리
  if (/^내\s*(정보|계정|프로필)(\s|$|을|를|이|가)/.test(q) && state.customerId) {
    return { intent: 'api' };
  }

  // 3) "내 주문/배송" 단순 조회 — 날짜/행동 동사 없을 때만, 이커머스/null 업종에서만
  // 주의: "해주/해줘"는 정중표현으로도 자주 쓰이므로 제외 ("확인해주세요"는 단순 조회)
  // 진짜 행동요청은 취소/환불/교환/변경 키워드로 식별
  const hasComplexity = /\d{1,2}월|\d{1,2}일|내일|모레|오늘|어제|이번\s*주|다음\s*주|취소|환불|교환|변경|할게|싶/;
  if (/^내\s*(주문|배송)(\s|$|을|를|이|가)/.test(q) && !hasComplexity.test(q) && state.customerId && (sc === '이커머스' || !sc)) {
    return { intent: 'api' };
  }
  // 4) "내 예약" 단순 조회 — 병원/식당/null 업종에서만
  if (/^내\s*예약(\s|$|을|를|이|가)/.test(q) && !hasComplexity.test(q) && state.customerId && (sc === '병원' || sc === '식당' || !sc)) {
    return { intent: 'api' };
  }

  // 4-1) "내 문의/상담 내역" — 본인 과거 상담 조회 (모든 업종)
  if (/^내\s*(문의|상담)(\s|$|을|를|이|가|\s*내역|\s*기록)/.test(q) && state.customerId) {
    return { intent: 'api' };
  }
  // 또는 "문의 내역 확인", "상담 내역 알려줘" 패턴
  if (/^(문의|상담)\s*(내역|기록|이력)/.test(q) && state.customerId) {
    return { intent: 'api' };
  }

  // 5) "주문/배송 정보/상태/확인/조회/내역" — "내" 생략된 본인 데이터 조회. 로그인 시 api
  if (/^(주문|배송)\s*(정보|상태|확인|조회|내역)/.test(q) && !hasComplexity.test(q) && state.customerId && (sc === '이커머스' || !sc)) {
    return { intent: 'api' };
  }
  // 6) "예약 확인/조회/내역" — 병원/식당/null. "예약 정보"는 절차/규정 의도일 수 있어 제외
  if (/^예약\s*(확인|조회|내역)/.test(q) && !hasComplexity.test(q) && state.customerId && (sc === '병원' || sc === '식당' || !sc)) {
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
      // 환불/교환/반품 escalate는 차단. 단 예약 관련 escalate(예약취소/변경)는 허용.
      if (intent === 'escalate' && q.match(/환불|교환|반품/) && !q.match(/예약/)) {
        return unsupported('병원에 환불/교환 요청');
      }
      if (intent === 'store' && q.match(/메뉴/) && !q.match(/진료|예약/)) return unsupported('병원에 메뉴 요청');
    }
    if (sc === '식당') {
      if (intent === 'escalate' && q.match(/환불|교환|반품/) && !q.match(/예약/)) {
        return unsupported('식당에 환불/교환 요청');
      }
      if (intent === 'store' && q.match(/진료|과목/) && !q.match(/예약|메뉴/)) return unsupported('식당에 진료과목 요청');
    }
  }

  // "예약 변경/취소" 처리 요청 → 무조건 escalate (병원/식당에서 상담사가 처리)
  // LLM이 store action으로 잘못 분류하는 경우 보정 (예: "예약 6시로 변경해줘", "예약 바꿀 수 있게 해줘")
  if ((sc === '병원' || sc === '식당') && intent !== 'escalate') {
    // 변경/취소 어근 모두 포함: 변경|취소|바꿔|바꾸|바꿀|바꿈|미루|미루|미루다|미룸|연기
    const isReservationChangeOrCancel = q.match(/예약.*?(변경|취소|바꿔|바꾸|바꿀|바꿈|미루|미룸|연기|미뤄)|(변경|취소|바꿔|바꾸|바꿀|바꿈|미루|미룸|연기|미뤄).*?예약/);
    const hasActionRequest = q.match(/해줘|해주|주세요|줘\s*$|줘\?|줘\.|줘\s|진행|부탁|할게|할래|하자|싶|있게|있어/);
    if (isReservationChangeOrCancel && hasActionRequest) {
      console.log(`   └─ 🔄 예약 변경/취소 처리 요청 → escalate 강제 (was: ${intent})`);
      intent = 'escalate';
    }
  }

  // "예약" 키워드 처리 — 규정/절차 질문이면 rag, 본인 데이터면 api, 나머지는 store
  // escalate(예약 변경/취소 처리 요청)는 supervisor LLM이 이미 분류한 것 → 덮어쓰지 말 것
  if (q.match(/예약/) && intent !== 'rag' && intent !== 'escalate') {
    const isPolicyQuestion = q.match(/규정|절차|방법|어떻게|며칠|기간/);
    if (isPolicyQuestion) {
      intent = 'rag';
    } else if (q.match(/내\s*예약|예약.{0,4}확인|예약.{0,4}조회|취소된\s*예약|예약.{0,4}변경/)) {
      intent = 'api';
    } else {
      intent = 'store';
    }
  }

  // "배송" 키워드 정책 질문은 rag로 강제 (보통/얼마나/며칠/기간 등 일반 정책)
  // "내 배송", "배송 어디까지" 같은 본인 데이터 조회는 이미 api로 갔으므로 여기 안 옴
  if (q.match(/배송/) && intent !== 'api' && intent !== 'rag') {
    const isDeliveryPolicy = q.match(/보통|얼마나|며칠|기간|일반적|평균|소요|걸리/);
    if (isDeliveryPolicy && !q.match(/내\s|^배송\s*(상태|확인|조회|어디|언제)/)) {
      console.log(`   └─ 🔄 배송 일반 정책 질문 → rag로 전환`);
      intent = 'rag';
    }
  }
  // "환불|교환|반품|취소|변경" 정책 질문은 LLM이 escalate로 잘못 분류해도 rag 강제
  // 행동 요청 키워드("해주/해줘/접수/처리")가 없으면 정책 질문으로 간주
  // 단, 명시적 본인 ID(주문번호/예약번호)가 있으면 데이터 검증 필요 → api로 (apiNode가 매뉴얼도 함께 fetch)
  if (q.match(/환불|교환|반품|취소|변경/) && intent !== 'api') {
    const isPolicyQuestion = q.match(/규정|정책|어떻게|며칠|기간|보통|가능|되나요|되요|되는지|할\s*수\s*있/);
    const isActionRequest = q.match(/해주|해줘|접수|처리|진행|받아|넣어/);
    const hasExplicitId = /주문\s*번?호?\s*\d|예약\s*번?호?\s*\d|\b\d{2,}\b/.test(q);
    if (isPolicyQuestion && !isActionRequest) {
      if (hasExplicitId && state.customerId) {
        if (intent !== 'api') console.log(`   └─ 🔄 본인 ID + 정책 질문 → api로 전환 (데이터+매뉴얼 결합 필요, was: ${intent})`);
        intent = 'api';
      } else {
        if (intent !== 'rag') console.log(`   └─ 🔄 환불/교환/취소/변경 정책 질문 → rag로 전환 (was: ${intent})`);
        intent = 'rag';
      }
    }
  }

  // 가게 정보 카탈로그 질문(상품정보/메뉴/진료과목/가격)은 store 강제
  // "내 주문 상품" 같은 명시적 본인 데이터 묻는 건 제외 ("그거 얼마?"는 메뉴 후속일 수 있어 포함)
  if (intent !== 'store' && !q.match(/내\s|주문\s*\d|주문번호|^내\s|^주문/)) {
    const isStoreInfo = q.match(/^(상품\s*정보|상품\s*설명|상품\s*소개|메뉴|진료과목|진료\s*과|가격|영업시간|운영시간|주차|위치|주소|공지)/);
    // "X 얼마?" / "X 가격?" 류 — 상품/메뉴명 + 가격 질문도 store
    const isItemPriceQuery = q.match(/얼마(예요|야|입니까|인가요)?\??$|얼마\s*예요|가격\s*(이|은)?\s*얼마|가격\s*(알려|알려줘)/);
    if (isStoreInfo || isItemPriceQuery) {
      console.log(`   └─ 🔄 가게 정보/가격 카탈로그 질문 → store 강제 (was: ${intent})`);
      intent = 'store';
    }
  }

  // "도착/수령/언제 와/어디쯤/지금 어디" — 본인 배송/주문 조회 의도. 로그인 + 일반 정책 아니면 api 강제
  // "보통 도착 시간" 같은 일반 정책은 위 배송 정책 룰에서 이미 rag로 처리됨
  if (state.customerId && intent !== 'api' && intent !== 'rag' && intent !== 'escalate' && intent !== 'store') {
    const isPersonalDeliveryQuery = q.match(/도착\s*(예정|언제|시간|함|했)|언제\s*(와|도착|배달|받|올|올까)|어디(쯤|까지)|지금\s*어디|받을\s*수\s*있/);
    const isGeneralPolicy = q.match(/보통|일반적|평균|기본/);
    if (isPersonalDeliveryQuery && !isGeneralPolicy) {
      console.log(`   └─ 🔄 본인 배송 조회 → api 강제`);
      intent = 'api';
    }
  }

  // 후속 정책 질문 — "수수료/요금/벌금/페널티" + memory에 정책 토픽 흔적 → rag 강제
  // 예: 이전 턴 "취소 규정?" → 이번 턴 "수수료 없어요?" → memory에 "취소" 흔적 있으니 같은 정책 매뉴얼 검색
  if (intent !== 'rag' && intent !== 'api' && intent !== 'escalate') {
    const isPolicyFollowup = q.match(/수수료|위약금|페널티|벌금|불이익|면제|^얼마|^비용|^요금/);
    const memHasPolicyTopic = state.historySummary && /규정|정책|취소|환불|교환|반품|변경|기한|마감/.test(state.historySummary);
    if (isPolicyFollowup && memHasPolicyTopic) {
      console.log(`   └─ 🔄 후속 정책 질문 (수수료/요금 등) + memory에 정책 토픽 → rag 강제 (was: ${intent})`);
      intent = 'rag';
    }
  }

  // 지시어("그거/이거/저거/그 주문/그 예약") + 본인 데이터 후속 조회 → api 강제
  // 단, 정책/규정 키워드 또는 가격 질문은 제외 (가격은 store/rag)
  if (state.customerId && intent !== 'api' && intent !== 'escalate') {
    const hasReference = q.match(/그거|이거|저거|그\s*(주문|배송|예약|상품|건)|방금|그건/);
    // "얼마" 제거 — "그거 얼마야?"는 메뉴 가격 후속(store)일 가능성 높음. 위 store 카탈로그 룰에서 처리됨
    const isInquiryAboutOwn = q.match(/뭐|어떻|언제|어디|상태|품목|상품|샀|시켰|주문했|받았|예약했/);
    const isPolicyQuestion = q.match(/규정|정책|어떻게\s*해|되나요|가능한가요|며칠|기간/);
    if (hasReference && isInquiryAboutOwn && !isPolicyQuestion) {
      console.log(`   └─ 🔄 지시어 + 본인 데이터 조회 → api 강제`);
      intent = 'api';
    }
  }

  // "상담 N" / "주문 N" / "예약 N" 명시적 ID + 본인 데이터 의도 → api 강제 (단, escalate는 보존)
  // escalate는 처리 요청(변경/취소)이므로 명시 ID 있어도 escalate가 우선
  // 예: "상담 1106 답변 언제 와?", "주문 503 상태?", "예약 27 확인"
  if (state.customerId && intent !== 'api' && intent !== 'escalate') {
    const hasExplicitEntityId = q.match(/(상담|주문|예약)\s*(번?호?)?\s*\d{2,}/);
    if (hasExplicitEntityId) {
      console.log(`   └─ 🔄 명시적 ID(${hasExplicitEntityId[0]}) → api 강제 (was: ${intent})`);
      intent = 'api';
    }
  }

  // "예약된 거 있는지/예약 확인/예약 잡혀있/예약 됐는지/예약한 거 언제" 본인 예약 조회 → api 강제
  // 신규 예약 의사("예약하고 싶어", "잡아줘")가 아니라 기존 예약 확인 패턴
  // 비로그인이어도 api로 보내서 "로그인 필요" 안내로 끝나게 (store action → 폼 띄우는 것 방지)
  // escalate(취소/변경 처리 요청)는 보존
  if (intent !== 'api' && intent !== 'escalate') {
    const isExistingReservationCheck = q.match(
      /예약(된|한)\s*(거|것|게|건)|예약\s*(확인|조회|내역)|예약\s*되어\s*있|예약\s*잡혀\s*있|예약\s*있(나|어|는지)|예약\s*(했|됐)는지|예약\s*(언제|시간|날짜)/
    );
    const isNewReservationIntent = q.match(/예약하고\s*싶|예약\s*잡아|예약해\s*줘|새로\s*예약|예약\s*가능한\s*(시간|날짜)/);
    if (isExistingReservationCheck && !isNewReservationIntent) {
      console.log(`   └─ 🔄 본인 예약 조회 → api 강제 (was: ${intent}, customerId=${state.customerId ?? 'none'})`);
      intent = 'api';
    }
  }

  // 페이지네이션 후속 요청 → api 강제 (escalate는 보존)
  // "다음 페이지", "N페이지", "더 보여줘" 등 + memory에 list 표시 흔적
  if (state.customerId && intent !== 'api' && intent !== 'escalate') {
    const isPagingQuery = q.match(/^\d+\s*페이지|다음\s*페이지|^더\s*(보여|줘|있)|^이후|^남은|\d+\s*번째\s*부터/);
    const memHasList = state.historySummary && /총\s*\d+건|\d+\s*[~\-–]\s*\d+\s*번째|상담\s*\d+|주문\s*\d+|예약\s*\d+/.test(state.historySummary);
    if (isPagingQuery && memHasList) {
      console.log(`   └─ 🔄 페이지 후속 요청 → api 강제 (was: ${intent})`);
      intent = 'api';
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
  // "예약" 명시적 키워드 있을 때만 예약 질문으로 간주.
  // "언제/가능/빈/비어/자리"는 "예약"과 함께 또는 예약 맥락에서만 의미.
  // 단독 "언제까지" 같은 건 영업시간 질문일 수 있음 → reservation_type null
  if (intent === 'store') {
    const hasExplicitReservation = !!q.match(/예약/);
    const hasReservationContextOnly = !!q.match(/빈\s*(자리|시간)|비어\s*있/);  // 예약 없이도 예약 의미 분명한 표현
    const isReservationQuery = hasExplicitReservation || hasReservationContextOnly;
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
    if (q.match(/예약(된|한)?\s*(거|것|게|건|확인|조회|있는|되어|잡혀|있나|있어|했는지|됐는지)/)) {
      loginMessage = "예약 정보를 확인하려면 로그인이 필요합니다.";
    } else if (q.match(/주문|배송/)) {
      loginMessage = "주문/배송 정보를 조회하려면 로그인이 필요합니다.";
    } else if (q.match(/내\s*정보/)) {
      loginMessage = "고객 정보를 조회하려면 로그인이 필요합니다.";
    } else if (q.match(/상담|문의/)) {
      loginMessage = "상담/문의 내역을 조회하려면 로그인이 필요합니다.";
    }
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
  if (caseRow && caseRow.order_id == null && caseRow.customer_id != null && /주문|배송|품목|상품|구매|결제|영수증|송장|운송장|택배|도착|수령|예정|어디쯤|샀|시켰|언제\s*(와|올|받|도착|배달)|그거|이거|저거|그\s*(주문|배송|상품|건)/.test(state.userQuery)) {
    try {
      // 질문에 시간 keyword 있으면 SQL에서 날짜 필터 (KST 기준)
      const q = state.userQuery;
      let timeFilter = '';
      let timeLabel = '';
      const params = [caseRow.customer_id, caseRow.store_id];
      if (/오늘/.test(q)) {
        timeFilter = ` AND o.ordered_at >= (NOW() AT TIME ZONE 'Asia/Seoul')::date AT TIME ZONE 'Asia/Seoul'`;
        timeLabel = ' (오늘 필터)';
      } else if (/어제/.test(q)) {
        timeFilter = ` AND o.ordered_at >= ((NOW() AT TIME ZONE 'Asia/Seoul')::date - INTERVAL '1 day') AT TIME ZONE 'Asia/Seoul' AND o.ordered_at < (NOW() AT TIME ZONE 'Asia/Seoul')::date AT TIME ZONE 'Asia/Seoul'`;
        timeLabel = ' (어제 필터)';
      } else if (/이번\s*주/.test(q)) {
        timeFilter = ` AND o.ordered_at >= (date_trunc('week', NOW() AT TIME ZONE 'Asia/Seoul'))::timestamp AT TIME ZONE 'Asia/Seoul'`;
        timeLabel = ' (이번 주 필터)';
      } else if (/이번\s*달/.test(q)) {
        timeFilter = ` AND o.ordered_at >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul'))::timestamp AT TIME ZONE 'Asia/Seoul'`;
        timeLabel = ' (이번 달 필터)';
      }

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
         WHERE o.customer_id = $1 AND o.store_id = $2${timeFilter}
         GROUP BY o.order_id, o.status, o.total_price, o.ordered_at
         ORDER BY o.ordered_at DESC
         LIMIT 5`,
        params
      );
      const stepResult = `\n[2회차 결과 - customers/${caseRow.customer_id}/orders${timeLabel}, items 포함]: ${JSON.stringify({ data: orders })}`;
      accumulatedContext += stepResult;
      console.log(`   ⚡ [Skip LLM+HTTP] customers/${caseRow.customer_id}/orders+items pre-fetch 완료${timeLabel} (${orders.length}건)`);
      pushSource('customer', caseRow.customer_id);
      orders.forEach(o => pushSource('order', o.order_id));
      apiCallTrace.push({ route: `customers/${caseRow.customer_id}/orders${timeLabel}`, method: 'SQL', ok: true, count: orders.length });
      iterations = 2;
    } catch (e) {
      console.error(`   └─ ❌ orders pre-fetch 실패:`, e.message);
    }
  }

  // "상담 N 답변 언제 와?" 같이 명시적 case_id 언급 → 본인 case 단건 조회 prefetch
  const caseIdMatch = state.userQuery.match(/상담\s*(번?호?)?\s*(\d{2,})/);
  if (caseRow && caseIdMatch && parseInt(caseIdMatch[2], 10) !== state.caseId) {
    const targetCaseId = parseInt(caseIdMatch[2], 10);
    try {
      const { rows: targetCase } = await pool.query(
        `SELECT c.case_id, c.status, c.category, c.summary, c.emotion, c.created_at, c.closed_at,
                (SELECT content FROM messages WHERE case_id = c.case_id AND speaker = '챗봇'
                 ORDER BY occurred_at DESC LIMIT 1) AS last_bot_msg,
                (SELECT occurred_at FROM messages WHERE case_id = c.case_id AND speaker = '챗봇'
                 ORDER BY occurred_at DESC LIMIT 1) AS last_bot_at
         FROM cases c
         WHERE c.case_id = $1 AND c.customer_id = $2 AND c.store_id = $3`,
        [targetCaseId, caseRow.customer_id, caseRow.store_id]
      );
      if (targetCase.length === 0) {
        accumulatedContext += `\n[상담 ${targetCaseId} 조회 결과]: 해당 상담을 찾을 수 없거나 본인 상담이 아닙니다.`;
        console.log(`   ⚠️ [Skip prefetch] 상담 ${targetCaseId} 본인 소유 아님 또는 미존재`);
      } else {
        const t = targetCase[0];
        const summary = t.summary ? t.summary.replace(/\n+/g, ' ').slice(0, 150) : '요약 없음';
        const date = t.created_at ? new Date(t.created_at).toISOString().split('T')[0] : '-';
        const closedAt = t.closed_at ? new Date(t.closed_at).toISOString().replace('T', ' ').slice(0, 16) : '-';
        const lastBotAt = t.last_bot_at ? new Date(t.last_bot_at).toISOString().replace('T', ' ').slice(0, 16) : '-';
        const lastBotMsg = t.last_bot_msg ? t.last_bot_msg.replace(/\n+/g, ' ').slice(0, 200) : '없음';
        accumulatedContext += `\n[상담 ${targetCaseId} 단건 조회]\n상담번호: ${targetCaseId}, 상태: ${t.status}, 카테고리: ${t.category || '-'}, 감정: ${t.emotion || '-'}, 접수: ${date}, 종료: ${closedAt}, 마지막 챗봇 답변 시각: ${lastBotAt}, 마지막 챗봇 답변: "${lastBotMsg}", 요약: ${summary}`;
        console.log(`   ⚡ [Skip LLM+HTTP] 상담 ${targetCaseId} 단건 prefetch 완료 (status=${t.status})`);
        pushSource('case', targetCaseId);
        apiCallTrace.push({ route: `cases/${targetCaseId}`, method: 'SQL', ok: true });
      }
      iterations++;
    } catch (e) {
      console.error(`   └─ ❌ 상담 ${targetCaseId} prefetch 실패:`, e.message);
    }
  }

  // 본인 과거 문의/상담 내역 조회 — closed cases (종료/AI자동해결) prefetch (페이지네이션 지원)
  const isCasesListQuery = caseRow && caseRow.customer_id != null && /^내\s*(문의|상담)|문의\s*내역|상담\s*내역|문의\s*기록|상담\s*기록|문의했|상담했/.test(state.userQuery);
  // 페이지 요청 ("다음 페이지", "N페이지", "N번째부터", "더 보여줘") + memory에 상담 표시 흔적
  const memHasCasesList = state.historySummary && /상담\s*\d+|상담 내역|문의 내역|총\s*\d+건/.test(state.historySummary);
  const pagingMatch = state.userQuery.match(/(\d+)\s*페이지|(\d+)\s*번째\s*부터|다음\s*(페이지|상담|문의)|^더\s*(보여|줘|있)|이후\s*(상담|문의)|남은\s*(상담|문의)/);
  const isCasesPagingQuery = memHasCasesList && pagingMatch && /상담|문의|페이지|더|이후|남은/.test(state.userQuery);

  if (isCasesListQuery || isCasesPagingQuery) {
    try {
      // OFFSET 계산
      let offset = 0;
      if (isCasesPagingQuery) {
        if (pagingMatch[1]) {
          offset = (parseInt(pagingMatch[1], 10) - 1) * 5;
        } else if (pagingMatch[2]) {
          offset = parseInt(pagingMatch[2], 10) - 1;
        } else if (/다음|더|이후|남은/.test(state.userQuery)) {
          // memory에서 직전 페이지 범위 추정 ("1~5번째" 또는 "1-5건" 등)
          const m = state.historySummary.match(/(\d+)\s*[~\-–]\s*(\d+)\s*(번째|건)/);
          offset = m ? parseInt(m[2], 10) : 5;
        }
      }

      const { rows: pastCases } = await pool.query(
        `SELECT case_id, category, status, summary, emotion, created_at, closed_at
         FROM cases
         WHERE customer_id = $1 AND store_id = $2
           AND case_id <> $3
           AND status IN ('종료', 'AI자동해결')
         ORDER BY created_at DESC LIMIT 5 OFFSET $4`,
        [caseRow.customer_id, caseRow.store_id, state.caseId, offset]
      );
      const { rows: totalRow } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM cases
         WHERE customer_id = $1 AND store_id = $2 AND case_id <> $3 AND status IN ('종료', 'AI자동해결')`,
        [caseRow.customer_id, caseRow.store_id, state.caseId]
      );
      const total = totalRow[0]?.total || 0;
      const start = offset + 1;
      const end = offset + pastCases.length;

      // 압축 텍스트 포맷 — 상담번호/날짜/요약만 (간결)
      const compactLines = pastCases.map(c => {
        const date = c.created_at ? new Date(c.created_at).toISOString().split('T')[0] : '-';
        const summary = c.summary ? c.summary.replace(/\n+/g, ' ').slice(0, 100) : '요약 없음';
        return `상담 ${c.case_id} | ${date} | ${summary}`;
      }).join('\n');

      let pagingNote = '';
      if (total > 5) {
        const hasMore = end < total;
        pagingNote = `\n(총 ${total}건 중 ${start}~${end}번째 표시${hasMore ? '. 더 보시려면 "다음 페이지" 또는 "N페이지"라고 말씀해 주세요.' : '. 마지막 페이지입니다.'})`;
      }

      const stepResult = `\n[${iterations + 1}회차 결과 - 과거 종료된 상담 ${pastCases.length}건]:\n${compactLines || '(과거 종료 상담 없음)'}${pagingNote}`;
      accumulatedContext += stepResult;
      console.log(`   ⚡ [Skip LLM+HTTP] cases prefetch (closed, offset=${offset}) 완료 (${pastCases.length}건 / 총 ${total}건)`);
      pushSource('customer', caseRow.customer_id);
      pastCases.forEach(c => pushSource('case', c.case_id));
      apiCallTrace.push({ route: `customers/${caseRow.customer_id}/cases (closed, offset=${offset})`, method: 'SQL', ok: true, count: pastCases.length });
      iterations++;
    } catch (e) {
      console.error(`   └─ ❌ cases pre-fetch 실패:`, e.message);
    }
  }

  // cases에 reservation_id 없는데 사용자가 예약 관련 질문 → 현재 가게의 본인 예약 SQL prefetch
  if (caseRow && caseRow.reservation_id == null && caseRow.customer_id != null && /예약/.test(state.userQuery)) {
    try {
      // 시간 키워드 → SQL 필터 (KST)
      const q = state.userQuery;
      let timeFilter = '';
      let timeLabel = '';
      if (/오늘/.test(q)) {
        timeFilter = ` AND reserved_at >= (NOW() AT TIME ZONE 'Asia/Seoul')::date AT TIME ZONE 'Asia/Seoul' AND reserved_at < ((NOW() AT TIME ZONE 'Asia/Seoul')::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Seoul'`;
        timeLabel = ' (오늘 필터)';
      } else if (/내일/.test(q)) {
        timeFilter = ` AND reserved_at >= ((NOW() AT TIME ZONE 'Asia/Seoul')::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Seoul' AND reserved_at < ((NOW() AT TIME ZONE 'Asia/Seoul')::date + INTERVAL '2 day') AT TIME ZONE 'Asia/Seoul'`;
        timeLabel = ' (내일 필터)';
      } else if (/이번\s*주/.test(q)) {
        timeFilter = ` AND reserved_at >= (date_trunc('week', NOW() AT TIME ZONE 'Asia/Seoul'))::timestamp AT TIME ZONE 'Asia/Seoul' AND reserved_at < ((date_trunc('week', NOW() AT TIME ZONE 'Asia/Seoul') + INTERVAL '7 day'))::timestamp AT TIME ZONE 'Asia/Seoul'`;
        timeLabel = ' (이번 주 필터)';
      }

      const { rows: reservations } = await pool.query(
        `SELECT reservation_id, reserved_at, status, headcount
         FROM reservations
         WHERE customer_id = $1 AND store_id = $2${timeFilter}
         ORDER BY reserved_at DESC
         LIMIT 5`,
        [caseRow.customer_id, caseRow.store_id]
      );
      // 압축 텍스트 — headcount는 "명" 단위로 명시 (LLM이 "인분"으로 환각 방지)
      const reservationLines = reservations.map(r => {
        const dt = r.reserved_at ? new Date(r.reserved_at).toISOString().replace('T', ' ').slice(0, 16) : '-';
        return `예약 ${r.reservation_id} | ${dt} | ${r.status} | ${r.headcount || '?'}명`;
      }).join('\n');
      const stepResult = `\n[${iterations + 1}회차 결과 - 본인 예약${timeLabel} ${reservations.length}건]:\n${reservationLines || '(예약 없음)'}`;
      accumulatedContext += stepResult;
      console.log(`   ⚡ [Skip LLM+HTTP] customers/${caseRow.customer_id}/reservations pre-fetch 완료${timeLabel} (${reservations.length}건)`);
      pushSource('customer', caseRow.customer_id);
      reservations.forEach(r => pushSource('reservation', r.reservation_id));
      apiCallTrace.push({ route: `customers/${caseRow.customer_id}/reservations${timeLabel}`, method: 'SQL', ok: true, count: reservations.length });
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
      context: truncate(accumulatedContext, 2000, { keepEnd: true })
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

      // 본인 목록 조회는 항상 현재 가게로 필터 + limit 5로 응답 크기 제한 (컨텍스트 보호)
      let safeParams = callInfo.p || {};
      const isCustomerList = /^customers\/[^/]+\/(orders|reservations|cases)\/?$/.test(callInfo.r);
      if (isCustomerList) {
        if (state.storeId) safeParams = { ...safeParams, store_id: state.storeId };
        if (!safeParams.limit) safeParams.limit = 5;
      }

      const res = await axios({
        method: callInfo.m || 'GET',
        url: targetUrl,
        params: safeParams,
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

      // customers/X/cases 응답은 너무 길어질 수 있으므로 압축 텍스트로 변환 (상담번호/날짜/요약만)
      if (/^customers\/[^/]+\/cases\/?$/.test(callInfo.r) && Array.isArray(res.data?.data)) {
        const compact = res.data.data.slice(0, 5).map(c => {
          const date = c.created_at ? new Date(c.created_at).toISOString().split('T')[0] : '-';
          const summary = c.summary ? c.summary.replace(/\n+/g, ' ').slice(0, 100) : '요약 없음';
          return `상담 ${c.case_id} | ${date} | ${summary}`;
        }).join('\n');
        filteredData = `${compact || '(상담 없음)'} (총 ${res.data.total ?? res.data.data.length}건)`;
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

  // composer로 넘기기 전에 내부 hint(_note) 제거 — 사용자에게 노출되면 안 됨
  // _note는 apiAgent 다음 행동 결정용이라 composer 단계에선 불필요
  // JSON에서 _note 필드 제거 (앞 콤마/뒤 콤마 둘 다 cover)
  accumulatedContext = accumulatedContext.replace(/"_note"\s*:\s*"[^"]*"\s*,?\s*/g, '');
  accumulatedContext = accumulatedContext.replace(/,\s*}/g, '}'); // 끝의 trailing comma 정리
  // 내부 회차 라벨도 단순화 ([N회차 결과 - cases/X]: → 빈 줄 구분자만)
  accumulatedContext = accumulatedContext.replace(/\[\d+회차 결과 - [^\]]*\]:\s*/g, '');

  // 정책성 질문(취소/환불/교환/변경 + 가능/규정/어떻게 등)이면 매뉴얼도 함께 검색해서 sourceData에 추가
  // 이후 composer가 본인 데이터 + 매뉴얼 결합한 정확한 답변 생성
  const q = state.userQuery;
  if (q.match(/환불|교환|반품|취소|변경/) && q.match(/규정|정책|어떻게|며칠|기간|보통|가능|되나요|되요|되는지|할\s*수\s*있/)) {
    try {
      // 카테고리 hint 추출 — 정책 키워드 + 업종 매핑
      // 병원/식당: "예약 + 변경/취소/확인" → 예약변경/예약취소/예약확인
      // 이커머스: 변경 → 취소, 환불/교환은 그대로
      let categoryHint = null;
      const sc = state.storeCategory;
      if (sc === '병원' || sc === '식당') {
        if (q.match(/예약\s*변경|변경\s*가능|변경\s*할\s*수/)) categoryHint = '예약변경';
        else if (q.match(/예약\s*취소|취소\s*가능|취소\s*할\s*수/)) categoryHint = '예약취소';
        else if (q.match(/예약\s*확인|확인\s*가능|확인\s*할\s*수/)) categoryHint = '예약확인';
      } else if (sc === '이커머스') {
        if (q.match(/환불/)) categoryHint = '환불';
        else if (q.match(/교환/)) categoryHint = '교환';
        else if (q.match(/취소|변경/)) categoryHint = '취소'; // 이커머스는 변경 = 취소 + 재주문
        else if (q.match(/반품/)) categoryHint = '환불'; // 반품은 보통 환불 매뉴얼
      }
      console.log(`   📚 [api+rag] 정책 질문 감지 → 매뉴얼 추가 검색${categoryHint ? ` (카테고리 hint: ${categoryHint})` : ''}`);
      const { context: manualDocs, sources: manualSources } = await retrieveKB(q, state.storeId, categoryHint);
      if (manualSources?.length) {
        console.log(`      └─ 매칭된 매뉴얼:`);
        manualSources.forEach(s => {
          console.log(`         · [score=${s.score}] ${s.title} (카테고리: ${s.category})`);
        });
      } else {
        console.log(`      └─ ⚠️ 매뉴얼 0건 매칭`);
      }
      if (manualDocs) {
        // 매뉴얼 fetch 성공 → sourceData 맨 앞에 prepend
        // (composer source_data truncate가 앞 보존이라 맨 뒤에 두면 잘려서 LLM이 못 봄.
        //  매뉴얼은 정책 답변의 핵심 근거이므로 우선 보존)
        accumulatedContext = `[참고 매뉴얼]: ${manualDocs}\n\n${accumulatedContext}`;
        if (manualSources?.length) dataSources.push(...manualSources);
        apiCallTrace.push({ route: 'pgvector/manuals', method: 'EMBEDDING', ok: true, count: manualSources?.length || 0 });
      } else if (categoryHint) {
        // 매뉴얼 0건 — 매장에 매뉴얼 자체가 등록 안 됨 (안내도 맨 앞에 prepend)
        accumulatedContext = `[참고 매뉴얼 안내]: 이 매장에 [${categoryHint}] 정책 매뉴얼이 등록되어 있지 않습니다. 사장님께 직접 문의가 필요한 사안임을 사용자에게 친절히 안내하세요.\n\n${accumulatedContext}`;
        console.log(`      └─ ⚠️ 매뉴얼 0건 + categoryHint='${categoryHint}' → 매장 문의 안내 추가`);
      }
    } catch (e) {
      console.error('[api] 매뉴얼 추가 검색 실패:', e.message);
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
// 일반 정책 질문 감지 (지시어/명시ID 없는 순수 정책 문의)
function isGeneralPolicyQuery(q) {
  const hasPolicyKeyword = /규정|정책|어떻게|며칠|기간|보통|일반적/.test(q);
  const hasReferenceOrId = /내\s|그거|이거|저거|그\s*(주문|예약|상품)|방금|\d{2,}/.test(q);
  return hasPolicyKeyword && !hasReferenceOrId;
}

const ragNode = async (state) => {
  console.log(`📚 [Node 5: RAG Agent] 지식 검색 중...`);
  const { context: docs, sources } = await retrieveKB(state.userQuery, state.storeId);
  // 일반 정책 질문이면 history 비움 (본인 데이터 섞임 방지)
  const generalPolicy = isGeneralPolicyQuery(state.userQuery);
  const historyForRag = generalPolicy ? '이전 맥락 없음' : (state.historySummary || '이전 맥락 없음');
  if (generalPolicy) console.log(`   └─ 🧼 일반 정책 질문 → history 비움 (본인 데이터 섞임 방지)`);
  const res = await invokePrompt("ragAgent", {
    user_query: state.userQuery,
    retrieved_context: truncate(docs, 1800),
    history: truncate(historyForRag, 1000, { keepEnd: true })
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

  // supervisor에서 이미 비로그인 login_required 결정한 경우 → 그대로 통과 (덮어쓰지 말 것)
  if (state.finalAnswer === "__LOGIN_REQUIRED__") {
    console.log(`   └─ ⏩ 비로그인 로그인 유도 (supervisor 결정 보존)`);
    return {};
  }

  // 모호성 검사 — 어떤 주문/예약을 처리해야 할지 명확하지 않으면 재질문
  // memoryHasTarget이 있으면 같은 case 내 후속 대화로 간주, 지시어 없어도 escalate 허용
  // (예: "헤드셋 교환해줘" + 직전 턴에서 주문 320 안내 → 상담사가 컨텍스트 보고 처리)
  const q = state.userQuery;
  const hasExplicitId = /주문\s*번?호?\s*\d|예약\s*번?호?\s*\d|\b\d{2,}\b/.test(q);
  const { rows: caseLink } = await pool.query(
    'SELECT order_id, reservation_id FROM cases WHERE case_id = $1',
    [state.caseId]
  );
  const caseHasTarget = caseLink[0]?.order_id != null || caseLink[0]?.reservation_id != null;
  const memoryHasTarget = state.historySummary && /주문\s*\d|예약\s*\d|order_id|reservation_id/.test(state.historySummary);

  if (!hasExplicitId && !caseHasTarget && !memoryHasTarget) {
    console.log(`   └─ ❓ 처리 대상 불명확 → 재질문 (escalate 보류)`);
    // 환불/교환/취소 키워드별 안내 분기
    let askMessage = "어떤 주문이나 예약을 도와드릴지 알려주시면 진행해 드릴게요. 주문번호나 구체적인 내용을 함께 말씀해 주세요.";
    if (q.match(/교환/)) {
      askMessage = "어떤 상품을 교환하고 싶으신가요? 주문번호와 교환 사유를 알려주시면 빠르게 도와드릴게요.";
    } else if (q.match(/환불/)) {
      askMessage = "어떤 주문을 환불하고 싶으신가요? 주문번호와 환불 사유를 알려주시면 빠르게 도와드릴게요.";
    } else if (q.match(/취소/) && state.storeCategory === '이커머스') {
      askMessage = "어떤 주문을 취소하고 싶으신가요? 주문번호를 알려주시면 진행해 드릴게요.";
    } else if (q.match(/취소|변경/) && (state.storeCategory === '병원' || state.storeCategory === '식당')) {
      askMessage = "어떤 예약을 변경/취소하고 싶으신가요? 예약 날짜·시간 또는 예약번호를 알려주세요.";
    }
    return {
      finalAnswer: askMessage,
      suggestedQuestions: []
    };
  }

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

// 같은 영업시간 가진 연속 요일을 묶어서 표현 ("월~금 04:00-18:30, 토·일 04:00-09:00")
// LLM이 데이터 받고 임의로 묶다 오류내는 걸 방지 — 미리 정확하게 묶은 텍스트 제공
function groupBusinessHours(bh) {
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const groups = []; // [{ days: ['mon', 'tue', ...], time: '04:00-18:30' }, ...]
  for (const day of order) {
    const time = bh[day];
    if (time == null) continue;
    const last = groups[groups.length - 1];
    if (last && last.time === time) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], time });
    }
  }
  // 그룹별 표현 ("월~금" 또는 "토·일" 또는 단일 요일)
  return groups.map(g => {
    const dayStr = g.days.length === 1
      ? DAY_NAMES[g.days[0]]
      : g.days.length === 2
        ? `${DAY_NAMES[g.days[0]]}·${DAY_NAMES[g.days[g.days.length - 1]]}`
        : `${DAY_NAMES[g.days[0]]}~${DAY_NAMES[g.days[g.days.length - 1]]}`;
    return `${dayStr} ${g.time === 'off' ? '휴무' : g.time}`;
  }).join(', ');
}

// 질문 키워드에서 어떤 카테고리 정보 필요한지 판단
function detectStoreInfoScope(query = '') {
  const scopes = new Set();
  if (/메뉴|뭐\s*파|뭐\s*있|뭐\s*먹|뭐\s*있어|음식|먹을|판매|추천\s*메뉴/.test(query)) scopes.add('menu');
  if (/영업|운영|몇\s*시|언제|쉬는\s*날|휴무|영업시간|운영시간/.test(query)) scopes.add('hours');
  if (/주소|위치|어디|찾기|찾아|찾을/.test(query)) scopes.add('address');
  if (/주차|편의|와이파이|wifi|화장실/.test(query)) scopes.add('facilities');
  if (/진료(과목|과)?|과목|어떤\s*진료|진료\s*받/.test(query)) scopes.add('department');
  if (/전화|연락처|번호/.test(query)) scopes.add('phone');
  if (/공지|이벤트|혜택/.test(query)) scopes.add('notice');
  if (/가격|얼마|비싸|싸|값/.test(query)) scopes.add('price'); // 메뉴 가격
  return scopes;
}

function formatStoreInfo(data, query = '') {
  const scopes = detectStoreInfoScope(query);
  const fullDump = scopes.size === 0; // 키워드 매치 없으면 전체 (fallback)
  const lines = [];

  // 가게명/업종은 항상 포함 (간략)
  lines.push(`가게명: ${data.name} (${data.category})`);

  if (fullDump || scopes.has('address')) lines.push(`주소: ${data.address}`);
  if (fullDump || scopes.has('phone')) lines.push(`전화: ${data.phone}`);

  if ((fullDump || scopes.has('hours')) && data.business_hours) {
    const bh = typeof data.business_hours === 'string' ? JSON.parse(data.business_hours) : data.business_hours;
    lines.push(`영업시간: ${groupBusinessHours(bh)}`);
  }

  if ((fullDump || scopes.has('facilities')) && data.facilities) {
    const fac = typeof data.facilities === 'string' ? JSON.parse(data.facilities) : data.facilities;
    const items = Object.entries(fac).map(([k, v]) => `${k}: ${v ? 'O' : 'X'}`).join(', ');
    lines.push(`편의시설: ${items}`);
  }

  if ((fullDump || scopes.has('notice')) && data.notice) lines.push(`공지: ${data.notice}`);

  if (data.store_items) {
    const si = typeof data.store_items === 'string' ? JSON.parse(data.store_items) : data.store_items;
    if ((fullDump || scopes.has('menu') || scopes.has('price')) && si.menu) {
      const menu = si.menu.map(m => `${m.name} ${m.price}원${m.description ? ` (${m.description})` : ''}`).join(', ');
      lines.push(`메뉴: ${menu}`);
    }
    if ((fullDump || scopes.has('department')) && si.department) {
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
    let info = formatStoreInfo(storeRes.data, state.userQuery);

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

  // 단순 불만/감정 표현은 LLM 호출 없이 즉시 사과 + 재질문 응답
  if (state.intent === 'complaint') {
    console.log(`   ⚡ [Skip LLM] Complaint 템플릿 응답`);
    return {
      finalAnswer: '불편을 드려 죄송합니다. 어떤 부분이 어려우신지 구체적으로 말씀해 주시면 도와드릴게요.',
      suggestedQuestions: [],
    };
  }

  console.log(`✍️ [Node 8/9: Composer] 답변 구성 중...`);

  // 시간까지 포함된 현재 KST (매뉴얼의 "전일 오후 6시" 같은 cutoff와 비교 필요)
  const today = new Date().toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Seoul'
  });
  // 일반 정책 질문이면 history 비움 (본인 데이터 섞임 방지)
  const generalPolicy = isGeneralPolicyQuery(state.userQuery);
  const historyForComposer = generalPolicy ? '이전 맥락 없음' : (state.historySummary || '이전 맥락 없음');
  if (generalPolicy) console.log(`   └─ 🧼 일반 정책 질문 → composer history 비움`);

  const res = await invokePrompt("composer", {
    user_input: state.userQuery,
    // 컨텍스트 한계(3072 토큰) 고려: prompt(~550) + source(~1000) + history(~330) + 입력(~80) = ~1960 + 출력 400 = 2360 < 3072
    // composer 프롬프트가 step-by-step 추론 강화로 길어진 상태 + 매뉴얼 fetch 시 source 큼
    // 매뉴얼은 apiNode에서 맨 앞에 prepend됨 → 앞 보존 truncate로 매뉴얼 우선 살림
    source_data: truncate(state.sourceData, 1500),
    history: truncate(historyForComposer, 400, { keepEnd: true }),
    today
  });

  // 혹시 LLM이 [답변] 라벨을 붙여 출력해도 깨끗이 추출
  const answerMatch = res.match(/\[답변\]\s*([\s\S]+)/);
  let finalAnswer = (answerMatch ? answerMatch[1] : res).trim();

  // showReservationForm이 false인데 LLM이 "채팅창에서 바로 예약" 문구 넣는 경우 강제 제거
  // (룰 8: 신규 예약 안내에서만 허용. 본인 예약 조회/확인 응답에 잘못 들어가는 환각)
  if (!state.showReservationForm) {
    finalAnswer = finalAnswer
      .replace(/\s*채팅창에서\s*바로\s*예약하실\s*수\s*있습니다\.?/g, '')
      .replace(/\s*\n\s*\n/g, '\n\n')  // 빈 줄 정리
      .trim();
  }

  // "개인정보 보호 정책에 따라 ~ 제공할 수 없습니다" 류 환각 문구 강제 제거
  // (가게 정보/매뉴얼 데이터는 공개 정보. LLM이 자체적으로 거부 멘트 붙이는 환각)
  finalAnswer = finalAnswer
    .replace(/[\s.,]*다만,?\s*개인정보\s*보호\s*[^.]*?제공[^.]*?없습니다\.?/g, '')
    .replace(/[\s.,]*개인정보\s*보호\s*정책[^.]*?(없습니다|불가합니다|어렵습니다)\.?/g, '')
    .replace(/\s*\n\s*\n/g, '\n\n')
    .trim();

  // "고객센터로 문의" 류 회피 멘트 → "매장 사장님께 문의"로 강제 치환
  // (이 챗봇 자체가 매장 상담창이라 "고객센터"는 모순. 매뉴얼 미등록 시 사장에게 직접 문의가 맞음)
  finalAnswer = finalAnswer
    .replace(/정확한\s*확인을?\s*위해\s*고객\s*센터로?\s*문의/g, '정확한 확인을 위해 매장 사장님께 문의')
    .replace(/고객\s*센터로?\s*문의해\s*주세요/g, '매장 사장님께 문의해 주세요')
    .replace(/고객\s*센터에?\s*문의/g, '매장 사장님께 문의')
    .trim();

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
  if (state.intent === 'complaint') return 'composer';
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
      complaint:   "불만 응대",
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
// 업종별 허용 카테고리 목록 (Case Writer 출력 검증용)
const ALLOWED_CASE_CATEGORIES = {
  '병원': ['예약', '예약확인', '예약변경', '예약취소', '진료과목'],
  '식당': ['예약', '예약확인', '예약변경', '예약취소', '메뉴', '가격'],
  '이커머스': ['배송조회', '주문확인', '환불', '교환', '취소', '상품정보'],
};
// 업종별 기본 카테고리 (LLM이 null/오류 출력 시 fallback)
const DEFAULT_CASE_CATEGORY = {
  '병원': '예약',
  '식당': '예약',
  '이커머스': '주문확인',
};

function sanitizeCaseCategory(rawCategory, storeCategory) {
  const allowed = ALLOWED_CASE_CATEGORIES[storeCategory] || [];
  const fallback = DEFAULT_CASE_CATEGORY[storeCategory] || null;
  if (allowed.length === 0) return null; // 업종 모르면 null 유지

  // null/빈값 → fallback (업종 기본)
  if (!rawCategory || rawCategory === 'null') return fallback;

  // 정확 일치
  if (allowed.includes(rawCategory)) return rawCategory;

  // "취소|이커머스" 같이 합쳐진 경우 → 파이프로 split해서 허용 목록에 있는 첫 값 추출
  if (rawCategory.includes('|')) {
    const parts = rawCategory.split('|').map(s => s.trim());
    const valid = parts.find(p => allowed.includes(p));
    if (valid) return valid;
  }

  // 부분 일치 시도 (예: "주문 취소" → "취소")
  const match = allowed.find(c => rawCategory.includes(c));
  if (match) return match;

  // 어떤 매칭도 안 되면 fallback
  return fallback;
}

export async function analyzeCaseConversation(conversationText, storeCategory = null) {
  const res = await invokePrompt("caseWriter", {
    conversation_text: truncate(conversationText, 2500, { keepEnd: true }),
    store_category: storeCategory || "없음"
  });
  try {
    const json = JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] || 'null');
    if (json && storeCategory) {
      const before = json.category;
      json.category = sanitizeCaseCategory(json.category, storeCategory);
      if (before !== json.category) {
        console.log(`   🧹 [caseWriter] category 정제: "${before}" → "${json.category}"`);
      }
    }
    return { rawText: res, json };
  } catch (e) { return { rawText: res, json: null }; }
}

// 상담 솔루션 분석 — 숫자는 코드가 계산, AI는 해석+솔루션만
export async function analyzeSolutions(statsText, summaryText) {
  // 컨텍스트 한계 보호: 통계는 짧으니 그대로, 요약 데이터만 truncate
  // prompt(~330) + stats(~150) + summary(~1500) + 출력 400 = ~2380 < 3072 (안전)
  const params = {
    stats: truncate(statsText, 600, { keepEnd: false }),
    summary_data: truncate(summaryText, 2000, { keepEnd: true }),  // 최근 케이스 우선
  };

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
      // 최종 실패 시 프론트가 .headline 접근하다 crash하지 않도록 valid 구조 fallback
      return {
        headline: '분석 결과를 불러오지 못했습니다.',
        issues: [],
        strategies: [],
      };
    }
  }
  // 루프 종료 (이론상 unreachable) — 안전 fallback
  return {
    headline: '분석 결과를 불러오지 못했습니다.',
    issues: [],
    strategies: [],
  };
}

// 체크포인터 초기화
export async function initializeCheckpointer() {
  try {
    await checkpointer.setup();
    console.log("✅ [Checkpointer] 준비 완료");
  } catch (err) { console.error("❌ 초기화 실패:", err); }
}
