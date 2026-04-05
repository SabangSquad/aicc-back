# To-Do

## 현재 해야 할 것 (프론트 연동 이슈)

### 1. GET /stores/:store_id 공개 접근 허용

**문제:** 채팅 페이지에서 가게 정보(이름, 영업시간 등)를 표시하려는데, `isAuthorized` 뒤에 있어서 비로그인 시 401.

**해결:** `/chats`처럼 `isAuthorized` 앞으로 이동하거나, 해당 GET 엔드포인트만 공개 처리.

**변경 파일:** `src/app.js` 또는 `src/routes/stores.js`

---

### 2. 로그인 후 해당 계정의 업장 정보 가져오기

**문제:** OWNER로 로그인 후 "내 가게 정보"를 가져오려면 store_id를 알아야 하는데, 프론트에서 어떻게 아는가?

**해결:** `GET /auth/status` 응답에 이미 `store_id`가 포함되어 있음.
```json
// OWNER 로그인 시 /auth/status 응답
{ "isAuthenticated": true, "user": { "store_id": 1, "role": "OWNER", ... } }
```
프론트에서 `/auth/status` → `user.store_id` 꺼내서 → `/stores/${store_id}` 호출하면 됨.

**확인:** auth.js의 status 응답에 store_id가 빠져있으면 추가 필요.

---

### 3. AI Solution 응답이 JSON 파싱 실패 (5번 중 1번만 성공)

**문제:** `GET /stores/:id/solutions`의 `ai_analysis`가 가끔 JSON이 아닌 raw 텍스트로 옴.
```json
// 실패 시
"ai_analysis": { "raw": "{\n  \"headline\": \"...\",\n ..." }

// 성공 시
"ai_analysis": { "headline": "...", "issues": [...], "strategies": [...] }
```

**원인:** LLM이 가끔 불완전한 JSON을 반환 → `JSON.parse` 실패 → raw로 폴백.

**해결 방법:**
1. analyzeSolutions()에서 JSON 파싱 재시도 (정규식으로 JSON 추출 강화)
2. 프롬프트에 "반드시 완전한 JSON만 출력하세요. 설명 텍스트 없이 JSON만." 강조
3. 파싱 실패 시 LLM 재호출 (1회)

**변경 파일:** `src/bedrock.js` analyzeSolutions()

---

### 4. 예약 질문 시 escalate로 빠지는 문제

**문제:** "예약하고 싶어요"가 escalate로 분류됨. 예약 자체는 프론트에서 폼으로 처리해야 하는데 상담사 연결로 가버림.

**현재 Supervisor 분류:**
- "예약해주세요" → escalate (처리 요청이니까)

**기대 동작:** 예약은 프론트에서 시간/인원 선택 폼을 보여주고 `POST /reservations`로 직접 생성. 챗봇이 "예약 폼을 열어드릴게요"라고 안내만 하면 됨.

**해결 방법:**
1. Supervisor에 `"reservation"` 분류 추가 — 예약 의도 감지
2. 또는 Composer 프롬프트에서 예약 요청 시 "예약 폼을 이용해주세요" 안내
3. SSE 응답에 `type: "reservation_form"` 추가 → 프론트가 폼 표시

**변경 파일:** `src/bedrock.js`, `description_md/prompt.md`

---

### 5. 이전 해야 할 것

#### 5-1. 에스컬레이션 메커니즘

LangGraph의 `graph.stream()`을 사용하여 각 노드 진행 상황을 프론트에 실시간 전송.

**변경 파일:**
- `src/bedrock.js` — `app.invoke()` → `app.stream()` + 노드별 메시지 매핑
- `src/routes/chat.js` — POST /chats에 SSE 헤더 설정 + 스트림 전송

**노드별 메시지:**

| 노드 | 메시지 |
|------|--------|
| pre | 이전 대화를 확인하고 있습니다... |
| supervisor | 질문의 의도를 파악하는 중입니다... |
| rag | 관련 규정을 찾는 중입니다... |
| api | 관련 정보를 찾는 중입니다... |
| escalate | 상담사에게 연결하는 중입니다... |
| composer | 답변을 작성하는 중입니다... |

**SSE 응답 형식:**
```
data: {"type":"thinking","message":"이전 대화를 확인하고 있습니다..."}
data: {"type":"complete","ok":true,"answer":"...","suggestions":[...],"caseId":42}
```

---

### 2. 에스컬레이션 메커니즘

AI가 해결 불가 판단 시 자동으로 상담사(OWNER)에게 넘기는 기능.

**동작 흐름:**
1. AI(Composer)가 답변 생성 시 확신도가 낮으면 → 응답에 `escalate: true` 포함
2. chat.js에서 `escalate: true` 감지 → `UPDATE cases SET status = '대기'`
3. 고객에게 "상담사에게 연결해 드리겠습니다" 메시지 반환
4. 상담사 대시보드에서 status='대기' 케이스가 최상단에 노출
5. 상담사가 GET /cases/:id/messages → POST /cases/:id/messages로 대화

**변경 파일:**
- `src/routes/chat.js` — processAICC 결과에서 escalate 감지 → status 변경
- `src/bedrock.js` — Composer 프롬프트에 escalate 판단 지시 추가
- `description_md/prompt.md` — Composer 프롬프트 수정

**Composer에 추가할 판단 기준:**
- 매뉴얼에 관련 내용이 없을 때
- 고객이 반복적으로 불만을 표출할 때 (감정: 화남/짜증)
- "상담사 연결해줘"라고 직접 요청할 때

**응답 구조 변경:**
```json
// 정상 응답
{ "ok": true, "answer": "환불은 7일 이내...", "escalated": false }

// 에스컬레이션
{ "ok": true, "answer": "상담사에게 연결해 드리겠습니다.", "escalated": true }
```

---

### 2. 목록 API 필터 추가 (페이지네이션 + status + 날짜)

**대상 엔드포인트 + 추가할 필터:**

| 엔드포인트 | page/limit | status | start/end | 현재 있는 필터 |
|-----------|-----------|--------|-----------|-------------|
| GET /stores/:id/cases | 추가 | 있음 | 있음 | status, emotion, category, start, end |
| GET /stores/:id/orders | 추가 | **추가** | **추가** | 없음 |
| GET /stores/:id/reservations | 추가 | **추가** | **추가** | 없음 |
| GET /stores/:id/manuals | 추가 | - | - | category |
| GET /stores/:id/products | 추가 | - | - | 없음 |
| GET /customers/:id/cases | 추가 | 있음 | - | status, category |
| GET /customers/:id/orders | 추가 | **추가** | - | 없음 |
| GET /customers/:id/reservations | 추가 | **추가** | - | 없음 |

**공통 파라미터:**
- `page` (기본값 1)
- `limit` (기본값 20, 최대 100)
- 응답에 `total` 포함 → 프론트에서 "더보기" 버튼 표시 여부 판단

**응답 구조:**
```json
{
  "data": [...],
  "total": 150,
  "page": 1,
  "limit": 20,
  "_links": [...]
}
```

**변경 파일:**
- `src/routes/stores.js`
- `src/routes/customers.js`

---

### 3. 프론트 연동

1. **CORS 설정** — 프론트 개발 시작하면 `npm install cors` + origin 설정
2. **프론트에서 테스트** — Swagger(/api-docs)로 전체 API 동작 확인

---

## 완료된 것

| 항목 | 상태 |
|------|------|
| Swagger JSDoc 전체 49개 엔드포인트 | 완료 |
| FT Agent 제거 | 완료 |
| 임베딩 파이프라인 (stores.js POST/PATCH + embed-manuals.js) | 완료 |
| 기존 매뉴얼 1193건 일괄 임베딩 | 완료 |
| LangGraph 속도 최적화 (병렬 + verifier 제거) | 완료 |
| searchService.js 공유 pool | 완료 |
| Rate Limiting (/chats 분당 10회) | 완료 |
| 중앙 에러 핸들러 | 완료 |
| 레거시 파일 삭제 (agents.js, order_items.js, assignAgent.js) | 완료 |
| prompt.md 프롬프트 명세서 | 완료 |
| chatting.md, vectorDB.md 상세 문서 | 완료 |
| research.md 업데이트 | 완료 |
| GET /stores/:store_id/cases 시간 필터 (start/end) | 완료 |
| GET /stores/:store_id/solutions (솔루션 분석 API) | 완료 |
| Solution Analyzer 프롬프트 (prompt.md) | 완료 |
| bedrock.js analyzeSolutions() 함수 | 완료 |
| .env 레거시 ARN 정리 (FT, Verifier, KB ID 삭제) | 완료 |
| stores.js 미사용 crypto import 제거 | 완료 |
| Guardrail 표준티어(교차추론) 전환 | 완료 |
| 목록 API 페이지네이션 (page/limit/total) + status/날짜 필터 | 완료 |
