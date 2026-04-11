# 채팅 시스템 로직 정리

## 개요

고객이 챗봇과 대화하는 전체 흐름. REST API 기반이며, express-session으로 대화 세션을 유지한다.
세션 쿠키(connect.sid) maxAge는 **30분**. 브라우저를 닫거나 30분 비활성 시 만료된다.

---

## 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/chats` | 고객 메시지 전송 → AI 응답 수신 |
| POST | `/chats/{case_id}/close` | 상담 종료 + 세션 초기화 (AI자동해결 또는 종료) |
| POST | `/chats/{case_id}` | 상담 분석 (감정/요약/추천답변) — 상담사용 |

---

## 핵심 로직: POST /chats

### 1단계: caseId 결정 → `src/routes/chat.js` POST "/" 핸들러 상단

```
우선순위: body.caseId > req.session.chatCaseId > 신규 생성
```

- body에 caseId가 있으면 그대로 사용
- 없으면 세션에서 복원 시도
- 세션에도 없으면 새 케이스 생성

### 2단계: 종료된 케이스 감지 → `src/routes/chat.js` 세션 복원 직후

세션에서 복원한 caseId의 status가 `종료` 또는 `AI자동해결`이면:
- caseId를 null로 초기화
- 세션에서 chatCaseId 삭제
- 새 케이스를 생성

### 3단계: 신규 케이스 생성 → `src/routes/chat.js` 케이스 INSERT 부분

```js
INSERT INTO cases (store_id, customer_id, status, created_at)
VALUES ($1, $2, '상담', NOW())
```

- `store_id`: body에서 받음 (필수)
- `customer_id`: 로그인 시 req.user.customer_id, 비로그인 시 NULL

### 4단계: 세션 저장 → `src/routes/chat.js` 케이스 생성 직후

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
| 브라우저 닫기 → 다시 열기 | X | maxAge 30분 — 세션 쿠키 만료 |
| 30분 이상 비활성 | X | maxAge 초과로 쿠키 만료 |
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

### 5단계: 비로그인→로그인 customer_id 연결 → `src/routes/chat.js` customer_id UPDATE 부분

```js
if (req.isAuthenticated() && req.user.customer_id) {
  UPDATE cases SET customer_id = $1
  WHERE case_id = $2 AND customer_id IS NULL
}
```

비로그인 상태에서 시작한 대화가 로그인 후에도 이어지며, 이때 케이스에 고객 ID가 자동 연결된다.

### 6단계: 고객 메시지 저장 → `src/routes/chat.js` messages INSERT (speaker='고객')

```js
INSERT INTO messages (case_id, content, speaker, occurred_at)
VALUES ($1, $2, '고객', NOW())
```

### 7단계: AI 호출 → `src/routes/chat.js` → `src/bedrock.js` processAICC()

```js
const result = await processAICC(message, caseId, storeId);
```

호출 전 cases 테이블에서 category 조회 → LangGraph 워크플로우에 전달.

bedrock.js의 LangGraph 워크플로우 실행 → `src/bedrock.js` 전체:
```
guardrail + memory (병렬) → supervisor → api/rag/store → composer → END
                                       → greeting → composer → END (인사 — rag 건너뜀)
                                       → escalate → END (상담사 연결 + AI 분석)
                                       → unsupported → END (업종 미지원)
```

- guardrail: `src/bedrock.js` guardrailNode — Bedrock Guardrail API 호출
- memory: `src/bedrock.js` memoryLoaderNode — DB에서 최근 5개 메시지 로드 + 요약
- supervisor: `src/bedrock.js` supervisorNode — intent 분류 + 코드 후처리 (업종 체크, 인사 감지, 예약/store 보정, reservation_type 판정)
- rag: `src/bedrock.js` ragNode → `src/services/searchService.js` findSimilarContext()
- api: `src/bedrock.js` apiNode → 내부 REST API 호출 (axios). 비로그인 시 `login_required`
- store: `src/bedrock.js` storeNode → GET /stores/:store_id + 예약 현황/상품 목록 추가 조회. 예약 action + 로그인 시 `showReservationForm: true` + `availableSlots`, action + 비로그인 시 `login_required`(가능 시간 참고 포함), inquiry는 텍스트 안내만
- greeting: supervisor에서 sourceData 직접 설정 → rag 건너뛰고 composer로
- escalate: `src/bedrock.js` escalateNode — AI 분석(요약/감정/추천답변) + status='대기'
- unsupported: supervisor에서 업종 미지원 감지 → 바로 END
- composer: `src/bedrock.js` composerNode — 최종 답변 + 추천 질문 생성

#### supervisor 코드 후처리 순서 (`src/bedrock.js` supervisorNode)
1. 업종별 미지원 체크 (이커머스+예약, 병원+환불 등) → unsupported
2. "예약" 키워드 → 규정 질문이면 rag, 내 예약 조회면 api, 나머지는 store
3. rag인데 인사면 → greeting (composer로 직접)
4. rag인데 규정 질문 아니면 → store로 전환
5. escalate + 비로그인 → login_required
6. 알 수 없는 intent → rag로 기본
7. reservation_type 확정 (intent === store 일 때): Supervisor가 준 값 우선, 없으면 행동 동사(할래/할게/하고 싶어/해줘/잡아/잡고 싶어) 정규식으로 inquiry/action 판정

#### SSE 응답 타입
| type | 의미 | 발생 조건 |
|------|------|----------|
| thinking | 노드 진행 중 | 매 노드 완료 시 |
| answer | 최종 답변 | rag/api/store/greeting → composer 완료. 예약 action + 로그인 시 `showReservationForm: true` + `availableSlots` 포함 |
| login_required | 로그인 필요 | api 개인 데이터 조회, escalate, 예약 action(실제 예약 의사) + 비로그인. 상황별 메시지 (예약은 가능 시간 참고로 포함) |
| error | 에러 | 예외 발생 |

### 8단계: AI 답변 저장 + 응답 → `src/routes/chat.js` messages INSERT (speaker='챗봇')

```js
INSERT INTO messages (case_id, content, speaker, occurred_at)
VALUES ($1, $2, '챗봇', NOW())
```

클라이언트에 `{ ok, answer, suggestions, caseId }` 반환.

---

## POST /chats/{case_id}/close → `src/routes/chat.js` POST "/:case_id/close"

### 동작

1. 종료 전 현재 status 확인 → `src/routes/chat.js`
2. 상담사 개입 여부에 따라 최종 status 결정:
   - status가 `대기`였으면 (상담사 호출됨) → `종료`
   - status가 `상담`이었으면 (AI만 처리) → `AI자동해결`
3. `UPDATE cases SET status=$1, closed_at=NOW()` → `src/routes/chat.js`
4. `delete req.session.chatCaseId` — 다음 채팅은 새 케이스 → `src/routes/chat.js`
5. `setImmediate`로 비동기 AI 분석 실행 → `src/routes/chat.js` → `src/bedrock.js` analyzeCaseConversation():
   - messages 테이블에서 대화 전체 조회
   - `analyzeCaseConversation()` 호출 → 감정(emotion) + 요약(summary) 추출
   - cases 테이블에 emotion, summary 업데이트

### 비동기 분석 이유

종료 응답은 즉시 반환하고, AI 분석은 백그라운드에서 실행. 분석 실패해도 종료 자체는 성공.

---

## POST /chats/{case_id} (상담사용 분석) → `src/routes/chat.js` POST "/:case_id"

상담사(OWNER)가 대시보드에서 특정 케이스를 분석할 때 사용.

1. messages에서 해당 case_id의 전체 대화 조회 → `src/routes/chat.js`
2. LLM에 대화 텍스트 전달 → `src/bedrock.js` analyzeCaseConversation()
3. 결과: `{ emotion, summary, suggested_answer }`
4. emotion, summary를 cases 테이블에 자동 저장 → `src/routes/chat.js`

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
  ├─ [AI가 해결 불가 / 환불·취소·교환 카테고리]
  │   → escalate: status='대기', 상담사 호출 안내
  │
  └─ POST /chats/42/close (또는 30분 비활동 시 크론잡/세션 복원에서 자동 종료)
      → messages에 speaker='상담사' 있나?
        → 없음 → status='AI자동해결'
        → 있음 → status='종료'
      → session 초기화
      → 비동기 AI 분석 (감정/요약)
```

---

## 상담사 대화 (에스컬레이션) → `src/routes/cases.js` messages 라우트

AI가 해결 못하면 상담사(OWNER)가 개입:

```
상담사: GET /cases/42/messages     ← src/routes/cases.js GET "/:case_id/messages"
상담사: POST /cases/42/messages    ← src/routes/cases.js POST "/:case_id/messages" { content, speaker:'상담사' }
고객:   GET /cases/42/messages     ← 프론트에서 3초 polling → 상담사 답변 표시
```

별도 WebSocket 없이 REST polling으로 동작.

---

## 종료 방식 정리

| 종료 방식 | 트리거 | 상담사 없음 | 상담사 있음 | AI 분석 | 파일 |
|----------|--------|-----------|-----------|---------|------|
| 고객이 종료 클릭 | `POST /chats/:id/close` | AI자동해결 | 종료 | ✓ | `src/routes/chat.js` |
| 30분 비활동 (크론잡) | `setInterval` 5분마다 체크 | AI자동해결 | 종료 | ✓ | `src/app.js` |
| 세션 복원 시 30분 초과 | 다음 메시지 보낼 때 | AI자동해결 | 종료 | ✓ | `src/routes/chat.js` |
| 다른 가게로 전환 | store_id 다를 때 | AI자동해결 | 종료 | ✓ | `src/routes/chat.js` |
| 상담사가 직접 종료 | `PATCH /cases/:id` | - | 종료 | ✓ | `src/routes/cases.js` |

판단 기준: `SELECT 1 FROM messages WHERE case_id = $1 AND speaker = '상담사' LIMIT 1`
- 있음 → **종료** (상담사가 개입한 상담)
- 없음 → **AI자동해결** (AI만으로 해결된 상담)

'대기' 상태 케이스는 자동 종료 **안 됨** (상담사가 직접 종료).

---

## LangGraph 체크포인터 테이블 → `src/bedrock.js` checkpointer + `src/app.js` initializeCheckpointer()

LangGraph가 대화 상태를 유지하기 위해 자동 생성하는 PostgreSQL 테이블들이다. `src/app.js`에서 서버 시작 시 `src/bedrock.js`의 `checkpointer.setup()`이 호출되면 자동으로 만들어진다.

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
