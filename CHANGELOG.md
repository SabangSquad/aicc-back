# 변경 이력

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
