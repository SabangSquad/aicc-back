# 변경 이력

## 2026-05-10

### 답변 근거(sources) + 의사결정 경로(decisionTrace) 노출 + 상담 종료 시 카테고리 자동 분류 + score 버그 수정

1. **RAG 근거 노출 (manual_id/title/category/distance)**

   - `searchService.findSimilarContext` 반환 구조 변경: `{context, sources}`
     - `sources`는 `[{ type:'manual', manualId, title, category, distance, score, excerpt }]`
   - SQL에 `manual_id, title, category, embedding <=> $1 AS distance` 컬럼 추가
   - score = `1 - distance` (0~1, 1에 가까울수록 유사)
2. **API/DB 답변 근거 노출 (dataSources)**

   - `apiNode`에서 case prefetch / orders prefetch / reservations prefetch / LLM 호출 루프마다 `pushSource(type, id)` 누적
   - 라우트 → 단수 type 매핑 헬퍼(`routeToType`): cases→case, orders→order, shipments→shipment 등
   - shipments / tracks 응답에서도 `shipment_id` 추가 추적
3. **의사결정 경로(decisionTrace) 노출**

   - `processAICC` 스트림 루프에서 노드별로 `{step, result, ...}` 누적
     - supervisor: intent/reservationType/dateRange
     - rag: top score, sources count
     - api: api_calls 수, routes 목록
     - store: showReservationForm 유무 / login_required
     - composer: answer_generated
4. **응답 구조 확장 — `explanation` + `decisionTrace`**

   - `explanation.answerType`: `manual_rag` | `customer_data` | `store_info` | `greeting` | `escalate`
   - 각 type별 reason + sources/dataSources 동봉
   - 미지원/로그인필요 응답에도 `decisionTrace` 포함
5. **상담 종료 시 카테고리 자동 분류**

   - Case Writer 프롬프트에 `{{store_category}}` 입력 변수 + 출력 JSON에 `category` 필드 추가
   - 업종별 단일 토픽 카테고리 목록 정의
     - 병원: `예약` | `예약확인` | `예약변경` | `예약취소` | `진료과목`
     - 식당: `예약` | `예약확인` | `예약변경` | `예약취소` | `메뉴` | `가격`
     - 이커머스: `배송조회` | `주문확인` | `환불` | `교환` | `취소` | `상품정보`
   - 여러 주제 섞인 경우 "마지막에 집중된 주제" 우선 선택 규칙 적용
   - `analyzeCaseConversation(text, storeCategory)` 시그니처 확장
   - 종료 경로 4곳에서 storeCategory 조회 후 전달 + `category = COALESCE($cat, category)` UPDATE
     (chat.js auto-close / manual close / summary 핸들러, app.js 크론잡, cases.js PATCH status, bedrock.js escalateNode)
6. **GET /stores/:store_id/reservations 공개 + customer_id 선택적 노출**

   - 미들웨어 제거 → 비로그인도 시간/상태/인원 조회 가능 (예약 폼 빈 시간 표시용)
   - `customer_id`는 해당 가게 OWNER / ADMIN / 내부 호출(x-internal-secret)에만 포함
7. **fix: /stores/:store_id/solutions score가 항상 30점으로 고정되던 버그**

   - cases SELECT에 `status` 컬럼 누락 → `c.status === 'AI자동해결'` 필터가 항상 0
   - 결과적으로 `aiResolveRate = 0` 되어 score = `0×40 + 30 + 0` = 30 고정
   - SELECT에 status 추가하여 정상 계산되도록 수정
8. **fix: SSE 응답에 `explanation`/`decisionTrace` 누락 수정**

   - `processAICC`는 두 필드를 반환하지만 `chat.js` SSE 응답 조립 단계에서 화이트리스트로 빠져있어 프론트로 전달 안 되던 문제
   - `answer` / `login_required` 두 type 모두 옵셔널 spread로 추가
9. **Redis 'Socket closed unexpectedly' 노이즈 로그 정리**

   - k8s 환경에서 idle TCP 끊김으로 발생하는 자동 재연결 노이즈 다수
   - `socket.keepAlive: 5000` + 점진적 `reconnectStrategy` 추가로 끊김 자체 감소
   - `Socket closed` / `ECONNRESET` / `Connection timeout` 메시지는 `console.warn`으로 강등하여 실제 문제와 분리
10. **체크포인트 carry-over 방지 — sources/apiCallTrace 초기 리셋 추가**

    - thread_id=caseId로 같은 케이스 재요청 시 이전 턴의 `sources`가 다음 턴 응답에 묻어나오는 문제 차단
    - `app.stream()` 초기 state에 `sources: null, apiCallTrace: null` 명시
    - `graphState` 채널에서 의미 없는 `decisionTrace` 제거 (외부 변수로만 누적)
11. **fix: Supervisor regex shortcut의 한글 단어경계(`\b`) 미작동 문제**

    - JS의 `\b`는 ASCII word boundary(`[A-Za-z0-9_]`)만 인식 → 한글-공백 사이는 단어경계로 인식 안 함
    - 결과: "내 주문 상태 알려줘" 같은 명확한 api 패턴이 shortcut에서 누락 → LLM 호출되어 rag/store로 오분류
    - 한글 조사(`을|를|이|가`) + 공백/문장끝 명시적으로 처리하도록 변경
    - "내 예약" 패턴(병원/식당)도 shortcut에 추가
12. **"내" 없는 본인 데이터 조회도 api로 일관 분류**

    - "주문 정보/상태/확인/조회/내역 알려줘", "배송 상태 알려줘", "예약 확인/조회" 등 자연스러운 표현이 shortcut/LLM 모두에서 store/rag로 빠지던 문제
    - bedrock.js shortcut에 패턴 추가:
      - `^(주문|배송)\s*(정보|상태|확인|조회|내역)` → api (이커머스/null)
      - `^예약\s*(확인|조회|내역)` → api (병원/식당/null)
    - templates.js Supervisor 프롬프트의 api 카테고리 설명에 "내 생략" 케이스 명시 + 예시 추가
    - 헷갈리기 쉬운 "주문 어떻게 해?"(rag) vs "주문 정보 알려줘"(api) 구분 룰 추가
13. **fix: 정중표현 "해주/해줘"가 shortcut을 차단하던 문제 + 배송 다양한 표현 커버**

    - hasComplexity 정규식에 `해주|해줘` 포함되어 있어 "배송 상태 확인해주세요" 같은 단순 조회 의도까지 shortcut에서 차단되어 LLM에 떠맡김
    - 진짜 행동요청은 `취소|환불|교환|변경` 등 명시 키워드로 충분 → `해주|해줘` 제거
    - 효과: "배송 상태 확인해주세요", "내 주문 배송 조회해줘" 등이 shortcut으로 즉시 api 분류
    - Supervisor 프롬프트 api 예시 보강: "배송 어디까지 왔어", "오늘 도착 예정?", "지금 어디쯤?", "배송 왜 이렇게 느려요" 등 정규식으로 잡기 어려운 자연 표현 다수 추가
    - "배송 어디까지(api)" vs "배송 보통 며칠(rag)" 구분 룰 명시
14. **병원/식당 예약변경/취소 escalate 허용**

    - 기존: 병원/식당에서 모든 escalate 차단 → "예약 취소해주세요", "예약 시간 변경해줘" 같은 정당한 처리 요청까지 unsupported로 막힘
    - 수정: bedrock.js에서 환불/교환/반품 키워드만 차단하고, 예약 관련 escalate는 통과
    - Supervisor 프롬프트 escalate 정의 확장:
      - 이커머스: 환불/교환/주문취소
      - 병원/식당: 예약변경/예약취소
    - 업종별 escalate 허용 범위 명시
15. **store 정의 보강 — 진료과목/가격/상품정보/주차 명시**

    - 기존 프롬프트가 "영업시간/주소/메뉴/공지/편의시설"만 나열 → 진료과목/가격/상품정보/주차 등 자주 묻는 가게 정보가 store로 잘 안 갈 위험
    - "영업시간/주소/메뉴/가격/진료과목/상품정보/공지/편의시설/주차"로 확장
16. **fix: ragAgent / composer 환각 방지 강화**

    - 증상: "배송 보통 며칠 걸려요?" 같은 일반 정책 질문에 LLM이
      - 매뉴얼에 없는 "3~7일" 만들어냄
      - 메모리에서 본인 주문번호/날짜를 끌어와 "5월 중순 도착 예정" 같은 환각
    - 원인: 기존 프롬프트가 "[규정]+[맥락] 결합해 구체적으로 답변"을 권장 → 빈 곳을 LLM이 일반 상식으로 채움
    - ragAgent 프롬프트:
      - [규정]에 없는 수치/기간/날짜는 절대 만들지 말 것 명시
      - 일반 정책 질문 ↔ 후속 지시어 질문 구분 → 일반 질문엔 본인 데이터 섞지 말 것
      - [규정]에 답 없으면 즉시 "고객센터로 문의" 푸시백 (LLM이 채우지 못하게)
    - composer 프롬프트:
      - [수집 정보]에 없는 디테일 만들지 말 것
      - 지시어 없으면 [맥락]의 본인 데이터 인용 금지
      - 정보에 있는 필드만 노출, 없는 필드 추정 금지
17. **fix: composer/guardrail 키워드 미흡으로 정상 질문이 거절되던 문제**

    - 증상: "오늘 도착 예정인가요?" → "고객 상담만 도와드릴 수 있어요"로 거절
    - 원인: composer 룰 1번 "가게 운영 무관 거절" 키워드 리스트에 "도착/수령/택배" 누락 → LLM이 "도착"을 외부 지식 질문으로 오인
    - 수정 1: composer 룰 1번에 가게 운영 카테고리 명시적 나열 (주문/배송/도착/수령/택배 등 다수 추가)
    - 수정 2: bedrock.js guardrail regex shortcut에 "도착/수령/반품/문의/상담/가격" 등 추가
    - 수정 3: guardrail 프롬프트 PASS 카테고리에도 동일 키워드 명시
    - "짧은 후속 질문 (오늘?, 지금?, 왜?)"도 가게 무관 아님 명시
18. **fix: "배송 보통 며칠?" 같은 정책 질문이 store로 분류되던 문제 (코드 강제)**

    - 증상: "배송은 보통 얼마나 걸리나요?" → store로 분류 → 가게 정보(공지 등) 섞이고 LLM이 "3~5일" 환각
    - 원인: Supervisor LLM이 프롬프트의 rag 예시를 따르지 않고 store로 분류
    - 수정: bedrock.js supervisor 후처리에 코드 강제 룰 추가 (예약 키워드 처리와 동일 패턴):
      - `q.match(/배송/) + (보통|얼마나|며칠|기간|일반적|평균|소요|걸리)` && 본인 조회 패턴 아님 → rag 강제
      - `q.match(/환불|교환|반품/) + (규정|정책|어떻게|며칠|기간|보통|가능한가|되나요)` && 행동요청 아님 → rag 강제
    - 효과: LLM 분류 실수해도 코드가 보정해서 ragAgent로 정확히 라우팅
19. **fix: "오늘 도착 예정?" 같은 본인 배송 조회가 rag로 가서 "고객센터 문의" 받던 문제**

    - 증상: 본인 배송 관련 질문인데 데이터 조회 시도 안 하고 일반 안내만 출력
    - 원인 1: supervisor가 "오늘 도착 예정?"을 rag로 분류 → 매뉴얼에 도착 정보 없음 → 푸시백
    - 원인 2: apiNode orders prefetch 트리거 키워드에 "도착/수령/예정" 누락 → api 가도 데이터 못 찾음
    - 원인 3: composer가 데이터 부족 시 무조건 "고객센터 문의"만 응답 → 어떤 항목인지 재질문 못 함
    - 수정 1: bedrock.js supervisor 후처리에 본인 배송 조회 패턴 → api 강제 룰 추가
      - `도착(예정|언제|시간) | 언제(와|올|받|도착|배달) | 어디(쯤|까지) | 지금 어디 | 받을 수 있` && 일반 정책 아님 → api
    - 수정 2: apiNode orders prefetch 트리거에 "도착/수령/예정/어디쯤/언제 와/올/받/도착/배달" 추가
    - 수정 3: composer 룰 3번 정밀화:
      - 본인 데이터 질문인데 항목 모호 → "어떤 주문의 배송을 말씀하시는 건가요?" 재질문
      - 정책 질문인데 매뉴얼 없음 → "고객센터 문의" 푸시백
      - 두 케이스 분리하여 적절한 응답
20. **fix: composer가 사용자 시간 표현을 그대로 신뢰해 잘못된 framing 답변**

    - 증상: 질문 "오늘 주문한 거 확인" → 데이터엔 4/29 주문만 있는데도 "오늘 주문한 주문 503" 식으로 답변
    - 원인: composer 프롬프트에 `today` 변수 없어서 데이터 날짜 vs 오늘 비교 불가, 사용자 framing 그대로 따라감
    - 수정 1: composer 호출 시 `today` (KST 한국어) 전달
    - 수정 2: composer 프롬프트에 시간 검증 룰 추가
      - 질문의 "오늘/어제/이번 주" 시간 표현과 [수집 정보] 날짜 대조
      - 일치 안 하면 "오늘 ~한 건 없습니다. 가장 최근은 [실제 날짜]" 형태로 정확히 답변
21. **fix: 지시어("그거", "그 주문") 후속 질문이 rag로 가서 "고객센터 문의" 받던 문제**

    - 증상: "(이전: 주문함) → 그거 뭐 샀었지?" → rag로 분류 → 매뉴얼 검색만 하고 푸시백
    - 원인: 지시어만 있는 짧은 follow-up이 LLM 또는 코드에서 적절히 api로 라우팅 안 됨
    - 수정 1: bedrock.js supervisor 후처리에 지시어 + 본인 데이터 조회 → api 강제 룰 추가
      - `그거|이거|저거|그 주문|그 예약|방금` + `뭐|어떻|언제|얼마|어디|상태|품목|상품|샀|시켰|주문했|받았` && 정책질문 아님 → api
      - "그거 환불 가능?" 같은 정책 질문은 rag 유지 (정책 키워드로 구분)
    - 수정 2: apiNode orders prefetch 트리거에 "샀/시켰/그거/이거/저거/그 주문/그 배송" 등 추가
    - 효과: 지시어 후속 질문도 본인 데이터 조회 시도 → 데이터 있으면 정확히 답, 없으면 항목 재질문
22. **fix: /customers/:id/orders·reservations·cases가 store_id 필터 없어 다른 가게 주문 섞임**

    - 증상: 가게 1번 채팅인데 응답에 "주문 22 (다른 가게)", "주문 54 (다른 가게)" 같이 다른 가게 주문이 섞여 나옴
    - 원인: customers/:id/orders 엔드포인트가 store_id 필터를 지원 안 함 → 고객의 모든 가게 주문이 반환
    - 수정 1: customers.js 3개 라우트에 `?store_id=N` 쿼리 파라미터 지원 추가 (orders/reservations/cases)
    - 수정 2: bedrock.js apiNode에서 LLM이 customers/{id}/(orders|reservations|cases) 호출 시 코드가 자동으로 `store_id` 파라미터 주입 (LLM 프롬프트 잊어도 보정)
    - 수정 3: apiAgent 프롬프트에 "본인 목록 조회는 반드시 ?store_id 필터 사용" 경고 추가
23. **fix: composer가 "그거/이거/저거"를 주문 라벨로 사용**

    - 증상: 주문 목록 답변에 "**그거** (주문 320)", "**이거** (주문 362)" 식으로 지시어를 라벨로 쓰는 환각
    - 원인: composer 프롬프트가 라벨 형식을 명시하지 않아 LLM이 메모리/상상에서 가져옴
    - 수정: composer 룰 6에 "항목 라벨은 반드시 주문번호/예약번호로 식별. 지시어를 라벨로 쓰지 말 것" 명시 + 예시
24. **fix: 시간 keyword 질문(오늘/어제/이번주) prefetch SQL에서 날짜 필터 (코드 강제)**

    - 증상: composer 프롬프트에 시간 검증 룰 추가했음에도 LLM이 무시하고 "오늘 주문"이라며 4월 14일 주문 표시
    - 원인: prefetch가 모든 최근 주문 5건 반환 → LLM이 지시 무시하고 잘못된 framing
    - 수정: apiNode prefetch SQL에 KST 기반 시간 필터 추가
      - orders prefetch: `오늘`/`어제`/`이번 주`/`이번 달` 키워드 → ordered_at 범위 필터
      - reservations prefetch: `오늘`/`내일`/`이번 주` 키워드 → reserved_at 범위 필터
      - 모두 `Asia/Seoul` 시간대 기준
    - 효과: 사용자가 "오늘 주문" 질문 시 데이터 자체가 오늘 주문만 반환 (없으면 0건). LLM이 환각으로 다른 날 주문 끌어오지 못함
25. **fix: "교환 가능한가요?" 같은 정책 질문이 escalate로 잘못 분류되던 문제**

    - 증상: 환불/교환 정책 질문에 "상담사 연결" 응답 (escalate 처리)
    - 원인: 기존 환불/교환 정책 → rag 강제 룰에 `intent !== 'escalate'` 조건이 있어, LLM이 escalate로 분류한 경우 보정 못 함
    - 수정 1: 조건에서 escalate 제외 → LLM 분류 결과 무관하게 정책 질문이면 rag로 강제
    - 수정 2: 정책 질문 정규식 확장 (`가능해|가능할까|되는지|되요` 등 추가)
    - 수정 3: 행동 요청 정규식 확장 (`진행|받아|넣어` 등 추가)
    - 효과: "교환 가능한가요?", "환불 가능해요?", "반품 되나요?" 등이 모두 rag로 정확히 분류
26. **fix: 모호한 환불/교환/취소 요청도 곧바로 escalate 되던 문제 (재질문 추가)**

    - 증상: "상품 교환해주세요", "교환 좀 해줘" 등 어떤 주문/상품인지 불명확한 요청이 그대로 상담사 연결로 escalate
    - 원인: escalateNode가 명시적 ID/맥락 검사 없이 무조건 status='대기'로 전환
    - 수정: escalateNode 시작에 모호성 검사 추가
      - 명시적 ID (`주문 503`, `\d{2,}`)
      - 맥락 지시어 (`그거/이거/그 주문`) + memory에 주문/예약 ID 있음
      - case_id가 order_id/reservation_id에 묶여있음
      - 위 셋 다 없으면 → 재질문 응답하고 escalate 보류
    - 재질문 메시지는 키워드(교환/환불/취소/예약변경)별로 분기:
      - "어떤 상품을 교환하고 싶으신가요? 주문번호와 교환 사유를 알려주시면..."
      - "어떤 주문을 환불하고 싶으신가요?..."
      - "어떤 예약을 변경/취소하고 싶으신가요? 예약 날짜·시간 또는 예약번호를..."
27. **fix: "이거" 통과하는데 "헤드셋"은 재질문 받던 모순 + "할 수 있" 정책 질문 인식**

    - 증상 1: "이거 교환할 수 있어?" → escalate, "헤드셋 교환할 수 있어?" → 재질문 (같은 맥락인데 다른 결과)
    - 증상 2: "이거 교환할 수 있어?"는 정책 질문(가능 여부)인데 escalate로 분류
    - 원인 1: escalate 모호성 검사가 (지시어 + memory) 둘 다 요구 → 상품명 직접 언급은 통과 못 함
    - 원인 2: 정책 질문 정규식에 "할 수 있" 패턴 누락
    - 수정 1: 정책 정규식에 `할\s*수\s*있` 추가 → "이거/헤드셋 교환할 수 있어?" 모두 rag (정책 질문)로 처리
    - 수정 2: escalate 모호성 검사 완화 — memory에 주문/예약 ID 있으면 지시어 없어도 escalate 허용
      (같은 case 내 후속 대화로 간주, 상담사가 컨텍스트 보고 처리 가능)
    - 효과: 정책성 질문은 매뉴얼 기반 답변, 행동 요청은 ID 명시되거나 컨텍스트 있으면 escalate
28. **fix: ContextOverflowError — composer 입력이 모델 한계(3072) 초과**

    - 증상: prefetch + chained API 호출로 sourceData가 커지면서 composer 호출 시
      `input 2599 + max_tokens 512 > 3072` 에러로 답변 생성 실패
    - 수정 1: client.js MAX_TOKENS_BY_PROMPT의 composer 512 → 384
    - 수정 2: bedrock.js composer 호출 시 truncate 한도 축소
      - source_data: 3000 → 2000 자 (≈ 1300 토큰)
      - history: 1000 → 600 자
    - 수정 3: apiAgent context truncate 3000 → 2000, ragAgent retrieved_context 2500 → 1800
    - 효과: 모델 컨텍스트 한계 안에 안전 마진 확보 (입력 ~2000 토큰 + 출력 384 토큰 < 3072)
29. **fix: "가능?" 단독 패턴이 정책 정규식에 누락**

    - 증상: "이거 교환가능?", "교환 가능?" 같은 짧은 정책 질문이 escalate로 잘못 분류
    - 원인: 정책 정규식이 `가능한가/가능해/가능할까`만 매치, 단순 `가능` 안 잡힘
    - 수정: 정책 정규식의 `가능한가|가능해|가능할까` → `가능` (단독 매치)으로 단순화
    - 모든 변형("교환가능?", "환불가능?", "가능한가요?") 일관되게 rag로 분류
30. **fix: "취소" 정책 질문이 rag 강제 룰에서 누락**

    - 증상: "그거 취소할 수 있어?", "취소 규정?" 등 취소 정책 질문이 escalate로 분류
    - 원인: rag 강제 룰이 `환불|교환|반품` 키워드만 적용, `취소` 빠짐
    - 수정: 키워드에 `취소` 추가 → 취소 정책 질문도 rag로 정확히 분류
    - 행동 요청("주문 503 취소해줘", "취소 처리 부탁")은 escalate 유지
31. **fix: 본인 ID + 정책 질문이 매뉴얼만 보고 환각 답변 (api+매뉴얼 결합 흐름 도입)**

    - 증상: "주문번호 302번 취소할 수 있어?" → rag만 거쳐 매뉴얼 인용
      → 실제 302 주문이 존재하는지/상태가 뭔지 검증 없이 단정 답변 ("결제 후 24시간 이내 취소 가능")
    - 원인: 본인 데이터 검증 + 매뉴얼 정책 결합이 필요한 질문인데, rag만 거쳐 매뉴얼 일반 정책만 인용
    - 수정 1: supervisor 후처리 — 환불/교환/취소 정책 질문에 명시적 본인 ID(주문번호/예약번호) 있으면 rag 대신 api로 라우팅
    - 수정 2: apiNode 끝에 정책 키워드 감지 시 매뉴얼 추가 검색 (pgvector) → sourceData에 결합
      - dataSources에 manual sources 추가
      - apiCallTrace에 pgvector 호출 기록
    - 효과: composer가 본인 주문 데이터 + 매뉴얼 둘 다 받아서 정확한 결합 답변 생성
      - "주문 302는 현재 [상태]입니다. 매뉴얼에 따르면 [정책]. 따라서 [가능/불가]"
32. **fix: composer 답변이 중간에 짤려서 "데이터가 중단됨" 표시되던 문제**

    - 증상: "주문번호 302 상세 정보 좀" → 첫 품목만 표시 후 "(데이터가 중단됨)"
    - 원인: composer max_tokens 384가 여러 항목/품목 나열에 부족
    - 수정 1: client.js MAX_TOKENS_BY_PROMPT.composer 384 → 640 (input 2000자 + 640 출력 = 모델 한계 안)
    - 수정 2: composer 프롬프트 룰 5 보강
      - [질문]에 특정 ID 명시되면 해당 항목만 상세 답변, 다른 항목 언급 금지
      - 명시 ID 없으면 모든 항목 빠짐없이 안내 (기존 동작)
    - 효과: 단일 주문 상세 조회는 정확히 그 주문만 풀 디테일로, 토큰 낭비 없음
33. **fix: composer가 매뉴얼+본인 데이터 받고도 결론 안 내고 단순 인용만 하던 문제**

    - 증상: "취소 가능해?" + 본인 주문 데이터(2024-11-26 결제) + 매뉴얼(24시간 이내 가능)
      → "주문 302는 준비중입니다. 취소는 24시간 이내 가능합니다." (결론 없음, 사용자가 직접 판단해야 함)
    - 원인: composer 프롬프트가 데이터/매뉴얼 인용은 시키지만 결합 추론·결론 도출은 강제 안 함
    - 수정: composer 프롬프트에 "정책 + 본인 데이터 결합 추론" 섹션 추가
      - 4단계 절차 명시: 정책 추출 → 본인 데이터 확인 → 오늘과 비교 → 명시적 결론
      - 좋은 답변/나쁜 답변 예시 포함 (24시간 초과 → "직접 취소 어렵습니다, 고객센터 문의" 답변)
    - 효과: "취소 가능?" 질문에 매뉴얼 + 주문일 + 오늘을 종합해 가능/불가 결론까지 자동 도출
34. **fix: "상품정보 알려주세요" 가게 정보 질문이 api로 잘못 라우팅 + 또 ContextOverflow**

    - 증상 1: "상품정보 알려주세요" → supervisor가 api로 분류 → apiNode가 본인 주문/items 다 prefetch
    - 증상 2: 결과적으로 sourceData가 커지면서 composer 호출 시 또 input 2661 + 640 > 3072 overflow
    - 원인 1: supervisor 프롬프트 api 예시("주문 정보 알려줘")를 LLM이 일반화하여 "상품 정보 알려주세요"도 api로 분류
    - 원인 2: composer max_tokens 640 + 입력 2000자가 여전히 limit 못 맞춤 (composer 프롬프트가 길어진 영향도 있음)
    - 수정 1: supervisor 후처리에 가게 정보 카탈로그 질문 → store 강제 룰 추가
      - `^(상품정보|상품 설명|메뉴|진료과목|가격|영업시간|운영시간|주차|위치|주소|공지)` → store
      - 단, "내 ~", "그거", 주문번호 명시는 제외 (본인 데이터 의도)
    - 수정 2: composer 입력/출력 추가 축소
      - source_data 2000 → 1500 자
      - history 600 → 500 자
      - composer max_tokens 640 → 512
    - 효과: "상품정보" 류 질문은 store로 가벼운 가게 정보만 fetch + 출력 안전
35. **fix: "내 문의 내역" 조회 시 현재 case만 보여주고 내부 hint(_note)까지 노출되던 문제**

    - 증상: "내 문의 내역 확인해줘" → 현재 진행 중 case(1110) 한 건만 raw로 표시 + 내부 메모 "summary 무시..."까지 답변에 노출
    - 원인 1: supervisor shortcut에 "내 문의/상담 내역" 패턴 없어 LLM에 떠맡김
    - 원인 2: apiNode prefetch가 종료된 과거 상담 fetch 안 함
    - 원인 3: cases prefetch가 LLM 힌트용 `_note`를 sourceData에 같이 넣어 composer가 사용자에게 노출
    - 수정 1: supervisor shortcut에 "내 문의/상담", "문의 내역", "상담 내역" 패턴 추가 → api 즉시
    - 수정 2: apiNode에 closed cases (종료/AI자동해결) SQL prefetch 추가
      - customer_id + store_id + 현재 case 제외 + LIMIT 5
      - 카테고리/감정/요약/접수일·종료일 노출
    - 수정 3: apiNode return 직전에 sourceData에서 `_note` 필드 정규식으로 제거
    - 수정 4: composer 프롬프트 룰 6 보강
      - 상담(case) 라벨은 case_id로 식별 명시
      - "_note", "_hint" 같이 _로 시작하는 내부 메모는 사용자 노출 금지 명시
    - 효과: 과거 종료된 상담 5건이 상담번호·카테고리·감정·요약으로 정리되어 표시
36. **fix: 상담 많은 사용자(68건)에서 또 ContextOverflow — cases 데이터 압축**

    - 증상: customers/X/cases가 기본 20건 반환 → input 2868 + 512 > 3072 overflow
    - 원인: cases prefetch + LLM의 추가 list API 호출이 모두 JSON 풀 페이로드 (필드 9개 × 20건)
    - 수정 1: cases prefetch 출력을 JSON → 압축 텍스트로 변환
      - 한 줄당 "상담 1107 | 2026-05-10 | AI자동해결 | 카테고리: X | 감정: Y | 요약: ..." 형태
      - 5건 × ~80자 = ~400자 (기존 대비 70% 감소)
    - 수정 2: LLM이 customers/X/(orders|reservations|cases) 호출 시 자동 `?limit=5` 주입
      (기존엔 기본 20건 반환되던 것을 5건으로 제한)
    - 수정 3: customers/X/cases LLM 호출 응답도 동일하게 압축 텍스트로 변환 (5건 × 80자)
    - 효과: cases 많은 사용자도 sourceData 안정적으로 1000자 이하 유지
37. **feat: 상담 내역 페이지네이션 — "다음 페이지"/"N페이지"/"N번째부터"/"더 보여줘" 지원**

    - 문제: 압축만 하면 5건만 보여주고 끝, 나머지 63건은 볼 방법 없음
    - 수정 1: cases prefetch 출력에 페이지 안내 추가
      - "(총 68건 중 1~5번째 표시. 더 보시려면 '다음 페이지' 또는 'N페이지'라고 말씀해 주세요.)"
      - 마지막 페이지면 "마지막 페이지입니다." 표시
    - 수정 2: apiNode에 페이지 키워드 감지 + OFFSET SQL fetch 로직 추가
      - "N페이지" → offset = (N-1) * 5
      - "N번째부터" → offset = N-1
      - "다음 페이지"/"더 보여줘"/"이후"/"남은" → memory에서 직전 범위 파싱하여 offset 계산
    - 수정 3: supervisor 후처리에 페이지 키워드 + memory에 list 흔적 있으면 api 강제 라우팅
      - 짧은 페이지 query("다음 페이지", "더 보여줘")가 다른 노드로 안 새도록 보정
    - 효과: 상담 내역 68건이어도 사용자가 자연어로 페이지 이동 가능
38. **fix: composer 프롬프트가 너무 길어 ContextOverflow 재발 (input 2591+512>3072)**

    - 증상: cases 압축까지 했는데도 composer 입력이 2591 토큰 → +512 출력 = 3103, 한계 초과
    - 원인: 환각방지/시간검증/결합추론/규칙10번 등 누적되어 composer 프롬프트가 ~800 토큰 차지
    - 수정 1: composer 프롬프트 다이어트 (~60% 압축, 800 → ~400 토큰)
      - "절대 금지/시간 검증/결합 추론" 별도 섹션 → "핵심 원칙 A/B/C/D" 4줄로 통합
      - 예시 문구 단순화 (긴 좋은/나쁜 답변 비교 → 1줄 예시)
      - 카테고리/규칙 항목 한 줄씩 압축
    - 수정 2: composer source_data truncate 1500 → 1200자 (~800 토큰)
    - 효과: 입력 ~1600 + 출력 512 = 2112 < 3072, 안전 마진 충분히 확보
39. **fix: composer가 sourceData 내부 라벨/메모 그대로 복사 출력**

    - 증상: 답변에 "[1회차 결과 - cases/1110]:", "메모: 'summary 무시...'" 같은 내부 스캐폴딩이 그대로 노출
    - 원인 1: `_note` 제거 정규식이 마지막 필드 케이스 cover 못함
    - 원인 2: composer가 sourceData를 재작성 안 하고 그대로 복사
    - 원인 3: cases 압축에 status/카테고리/감정까지 다 포함 → 사용자에겐 과한 정보
    - 수정 1: `_note` 제거 정규식 보강 (앞뒤 콤마 모두 처리 + trailing comma 정리)
    - 수정 2: "[N회차 결과 - cases/X]:" 같은 내부 회차 라벨도 정규식으로 제거
    - 수정 3: cases 압축 포맷 간소화 — 상담번호/날짜/요약만 (status/category/emotion 제외)
    - 수정 4: composer 프롬프트에 "출력 형식" 섹션 추가
      - 자연스러운 한국어로 **재작성** ([수집 정보] 그대로 복사 금지)
      - 내부 라벨 노출 금지 명시 ("[N회차 결과]", "_note", "cases/N", "메모:" 등)
40. **fix: case_writer 카테고리 분류 — "취소|이커머스" 같은 합성/null 출력 정제**

    - 증상: 종료 상담 카테고리가 "취소|이커머스", "환불|교환|취소", "주문확인|교환" 등 파이프로 합쳐지거나 업종명("이커머스") 또는 null로 저장
    - 원인 1: caseWriter 프롬프트가 옵션 나열에 `|` 사용 → LLM이 "값 합치는 구분자"로 오해
    - 원인 2: JSON 예시 `"...|null"`도 LLM 혼동 유발
    - 원인 3: 코드 측 검증/정제 없음 → LLM 출력 그대로 DB 저장
    - 수정 1: caseWriter 프롬프트 정비
      - 옵션 나열 `|` → `/`로 변경 (값 구분자 오해 방지)
      - "단일 값만, null 금지, 어느 카테고리에도 안 맞으면 가장 가까운 거 선택" 명시
      - 잘못된 출력 예시 명시 (`"취소|이커머스"`, `"이커머스"`, null 등)
    - 수정 2: bedrock.js에 `sanitizeCaseCategory(raw, storeCategory)` 헬퍼 추가
      - 업종별 허용 목록 정확 매칭
      - 파이프(`|`) 합성 → split 후 허용 목록의 첫 값 추출
      - 부분 매칭 (예: "주문 취소 요청" → "취소")
      - 모든 시도 실패 시 업종 기본값 fallback (이커머스→주문확인, 병원/식당→예약)
    - 수정 3: analyzeCaseConversation에서 storeCategory와 함께 sanitize 후 DB 저장
    - 효과: cases.category가 항상 업종별 허용 목록의 단일 값만 저장

### 대화 품질 개선 + 토큰 오버플로우 방지 + 솔루션 분석 안정화

1. **솔루션 분석 토큰 오버플로우 해결**

   - `stores.js` `summaryText` 생성 시 최근 30건만 사용 + 각 summary 80자로 컷
   - 포맷 압축 (`"카테고리: X | 감정: Y | 요약: Z"` → `"X|Y|Z"`)
   - Qwen3-8B 컨텍스트(3072) 한계로 인한 `ContextOverflowError` 해결
   - 입력 토큰 약 2500 → 1200으로 감소

2. **memoryLoader: 메시지 LIMIT 5 → 10**

   - 장기 대화(6턴 이상)에서 초반 정보 소실 문제 해결
   - 0개: 스킵, 1~3개: raw, 4~10개: LLM 요약 (계층 유지)

3. **memoryLoader 프롬프트 강화 — 구체 데이터 보존 강제**

   - 주문번호/상태/날짜/금액 등 구체적 데이터는 그대로 보존하라고 명시
   - 지시어("그거", "이거")가 가리키는 대상을 명시적으로 적시하라고 지시
   - 출력 분량 1~2문장 → 2~4문장으로 확장
   - 출력 형식 예시 추가

4. **ragAgent에 history 변수 추가 — 정책 + 맥락 결합 답변**

   - 기존: 매뉴얼 + 질문만 보고 답변 → "그거 환불 가능?"에 일반 규정만 푸시백
   - 변경: `[이전 맥락]`으로 history 전달 → 주문 상태 + 환불 규정 결합한 구체 답변 가능
   - bedrock.js ragNode에서 `historySummary` 전달

5. **composer 프롬프트 — 메모리 + 수집정보 결합 강제**

   - "수집정보로만 답변" → "수집정보+맥락 결합" 으로 변경
   - 지시어 처리 규칙 명시: "그거"가 있으면 [맥락]에서 참조 대상 찾기
   - 푸시백 조건 강화: "수집정보+맥락으로도 답 못 만들 때만" 고객센터 안내

6. **supervisor 프롬프트 — 짧은 후속 질문 맥락 활용 규칙 추가**

   - "짧은 후속 질문은 [맥락]을 보고 분류" 명시
   - 직전 대화가 주문 조회였고 현재가 "환불 가능?"이면 rag로 분류 같은 가이드

7. **guardrail 프롬프트 — 짧은 후속/지시어 질문 PASS 명시**

   - "그거", "이거" 같은 후속 짧은 질문이 가게 무관 키워드 없으면 PASS
   - 정상 후속 대화가 차단되는 문제 방지

8. **truncation 유틸 도입 — 모든 LLM 호출 입력 자동 자르기**

   - bedrock.js에 `truncate(text, maxChars, { keepEnd })` 헬퍼 추가
   - 적용 대상 (단위: 문자):
     - memoryLoader past_logs: 2500 (뒤 보존)
     - supervisor context: 1000 (뒤 보존)
     - apiAgent context: 3000 (뒤 보존, 최근 호출 결과 우선)
     - ragAgent retrieved_context: 2500 (앞 보존, 유사도 순)
     - ragAgent history: 1000 (뒤 보존)
     - composer source_data: 3000 (앞 보존)
     - composer history: 1000 (뒤 보존)
     - caseWriter conversation_text: 3500 (뒤 보존, 대화 종반 중요)
   - 잘렸음을 LLM이 인지하도록 `...(앞부분 생략)` / `...(이하 생략)` 라벨 부착
   - 효과: 토큰 오버플로우 방지, 어떤 입력이 와도 안전 마진 확보

9. **프롬프트 전반 압축 + 명확화**

   - guardrail/supervisor/composer/ragAgent/apiAgent 등 토큰 약 30~35% 감소
   - "반드시", "절대" 등 반복 강조 정리, 중복 섹션 통합
   - 출력 규칙은 형식 예시로 통합

---

## 2026-05-03

### 응답 시간 단축 (LLM 호출 최소화) + API agent 안정화 + 가드레일/composer 정확도

1. **memoryLoader: 짧은 히스토리에서 LLM 호출 스킵**

   - 이전 메시지가 0개 → `historySummary: "이전 맥락 없음"`로 LLM 호출 자체 스킵
   - 메시지 1~3개 → raw 텍스트 그대로 전달 (요약 LLM 호출 불필요)
   - 4~5개일 때만 요약 LLM 호출
   - 효과: 첫 턴/초반 턴 응답 시간 ~500ms~1s 단축
2. **API agent에 `done` 플래그 도입 — finish용 LLM 호출 1회 절약**

   - LLM 출력 JSON에 `"done": true|false` 필드 추가
   - `done:true`면 axios 호출 후 즉시 break (다음 finish용 LLM 호출 생략)
   - 단순 조회는 LLM 1회 + 종료, 배송 이력 chain은 2회 + 종료
3. **Supervisor / composer 프롬프트 압축 + 첫 턴 supervisor 병렬 실행**

   - 프롬프트 길이 ~30~40% 단축 (입력 토큰 감소 → 생성 속도 ↑)
   - 첫 턴(message 0개)에서는 `parallelPreNode`가 guardrail + supervisor 동시 실행 (memory 생략)
   - supervisorNode 진입 시 `state.intent` 이미 있으면 short-circuit (재실행 방지)
   - 효과: 첫 턴 LLM 1회분(~3s) 절약
4. **Guardrail / Supervisor regex shortcut으로 LLM 호출 생략 (자주 쓰는 패턴)**

   - 가드레일: 가게 운영 키워드(주문/배송/환불/교환/예약/상품/메뉴/영업/위치/주차 등) 또는 "내 X" 패턴 또는 인사 → LLM 안 거치고 즉시 PASS
   - 위험 패턴(주민번호/카드번호/계좌번호/비밀번호/시스템 프롬프트 유출/jailbreak)은 무조건 LLM 검증
   - Supervisor: 인사/내정보/내주문 같은 명확한 패턴은 즉시 분류 (LLM 호출 0회)
   - 효과: 자주 쓰는 쿼리에서 LLM 2~3회 절약 (~6~9s)
5. **Greeting intent → composer LLM 호출 생략, 템플릿 응답**

   - intent='greeting'이면 composer에서 LLM 호출 없이 즉시 `"안녕하세요! 무엇을 도와드릴까요?"` 반환
   - 인사에서 LLM 1회분 추가 절약
6. **API agent: `cases/{case_id}` deterministic pre-fetch (axios → 직접 SQL)**

   - 모든 사용자 데이터 조회의 첫 호출은 항상 cases임 → LLM 결정 + HTTP 라운드트립 둘 다 제거
   - `pool.query` 직접 → ~30~100ms 절약
   - LLM에게 cases 응답을 1회차 결과로 전달, "본인정보→customer_id, 주문/배송/품목→order_id, 예약→reservation_id" 힌트 함께
7. **API agent: `customers/{id}/orders` · `customers/{id}/reservations` deterministic pre-fetch**

   - cases.order_id가 null이고 사용자 질문에 "주문/배송/품목/상품/송장" 키워드 있으면 → 현재 가게의 본인 주문 SQL 자동 호출
   - cases.reservation_id가 null이고 "예약" 키워드 있으면 → 현재 가게의 본인 예약 SQL 자동 호출
   - 주문 prefetch는 `orders × items × products` LEFT JOIN 한 번에 → 상품명·수량·금액까지 한 쿼리로
   - 효과: "내 주문 확인" 같은 질문에 LLM 추가 호출 없이 풍부한 데이터 제공
8. **API agent: 무한 루프 방지**

   - LLM이 이미 호출한 경로를 또 호출하려 하면 코드가 강제 break (재요청 차단)
   - cases.order_id null인 케이스에서 LLM이 cases만 반복 호출하던 문제 해결
9. **API agent 프롬프트에 누락된 본인 목록 API 추가**

   - `GET customers/{customer_id}/orders | /reservations | /cases` 추가
   - "ID 찾기 전략" 가이드 추가: cases에 order_id 없으면 customers/{id}/orders → data[0].order_id 추출
   - `maxIterations` 3 → 4 (longest chain: customers/orders → orders/shipments → shipments/tracks)
10. **챗봇 응답에서 `suggestions`(추천질문) 제거**

    - composer가 [추천질문] 섹션 생성 안 함 (프롬프트에서 제거)
    - chat.js 응답 본문에서 `suggestions` 필드 제거
    - composerNode 파싱 단순화 (정규식 1개), `suggestedQuestions: []`로 항상 통일
11. **Composer 프롬프트 — 여러 항목 빠짐없이 안내 룰 추가**

    - "데이터에 여러 항목이 있으면 모든 항목을 빠짐없이 줄/항목별로 안내. 임의로 생략·요약 금지" 추가
    - "주문/예약 안내 시 사용 가능한 필드는 모두 노출 (order_id, 날짜, 상태, 상품명·수량·금액 등)" 추가
    - 단일 항목은 3~5문장, 여러 항목은 줄바꿈 + 도입/마무리 한 문장씩
12. **Guardrail 프롬프트 — REJECT 조건 명확화 (PASS 편향 완화)**

    - "기본은 PASS" 톤이 과해서 일반 지식 질문("손흥민이 누구야")까지 통과시키던 문제 해결
    - REJECT 4가지를 구체 예시와 함께 나열 (인물 정보/날씨·뉴스/코드/번역/노래·영화·소설·게임/일반 상식)
    - "가게 운영과 연결점이 보이지 않으면 → REJECT" 룰 추가
    - PASS 카테고리도 명시적으로 ("내 주문 번호", "주문 상태", "환불 규정" 등)
13. **OAuth 콜백 시 세션 재생성 대응 (passport 0.6+)**

    - `req.logIn` 호출 전에 `req.session.returnTo`를 변수로 미리 추출 (재생성 후엔 사라짐)
    - production에서 Redis 비동기 저장 경합 방지 위해 `req.session.save()` 콜백 안에서 redirect

---

## 2026-04-25

### Supervisor KST 명시 + 배송 체인/메타데이터 + 주문 품목 상품명 노출 + 컬렉션 응답 정규화 + OAuth returnTo 리다이렉트

1. **Supervisor 프롬프트 KST 타임존 명시**

   - "현재 LLM이 예약시간을 KST 기준으로 처리하지 않음" 이슈 대응
   - `[오늘 날짜]` 라벨에 `(한국 표준시 KST, UTC+9)` 명시
   - 상대 표현(오늘/내일/모레/이번 주/다음 주) 모두 KST 기준 해석하도록 규칙 추가
   - `date_start`, `date_end`는 UTC 변환 없이 KST 기준 YYYY-MM-DD로 출력 강제
2. **API Agent 프롬프트 배송 체인 가이드 보강**

   - "주문 → 배송으로 넘어갈 때 shipment_id를 알 방법이 없음" 이슈 대응
   - `cases → orders/{order_id}/shipments → shipments/{shipment_id}/tracks` 3단계 체인 명시
   - `orders/{order_id}/shipments` 응답 구조(`{data:[{shipment_id, ...}]}`) 프롬프트에 노출
   - 이전 호출 결과(context)에서 `shipment_id` 추출하라는 가이드 추가
   - 단순 배송 상태 조회는 2단계까지로 충분하다는 분기 안내
3. **API Agent 경로(r)/ID(i) 작성 규칙 명시**

   - LLM이 `{shipment_id}` 같은 플레이스홀더를 그대로 출력하던 문제 방지
   - 올바른 예/잘못된 예를 프롬프트에 직접 나열 (실제 ID로 치환된 전체 경로 사용)
4. **API Agent 반복 호출 한도 상향 (2 → 4)**

   - `bedrock.js`의 `maxIterations`가 2였던 탓에 3단계 배송 체인 마지막 단계에 도달 못 하던 문제
   - 4회로 늘려서 체인 완결 + 한 번의 재시도 여유 확보
5. **챗봇 응답에 `shipmentInfo` 메타데이터 추가**

   - 기존에는 LLM이 추출한 `shipment_id`/송장번호/배송이력이 답변 텍스트에만 녹아 있어서 프론트가 구조화된 값으로 활용 불가
   - `apiNode`에서 `orders/{id}/shipments`, `shipments/{id}/tracks` 응답을 별도 추적
   - 응답 본문에 `shipmentInfo: { shipment_id, tracking_no, carrier, promised_at, delivered_at, tracks: [...] }` 형태로 포함
   - 기존 `availableSlots`/`showReservationForm` 패턴과 동일한 방식 (LangGraph state + chat.js 라우터 통과)
6. **`GET /orders/{order_id}/items` 응답에 상품명 포함**

   - `items` 테이블만 조회해서 `product_id`만 넘어가던 응답에 `product_name` 추가
   - `products` 테이블 LEFT JOIN으로 상품명 조회 (상품이 삭제된 경우 `null`)
   - Swagger 응답 스키마도 명시적으로 업데이트
7. **컬렉션 GET 엔드포인트의 빈 결과 응답 정상화 (404 → 200 + 빈 배열)**

   - `GET /cases/{case_id}/messages`: 메시지가 없을 때 404 대신 `{data: []}`로 200 응답
   - `GET /orders/{order_id}/items`: 품목이 없을 때 404 대신 `{data: []}`로 200 응답
   - 빈 컬렉션은 RESTful 관점에서 정상 응답이며, 프론트가 try/catch 없이 일관된 처리 가능
   - Swagger 주석에서 404 응답 항목 제거 + description에 빈 배열 응답 명시
   - 단건 GET(`/orders/:id` 등)과 PATCH/DELETE의 404는 그대로 유지 (대상 부재는 진짜 에러)
8. **OAuth 로그인 후 returnTo 기반 리다이렉트**

   - 기존: 로그인 후 role에 따라 `/chat` 또는 `/home`으로 무조건 이동
   - 변경: `/auth/google?returnTo=/chat/2`처럼 진입 URL을 받으면 세션에 저장 후 콜백에서 해당 경로로 복귀
   - `isSafePath()`: 같은 사이트 내부 절대경로만 허용 (open redirect 방어 — `//`, `\` 차단)
   - `isAllowedForRole()`: CUSTOMER는 `/chat` 경로만, 그 외 role은 `/chat`이 아닌 경로만 허용 (role-경로 충돌 시 안전한 fallback으로 라우팅)
   - 검증 실패 시 기존 fallback(`/chat` 또는 `/home`) 유지
   - 프론트 작업 필요: 로그인 진입점에서 현재 경로를 `returnTo` 쿼리로 붙여 호출
9. **OAuth 진입 시 세션 저장 완료 대기 (Redis 경합 조건 해결)**

   - 증상: production에서 `?returnTo=/chat/1`로 진입해도 콜백 후 fallback `/chat`으로 감
   - 원인: `req.session.returnTo = ...` 직후 `passport.authenticate`가 즉시 302 응답을 보내서 Redis 저장이 완료되기 전에 Google로 떠남
   - 로컬은 Redis가 같은 머신이라 저장이 빨라서 우연히 동작했지만, production은 Redis가 다른 Pod라 네트워크 지연으로 저장이 응답보다 늦음
   - 해결: returnTo가 있을 때만 `req.session.save()` 콜백 안에서 `passport.authenticate` 호출하도록 변경
10. **OAuth 콜백에서 `req.logIn` 호출 전에 returnTo 추출 (passport 0.6+ 세션 재생성 대응)**

    - 증상: 9번 fix 적용 후에도 여전히 fallback `/chat`으로 감 (DevTools 확인: 쿠키는 정상 전달, 콜백 진입 OK)
    - 원인: passport 0.6+는 `req.logIn` 호출 시 session fixation 방어를 위해 세션 ID를 재생성 → 기존 세션 데이터(returnTo 포함) 소실
    - 해결: `passport.authenticate` 콜백 안에서 `req.logIn` 호출 **이전**에 `req.session.returnTo`를 변수로 추출
    - 콜백 응답에서 세션 ID가 진입 시점과 다른 ID로 발급되는 현상은 정상 (재생성 결과)

---

## 2026-04-11

### 예약 inquiry/action 분리 + 비로그인 예약 차단 + 타임존/톤 개선

1. **예약 intent 세분화 — reservation_type: inquiry / action**

   - Supervisor 프롬프트에 `reservation_type` 필드 추가 (`inquiry` | `action`)
   - 행동 동사(할래/할게/하고 싶어/해줘/잡아줘 등) 포함 시 `action`, 그 외는 `inquiry`
   - 직전 턴이 inquiry였고 현재 메시지가 시간/날짜만 있으면 action으로 승격
   - 애매하면 inquiry로 보수적 분류
   - Supervisor가 누락하거나 잘못 분류해도 코드에서 안전장치 (정규식 fallback)
2. **storeNode 예약 처리 분기**

   - `inquiry` → 텍스트로만 안내, 폼/availableSlots 프론트에 안 보냄
   - `action` + 비로그인 → `login_required` 응답, 로그인 메시지에 가능한 시간 참고로 포함
   - `action` + 로그인 → `showReservationForm: true` + `availableSlots` 전달
3. **inquiry/action Composer 지시사항 구분**

   - inquiry: 구체적 영업시간 인용 + "예약을 원하시면 말씀해 주세요"로 마무리, "채팅창에서 바로 예약" 문구 금지
   - action: 가능한 시간 안내 + "채팅창에서 바로 예약하실 수 있습니다" 유도
4. **login_required 메시지 톤 개선**

   - "~합니다" → "~해요, 로그인해주시면 바로 잡아드릴게요!"
   - 날짜/시간 한국식 포맷 ("2026-07-30 04:00" → "7월 30일 04:00~09:00")
   - 연속된 시간대는 범위로 묶어서 표시
   - 날짜별로 줄 나누고 최대 3일치만 표시
5. **타임존 버그 수정 (availableSlots 날짜 한 일 밀림)**

   - `toISOString().split('T')[0]`이 UTC 기준으로 날짜를 뽑아서 KST 7/30이 7/29로 표시되던 문제
   - `toLocalDateStr` 헬퍼로 로컬 날짜 포맷 사용
6. **LangGraph 체크포인트 상태 carry-over 버그 수정**

   - thread_id = caseId로 같아서, 이전 턴의 `finalAnswer="__LOGIN_REQUIRED__"`가 다음 턴에 남아있어 composer가 스킵되는 문제
   - 증상: "content 컬럼 NOT NULL 위반" DB 에러
   - 수정: `app.stream()` 호출 시 초기 state에 모든 필드를 명시적으로 null로 리셋
7. **store 노드 조건부 엣지 추가**

   - `__LOGIN_REQUIRED__` 감지 시 composer 건너뛰고 END로

---

## 2026-04-10

### 예약 가능 시간 계산, 단일 세션 보장, 상담 품질 score, 분류 정확도 개선

1. **예약 가능 시간 슬롯 계산 (LLM 기반 날짜 추출)**

   - Supervisor 프롬프트에 `{{today}}` 주입 → "내일", "이번 주", "월요일" 등 자연어 날짜를 LLM이 직접 추출
   - storeNode에서 business_hours - 예약된 시간 차집합으로 availableSlots 계산
   - 비로그인도 "예약 언제 가능해?" 조회 가능
2. **로그인 시 상담 단일 세션 보장**

   - 로그인 전환 시 DB에서 해당 customer의 기존 활성 케이스 복원
   - 비로그인으로 진행 중이던 케이스는 자동 종료 (중복 세션 방지)
   - 멀티탭/재로그인 시 케이스 충돌 해결
3. **고객 로그인 시 /chat 리다이렉트 (role 기반 분기)**

   - CUSTOMER → `/chat`
   - OWNER/ADMIN → `/home`
4. **Solution에 상담 품질 score 추가**

   - AI 자동해결률 40% + 부정감정 역수 30% + 만족도 30% 가중합
   - 0~100 점수 + 등급 반환
5. **이커머스 상품 키워드 추출 후 DB 검색**

   - Supervisor가 상품 키워드 추출 → DB 상품 목록과 대조
   - 없는 항목은 프롬프트에서 명시적으로 거절
6. **escalate 시 비로그인 → 로그인 유도**

   - 환불/교환/주문취소 등 개인정보 필요한 escalate는 로그인 먼저 요구
7. **Solution 0건일 때 404 → 200 빈 결과 반환**

   - 상담 케이스 없는 신규 가게에서 프론트 에러 방지
8. **분류 정확도 수정 (fix)**

   - "예약 취소 규정" 등 규정 질문이 api로 잘못 가던 문제 → rag로 분류
   - 긴 메시지에 "예약" 키워드 섞인 경우 업종 오판 문제 → intent 기반 체크로 전환
   - 모호한 질문("그거 어떻게 돼?")은 AI 추측 대신 재질문하도록 Composer 지침 추가

---

## 2026-04-08

### 배포 준비

- health 엔드포인트 추가 (권한 적용 전 체크용)
- Dockerfile / CI-CD 설정 수정

---

## 2026-04-06

### 채팅 분류 전면 개선 + 자동 종료 status 분리 + 예약 showReservationForm

10. **자동 종료 시 status 분기 + AI 분석**

    - 상담사 개입 없음 → `AI자동해결`
    - 상담사 개입 있음 → `종료`
    - 판단 기준: messages에 speaker='상담사' 존재 여부
    - 모든 종료 경로(close, 크론잡, 세션 복원, 가게 전환)에 적용
    - 자동 종료 시에도 AI 분석(감정/요약) 실행
11. **인사 감지 → greeting 분기**

    - "안녕하세요" 등 인사 시 매뉴얼 검색 안 함 → Composer로 직접 전달
12. **예약 showReservationForm 통일**

    - 예약 관련 질문은 전부 store → 가능 시간 안내 + `showReservationForm: true`
    - 프론트가 showReservationForm 보고 예약 폼/버튼 표시 (로그인 안 됐으면 로그인 먼저)
13. **예약 날짜 추출 (extractDateRange)**

    - "내일", "이번 주", "3월 26일", "월요일" 등 자연어에서 날짜 파싱
    - 해당 기간 예약 현황 조회
14. **업종별 미지원 기능 코드 차단**

    - 이커머스: 예약/진료과목/메뉴 → 미지원
    - 병원: 환불/교환/주문취소/배송/메뉴 → 미지원
    - 식당: 환불/교환/주문취소/배송/진료과목 → 미지원
15. **store 전환 보정 강화**

    - rag로 분류됐지만 규정 질문이 아니면 store로 전환
    - 인사/행동 요청은 예외
16. **로그인 메시지 상황별 분리**

    - "예약을 진행하시려면 로그인이 필요합니다."
    - "주문/배송 정보를 조회하려면 로그인이 필요합니다."
    - "예약 정보를 확인하려면 로그인이 필요합니다."
17. **storeNode 데이터 보강**

    - 상품 목록 조회 (이커머스)
    - 예약 현황 조회 (병원/식당)
    - JSON → 읽기 쉬운 텍스트 변환 (formatStoreInfo)
18. **Composer 프롬프트 개선**

    - 불필요한 "문의해주세요" 제거
    - 상담 무관 요청 거절 1번 지침으로
    - 예약 안내 시 "채팅창에서 바로 예약" 유도
19. **Supervisor 프롬프트 개선**

    - store_category 변수 추가
    - store 분류 키워드 대폭 강화
    - 업종별 제약 규칙 명시

---

## 2026-04-05

### 프론트 연동 이슈 수정 + 예약 분류 추가

1. **GET /stores/:store_id 공개 접근 허용**

   - 채팅 페이지에서 비로그인도 가게 정보 조회 가능
2. **/auth/status에 store_id, customer_id 추가**

   - 프론트에서 로그인 후 내 가게/고객 정보 바로 조회 가능
3. **AI Solution JSON 파싱 강화**

   - 파싱 실패 시 1회 재호출
   - 코드블록(```) 제거 + 필수 필드 검증
   - 프롬프트에 "JSON만 출력" 강조
4. **예약 요청 escalate에서 분리**

   - "예약하고 싶어요", "예약 변경/취소" → SSE `type: "reservation"` → 프론트가 폼 표시
   - escalate는 환불/교환/주문취소만
   - Supervisor에서 바로 처리 (별도 노드 없음)
5. **Supervisor 분류 6가지로 확장**

   - api / rag / store / escalate / reservation + 알 수 없는 intent → rag 기본 처리

---

## 2026-04-03

### SSE 스트리밍, Redis 세션, storeNode, 에스컬레이션 분석, 상담 자동 종료

1. **Redis 세션 스토어 연결**

   - MemoryStore → Redis로 변경하여 서버 재시작해도 로그인 유지
2. **SSE 스트리밍 적용**

   - graph.invoke() → graph.stream()으로 변경
   - 노드별 진행 상황을 프론트에 실시간 전송
   - type: `thinking`(생각 중) → `login_required`(로그인 유도) / `answer`(답변) / `error`(에러)
3. **storeNode 추가**

   - 가게 정보 질문(영업시간, 주소, 메뉴, 편의시설 등)은 DB 조회만으로 처리
   - Bedrock 호출 없이 빠르게 응답
4. **에스컬레이션 시 AI 분석**

   - 상담사 호출 시 status='대기'로 변경
   - AI가 대화를 분석하여 요약/감정/추천답변 자동 생성
   - 추천답변은 summary 뒤에 `[추천 답변]`으로 첨부
5. **상담 자동 종료**

   - 크론잡(5분마다 체크)으로 마지막 메시지 후 30분 비활동 상담 자동 종료
   - 상담사 호출로 대기 상태인 상담은 상담사가 종료할 때까지 유지
6. **Supervisor 분류 개선**

   - api/rag/store/escalate 4가지 분류
   - 비로그인 + 개인정보 질문 시 `login_required` 응답
   - 알 수 없는 intent는 rag로 기본 처리
7. **MAS 추론시간 개선**

   - 이전 평균 7.48초 → 현재 평균 4.78초 (36% 개선)

---

## 2026-04-01

### 임베딩 파이프라인, LangGraph 최적화, 솔루션 분석

1. **벡터 RAG 파이프라인**

   - 매뉴얼 저장 시 Bedrock Titan으로 임베딩 자동 생성
   - pgvector 유사도 검색으로 관련 매뉴얼 조회
   - 기존 매뉴얼 1193건 일괄 임베딩 완료
2. **LangGraph 최적화**

   - FT Agent, Verifier 제거
   - Guardrail + Memory 병렬 실행
   - API Agent 최대 반복 4회 → 2회
   - Bedrock 호출 최소 6회 → 3회
3. **솔루션 분석 API**

   - GET /stores/:store_id/solutions?hours=24
   - 숫자는 코드(SQL)가 계산, 해석/솔루션은 AI가 생성
4. **searchService.js 개선**

   - aicc_knowledge → manuals 테이블 전환
   - 자체 Pool → 공유 pool 사용
5. **Rate Limiting**

   - /chats 분당 10회 제한
6. **중앙 에러 핸들러**
7. **Guardrail 표준티어(교차추론) 전환**

---

## 2026-03-31

### AICC 백엔드 전면 개편

1. **인증 시스템 개편**

   - agents 테이블 제거 → ADMIN/OWNER/CUSTOMER 역할 기반
   - passport.js: stores/customers 테이블에서 역할 판별
   - 미들웨어: isOwner, isStoreOwner, isCustomerOrOwner 추가
2. **전체 API 구현 (49개 엔드포인트)**

   - 가게(12개), 상담(7개), 고객(6개), 매뉴얼(1개), 주문(9개), 상품(2개), 챗봇(3개), 배송(6개), 예약(3개)
3. **채팅 세션 관리**

   - express-session으로 caseId 유지
   - 비로그인 → 로그인 전환 시 customer_id 자동 연결
   - 종료된 케이스 감지 → 새 케이스 자동 생성
4. **신규 라우터**

   - stores.js, shipments.js, reservations.js
5. **기존 라우터 수정**

   - cases.js: memo→summary, satisfactions GET 추가
   - orders.js: order_items→items 통합, 캐스케이드 삭제
   - chat.js: speaker 한국어화 (챗봇/상담사/고객)
   - customers.js: reservations 조회 추가
6. **페이지네이션 + 필터**

   - 모든 목록 API에 page/limit/total 지원
   - 주문/예약에 status, start/end 필터 추가
7. **Swagger 전체 라우터 적용**
