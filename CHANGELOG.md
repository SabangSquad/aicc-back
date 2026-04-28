# 변경 이력

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
