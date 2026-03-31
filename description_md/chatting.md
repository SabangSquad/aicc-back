# 채팅 시스템 로직 정리

## 개요

고객이 챗봇과 대화하는 전체 흐름. REST API 기반이며, express-session으로 대화 세션을 유지한다.

---

## 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/chats` | 고객 메시지 전송 → AI 응답 수신 |
| POST | `/chats/{case_id}/close` | 상담 종료 + 세션 초기화 |
| POST | `/chats/{case_id}` | 상담 분석 (감정/요약/추천답변) — 상담사용 |

---

## 핵심 로직: POST /chats

### 1단계: caseId 결정

```
우선순위: body.caseId > req.session.chatCaseId > 신규 생성
```

- body에 caseId가 있으면 그대로 사용
- 없으면 세션에서 복원 시도
- 세션에도 없으면 새 케이스 생성

### 2단계: 종료된 케이스 감지

세션에서 복원한 caseId의 status가 `종료` 또는 `AI자동해결`이면:
- caseId를 null로 초기화
- 세션에서 chatCaseId 삭제
- 새 케이스를 생성

### 3단계: 신규 케이스 생성

```js
INSERT INTO cases (store_id, customer_id, status, created_at)
VALUES ($1, $2, '상담', NOW())
```

- `store_id`: body에서 받음 (필수)
- `customer_id`: 로그인 시 req.user.customer_id, 비로그인 시 NULL

### 4단계: 세션 저장

```js
req.session.chatCaseId = caseId;
```

비로그인이어도 express-session 쿠키(connect.sid)로 유지됨.

---

## 세션 유지 상세 설명

### express-session이 뭘 하는가

1. 고객이 처음 서버에 요청하면, express-session이 **고유한 세션 ID**를 생성한다
2. 이 세션 ID를 **쿠키(`connect.sid`)**에 담아 브라우저에 보낸다
3. 서버 메모리(또는 Redis)에 `{ 세션ID: { chatCaseId: 42 } }` 형태로 저장한다
4. 다음 요청부터 브라우저가 쿠키를 자동으로 보내고, 서버가 세션 ID로 데이터를 복원한다

```
[첫 요청]
브라우저 → POST /chats { message }
서버     ← Set-Cookie: connect.sid=s%3Aabc123...

[두 번째 요청]
브라우저 → POST /chats { message }
         Cookie: connect.sid=s%3Aabc123...
서버     → req.session.chatCaseId = 42  ← 이전에 저장한 값이 자동 복원됨
```

### 세션 = caseId 연결고리

세션의 유일한 역할은 **"이 브라우저가 지금 42번 상담 중"**이라는 것을 기억하는 것이다.

```
세션 데이터: { chatCaseId: 42 }
                    ↓
이걸로 messages 테이블에서 해당 케이스의 대화를 찾고
이걸로 AI(processAICC)에 같은 caseId를 전달하고
이걸로 LangGraph 체크포인터가 같은 thread_id를 사용한다
```

### 세션이 살아있는 조건

| 상황 | 세션 유지? | 이유 |
|------|-----------|------|
| 같은 탭에서 계속 대화 | O | 쿠키가 매 요청에 포함됨 |
| 새 탭 열기 (같은 브라우저) | O | 쿠키는 브라우저 단위로 공유 |
| 브라우저 닫기 → 다시 열기 | △ | 세션 쿠키가 만료 전이면 유지 |
| 다른 브라우저/시크릿 모드 | X | 쿠키가 다름 → 새 세션 |
| 로그인 (Google OAuth) | O | connect.sid 쿠키가 리다이렉트를 거쳐도 유지됨 |
| POST /chats/:id/close 호출 | X (의도적) | `delete req.session.chatCaseId` |

### 세션이 끊기면 무슨 일이 일어나는가

```
세션 없음 + body에 caseId 없음
  → caseId = null
  → 새 케이스 생성
  → 이전 대화와 완전히 분리된 새 상담 시작
```

이전 대화 데이터(messages)는 DB에 그대로 남아있다. 다만 세션이 끊기면 **어떤 케이스인지 모르니까** 새로 만드는 것이다.

### 비로그인 → 로그인 세션 유지 상세

```
① 비로그인 상태
   브라우저 쿠키: connect.sid=abc123
   서버 세션: { chatCaseId: 42 }
   DB: cases WHERE case_id=42 → customer_id=NULL

② Google OAuth 로그인 클릭
   브라우저 → /auth/google → Google 로그인 페이지 → /auth/google/callback
   이 과정에서 connect.sid 쿠키는 같은 도메인이므로 유지됨

③ 로그인 완료 후 돌아옴
   브라우저 쿠키: connect.sid=abc123 (동일!)
   서버 세션: { chatCaseId: 42, passport: { user: { customer_id: 100 } } }
   → 세션에 chatCaseId도 있고 로그인 정보도 있음

④ 다음 메시지 전송
   POST /chats { message }
   → req.session.chatCaseId = 42 (복원)
   → req.isAuthenticated() = true
   → req.user.customer_id = 100
   → UPDATE cases SET customer_id=100 WHERE case_id=42 AND customer_id IS NULL
   → 이제 42번 케이스는 고객 100번의 상담으로 연결됨
```

핵심: **connect.sid 쿠키가 OAuth 리다이렉트를 거쳐도 유지**되기 때문에 가능하다. 쿠키는 도메인 기반이지 URL 기반이 아니다.

### 5단계: 비로그인→로그인 customer_id 연결

```js
if (req.isAuthenticated() && req.user.customer_id) {
  UPDATE cases SET customer_id = $1
  WHERE case_id = $2 AND customer_id IS NULL
}
```

비로그인 상태에서 시작한 대화가 로그인 후에도 이어지며, 이때 케이스에 고객 ID가 자동 연결된다.

### 6단계: 고객 메시지 저장

```js
INSERT INTO messages (case_id, content, speaker, occurred_at)
VALUES ($1, $2, '고객', NOW())
```

### 7단계: AI 호출

```js
const result = await processAICC(message, caseId, storeId);
```

bedrock.js의 LangGraph 워크플로우 실행:
```
guardrail + memory (병렬) → supervisor → api 또는 rag → composer
```

### 8단계: AI 답변 저장 + 응답

```js
INSERT INTO messages (case_id, content, speaker, occurred_at)
VALUES ($1, $2, '챗봇', NOW())
```

클라이언트에 `{ ok, answer, suggestions, caseId }` 반환.

---

## POST /chats/{case_id}/close

### 동작

1. `UPDATE cases SET status='종료', closed_at=NOW()` (이미 종료면 404)
2. `delete req.session.chatCaseId` — 다음 채팅은 새 케이스
3. `setImmediate`로 비동기 AI 분석 실행:
   - messages 테이블에서 대화 전체 조회
   - `analyzeCaseConversation()` 호출 → 감정(emotion) + 요약(summary) 추출
   - cases 테이블에 emotion, summary 업데이트

### 비동기 분석 이유

종료 응답은 즉시 반환하고, AI 분석은 백그라운드에서 실행. 분석 실패해도 종료 자체는 성공.

---

## POST /chats/{case_id} (상담사용 분석)

상담사(OWNER)가 대시보드에서 특정 케이스를 분석할 때 사용.

1. messages에서 해당 case_id의 전체 대화 조회
2. LLM에 대화 텍스트 전달
3. 결과: `{ emotion, summary, suggested_answer }`
4. emotion, summary를 cases 테이블에 자동 저장

---

## 세션 흐름 다이어그램

```
[비로그인 고객]
  │
  ├─ POST /chats { message, store_id:1 }
  │   → case_id=42 생성 (customer_id=NULL)
  │   → session.chatCaseId = 42
  │   → AI 응답
  │
  ├─ POST /chats { message }
  │   → session에서 case_id=42 복원
  │   → 같은 케이스에 메시지 추가
  │
  ├─ [로그인]
  │   → session 쿠키 유지 (connect.sid)
  │
  ├─ POST /chats { message }
  │   → session에서 case_id=42 복원
  │   → customer_id=100 자동 연결
  │   → AI가 고객 정보 기반 답변 가능
  │
  └─ POST /chats/42/close
      → status='종료', session 초기화
      → 비동기 AI 분석 (감정/요약)
```

---

## 상담사 대화 (에스컬레이션)

AI가 해결 못하면 상담사(OWNER)가 개입:

```
상담사: GET /cases/42/messages     ← 대화 내역 확인 (polling)
상담사: POST /cases/42/messages    ← { content, speaker:'상담사' }
고객:   GET /cases/42/messages     ← 프론트에서 3초 polling → 상담사 답변 표시
```

별도 WebSocket 없이 REST polling으로 동작.

---

## LangGraph 체크포인터 테이블

LangGraph가 대화 상태를 유지하기 위해 자동 생성하는 PostgreSQL 테이블들이다. `app.js`에서 서버 시작 시 `checkpointer.setup()`이 호출되면 자동으로 만들어진다.

| 테이블 | 역할 |
|--------|------|
| `checkpoints` | 각 대화(thread_id = caseId)별 그래프 실행 상태의 스냅샷 저장. 어떤 노드까지 진행했는지, 현재 상태 채널 값이 뭔지 기록. |
| `checkpoint_blobs` | 체크포인트의 실제 데이터(직렬화된 바이너리). 상태 객체(userQuery, historySummary, sourceData 등)의 전체 내용이 여기에 저장됨. |
| `checkpoint_writes` | 각 노드가 실행될 때마다의 쓰기 기록. 노드별로 어떤 상태 채널에 뭘 썼는지 추적. 그래프 재실행/복구에 사용. |
| `checkpoint_migrations` | 체크포인터 스키마 버전 관리. LangGraph 라이브러리 업데이트 시 테이블 구조 변경을 추적. |

### 왜 필요한가

같은 caseId로 여러 번 `processAICC()`를 호출하면, LangGraph가 이전 호출의 상태를 체크포인터에서 복원한다. 이를 통해:
- 대화 맥락이 호출 간에 유지됨
- 서버 재시작 후에도 진행 중인 대화 상태가 보존됨
- `thread_id = caseId`이므로 케이스당 독립적인 상태 관리

### 주의사항

- db_table.md에 넣지 않는다 — LangGraph 내부 인프라 테이블
- 직접 조회/수정하지 않는다 — 라이브러리가 관리
- 케이스 종료(close) 후에도 체크포인트는 남아있음 — 새 케이스는 새 thread_id로 생성되므로 문제없음

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/routes/chat.js` | 3개 엔드포인트 (채팅, 종료, 분석) |
| `src/bedrock.js` | LangGraph 워크플로우 (AI 응답 생성) |
| `src/routes/cases.js` | GET/POST messages (상담사 대화) |
| `src/config/passport.js` | OWNER/CUSTOMER 인증 |
| `src/middlewares/auth.js` | isAuthorized (채팅은 앞에 배치해서 비로그인 허용) |
