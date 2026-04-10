# To-Do

## 현재 해야 할 것

### 1. 예약 날짜/시간 정보를 프론트에 전달

**문제:** 예약 관련 답변 시 `showReservationForm: true`만 보내고, 실제 예약 가능 날짜/시간 정보를 안 보냄. 프론트가 예약 폼을 띄워도 어떤 날짜/시간이 가능한지 모름.

**해결:** storeNode에서 조회한 예약 현황과 영업시간을 SSE 응답에 포함.

```json
{
  "type": "answer",
  "answer": "목요일 11시~19시 예약 가능합니다.",
  "showReservationForm": true,
  "reservationInfo": {
    "business_hours": { "thu": "11:00-20:00" },
    "booked": [{ "time": "14:00", "headcount": 4 }]
  }
}
```

**변경 파일:** `src/bedrock.js` storeNode + processAICC, `src/routes/chat.js`

---

### 2. Solution 404 문제

**문제:** 상담 케이스가 0건이면 `GET /stores/:id/solutions`가 404로 응답. 프론트에서 에러 처리 필요하거나, 빈 결과를 정상 응답으로 바꿔야 함.

**해결:** 케이스 0건일 때 404 대신 200으로 빈 결과 반환.

```json
{
  "store_id": 1,
  "hours": 24,
  "total_cases": 0,
  "stats": { "by_category": [], "by_emotion": [] },
  "ai_analysis": null
}
```

**변경 파일:** `src/routes/stores.js` GET /:store_id/solutions

---

### 3. Escalate 시 로그인 유도

**문제:** 비로그인 고객이 escalate되면 상담사가 답변해도 고객에게 알림을 보낼 수 없음. escalate 전에 로그인 유도 필요.

**해결:** escalateNode에서 customerId 없으면 login_required 반환.

```
비로그인 + "환불해주세요" → escalate → customerId 없음 → login_required
로그인 + "환불해주세요" → escalate → 정상 처리 (대기 + AI 분석)
```

**변경 파일:** `src/bedrock.js` supervisorNode 또는 escalateNode

---

### 4. 가게에 없는 상품/진료과목 질문 거절

**문제:** "비뇨기과 진료 가능해요?"인데 해당 병원에 비뇨기과가 없으면 거절해야 함. 현재는 store_items에 있는 내용을 그대로 답변하니까 "비뇨의학과입니다"라고만 답함.

**해결:** Composer가 store_items와 질문을 대조해서 없는 항목이면 "해당 과목/상품은 취급하지 않습니다" 답변. 프롬프트 개선으로 처리.

**변경 파일:** `description_md/prompt.md` Composer 프롬프트

---

### 5. 로그인 상태 채팅 단일 세션

**문제:** 로그인 상태에서 새 창을 열면 새 채팅이 시작됨. 진행 중인 상담이 있으면 그걸 보여줘야 하고, 기존 채팅은 종료해야 함.

**해결:**
- 로그인 유저가 POST /chats 시 → DB에서 해당 customer_id의 진행 중인 케이스 조회
- 있으면 → 해당 케이스 복원 (세션과 무관하게 DB 기반)
- 기존 세션의 chatCaseId는 같은 케이스를 가리키므로 충돌 없음

```js
// chat.js — 로그인 유저는 세션 대신 DB에서 진행 중 케이스 조회
if (req.isAuthenticated() && req.user.customer_id && !caseId) {
  const { rows } = await client.query(
    "SELECT case_id FROM cases WHERE customer_id = $1 AND status IN ('상담', '대기') ORDER BY created_at DESC LIMIT 1",
    [req.user.customer_id]
  );
  if (rows.length) caseId = rows[0].case_id;
}
```

**변경 파일:** `src/routes/chat.js`

---

### 6. Solution에 상담 품질 score 추가

**문제:** 프론트 대시보드에서 상담 품질 점수(0~100)를 보여줘야 하는데 현재 응답에 없음.

**해결:** stats 기반으로 코드에서 계산 (AI가 아닌 코드로 정확한 수치).

```
score 계산 기준:
- AI자동해결 비율 높을수록 +
- 감정 '화남'/'짜증' 비율 낮을수록 +
- 만족도 평균 높을수록 +
```

```json
{
  "store_id": 1,
  "hours": 24,
  "total_cases": 50,
  "score": 72,
  "stats": { ... },
  "ai_analysis": { ... }
}
```

**변경 파일:** `src/routes/stores.js` GET /:store_id/solutions

---

### 7. 고객 로그인 라우트 분리

**문제:** 현재 `GET /auth/google`로 OWNER/CUSTOMER 모두 로그인. 로그인 성공 시 무조건 `/home`으로 리다이렉트되는데, 고객은 `/home`이 아니라 채팅 페이지로 가야 함.

**해결:** 고객용 로그인 라우트 추가. redirect URL을 분리.

```
/auth/google              → OWNER/ADMIN 로그인 → /home (대시보드)
/auth/google/customer     → CUSTOMER 로그인 → /chat (채팅 페이지)
```

또는 로그인 후 role 기반으로 리다이렉트 분기:

```js
// auth.js callback에서
if (user.role === 'CUSTOMER') return res.redirect(`${ROOT_URL}/chat`);
return res.redirect(`${ROOT_URL}/home`);
```

**변경 파일:** `src/routes/auth.js`

---

### 기존 해야 할 것

#### 프론트 연동

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
| chatting.md, vectorDB.md, login.md 상세 문서 | 완료 |
| research.md 업데이트 | 완료 |
| GET /stores/:store_id/cases 시간 필터 (start/end) | 완료 |
| GET /stores/:store_id/solutions (솔루션 분석 API) | 완료 |
| Solution Analyzer 프롬프트 + JSON 파싱 재시도 | 완료 |
| .env 레거시 ARN 정리 (FT, Verifier, KB ID 삭제) | 완료 |
| Guardrail 표준티어(교차추론) 전환 | 완료 |
| 목록 API 페이지네이션 (page/limit/total) + status/날짜 필터 | 완료 |
| GET /stores/:store_id 공개 접근 허용 | 완료 |
| /auth/status에 store_id, customer_id 추가 | 완료 |
| SSE 스트리밍 (graph.stream) | 완료 |
| Redis 세션 스토어 | 완료 |
| storeNode (가게 정보 + 예약 현황 + 상품 목록 + formatStoreInfo) | 완료 |
| 에스컬레이션 (AI 분석 + status='대기' + 추천답변) | 완료 |
| 상담 자동 종료 (크론잡 30분 + 세션 복원 시 체크) | 완료 |
| 다른 가게 채팅 시 이전 세션 자동 종료 | 완료 |
| store_category Supervisor 전달 | 완료 |
| 업종별 미지원 기능 코드 차단 (unsupported) | 완료 |
| greeting 분기 (인사 → rag 건너뛰고 composer로) | 완료 |
| reservation → showReservationForm 통일 | 완료 |
| 예약 날짜 추출 (extractDateRange) | 완료 |
| rag → store 자동 전환 (규정 질문 아닌 일반 정보) | 완료 |
| 로그인 메시지 상황별 분리 | 완료 |
| Composer 프롬프트 개선 (불필요 안내 제거, 상담 무관 거절, 예약 안내) | 완료 |
| Supervisor 프롬프트 개선 (store_category, store 키워드 강화) | 완료 |
| reason 의도별 표시 (매뉴얼 기반/데이터 조회/가게 정보 등) | 완료 |
| 자동 종료 시 AI자동해결/종료 분기 (speaker='상담사' 기준) | 완료 |
| 모든 종료 경로에서 AI 분석(감정/요약) 실행 | 완료 |
