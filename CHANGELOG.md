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
