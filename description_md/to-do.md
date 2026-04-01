# To-Do

## 현재 해야 할 것

### 1. 에스컬레이션 메커니즘

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
