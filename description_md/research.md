# AICC-Back 코드베이스 분석 보고서

> 분석일: 2026-04-01 (초안), 최종 수정: 2026-05-19
> 대상 경로: `c:\Users\ChupopChoos\aicc-back`

> ⚠️ **주요 변경 사항 (2026-04 → 05)**
> - **AI/LLM**: AWS Bedrock(Claude) → **vLLM 자체 호스팅 (Qwen3-8B-AWQ)** (컨텍스트 3072 토큰)
> - 프롬프트 단일 소스: `src/prompts/templates.js` (ARN/Prompt Management 의존성 제거)
> - 본인 데이터 + 매뉴얼 결합 답변 (apiNode categoryHint + composer 룰 5)
> - 회피 멘트 변경: "고객센터" → "매장 사장님" (post-process 자동 치환)
> - 매뉴얼/상품 DELETE 엔드포인트 추가
> - 솔루션 score 만족도 없을 때 70점 만점 → 100점 환산
> - 정성 평가 도구 (scripts/eval-export.js, eval-solutions.js) — 4.275/5 (85.5%)

---

## 1. 프로젝트 개요

AICC-Back은 **AI 기반 컨택센터(AI Contact Center) 백엔드**다.
자영업자(병원/식당/이커머스)의 고객 상담을 AI 챗봇으로 자동 처리하고, 해결 불가 시 상담사(OWNER)가 개입하는 구조.

**핵심 기술 스택:**

| 영역 | 기술 |
|------|------|
| 런타임 | Node.js (ES6 모듈) |
| 웹 프레임워크 | Express 5.1.0 |
| 데이터베이스 | PostgreSQL + pgvector |
| AI/LLM | **vLLM 자체 호스팅 (Qwen3-8B-AWQ)** — 컨텍스트 3072 토큰 |
| 임베딩 | Amazon Titan Embed Text v2 (1024차원) — 매뉴얼 임베딩 전용 |
| AI 오케스트레이션 | LangGraph (상태 머신 + PostgreSQL 체크포인터) |
| 인증 | Google OAuth 2.0 + Passport.js + express-session (Redis 스토어) |
| 보안 | Rate Limiting (express-rate-limit), regex+LLM 가드레일 |
| API 문서 | Swagger / OpenAPI 3.0 |
| 인프라 | Docker, K8s (aicc 네임스페이스), Nginx |

---

## 2. 디렉토리 구조

```
aicc-back/
├── src/
│   ├── app.js                  # Express 서버 진입점 (중앙 에러 핸들러 포함)
│   ├── db.js                   # PostgreSQL 커넥션 풀 (공유)
│   ├── bedrock.js              # LangGraph AI 오케스트레이션
│   ├── swagger.js              # Swagger 설정
│   ├── config/
│   │   └── passport.js         # Google OAuth (ADMIN/OWNER/CUSTOMER)
│   ├── constants/
│   │   └── caseStatus.js       # 상담 상태 상수
│   ├── middlewares/
│   │   └── auth.js             # isAuthorized, isAdmin, isOwner, isStoreOwner, isCustomerOrOwner
│   ├── routes/
│   │   ├── auth.js             # OAuth 로그인/로그아웃
│   │   ├── stores.js           # 가게 CRUD + 하위 리소스 13개 (pagination, 필터, solutions)
│   │   ├── cases.js            # 상담 CRUD + messages + satisfactions 7개
│   │   ├── customers.js        # 고객 CRUD + 목록 6개 (pagination, status 필터)
│   │   ├── chat.js             # 챗봇 AI 질의/종료/분석 3개
│   │   ├── orders.js           # 주문 CRUD + items + shipments 9개
│   │   ├── shipments.js        # 배송 CRUD + tracks 6개
│   │   ├── reservations.js     # 예약 CRUD 3개
│   │   ├── products.js         # 상품 조회/수정 2개
│   │   └── manuals.js          # 매뉴얼 단건 조회 1개
│   ├── services/
│   │   ├── searchService.js    # pgvector 유사도 검색 (manuals 테이블, 공유 pool)
│   │   └── embeddingService.js # Bedrock Titan 벡터 생성 (generateEmbedding)
│   ├── utils/
│   │   └── pagination.js       # 공통 페이지네이션 파서 (parsePagination)
│   └── scripts/
│       └── embed-manuals.js    # 기존 매뉴얼 일괄 임베딩
├── description_md/             # 프로젝트 문서
│   ├── api_doc.md              # API 명세서 (50개 엔드포인트)
│   ├── db_table.md             # DB 테이블 정의서 (12개 테이블)
│   ├── plan.md                 # 구현 계획서
│   ├── to-do.md                # 작업 목록
│   ├── chatting.md             # 채팅 세션 로직 정리
│   ├── vectorDB.md             # 벡터 DB & RAG 정리
│   ├── prompt.md               # AI 프롬프트 명세서
│   └── research.md             # 본 문서
├── Dockerfile
├── docker-compose.yml
└── package.json
```

**파일 통계:**

| 구분 | 파일 수 | 라인 수 |
|------|---------|---------|
| 코어 (app, db, swagger) | 3 | ~130 |
| AI 엔진 (bedrock) | 1 | ~340 |
| 인증 (passport, auth) | 2 | ~120 |
| 라우터 (10개) | 10 | ~3,200 |
| 서비스 (2개) | 2 | ~55 |
| 유틸 (pagination) | 1 | ~15 |
| 상수 + 스크립트 | 2 | ~75 |
| **합계** | **21** | **~3,935** |

---

## 3. 데이터베이스 스키마

### 3.1 테이블 (12개)

| 테이블 | 주요 컬럼 | 설명 |
|--------|-----------|------|
| stores | store_id, name, category, phone, email, address, business_hours(JSON), facilities(JSON), notice, store_items(JSON) | 가게 |
| customers | customer_id, store_id, name, phone, email, address, birthdate | 고객 |
| cases | case_id, customer_id, store_id, order_id, reservation_id, category, status, summary, emotion, created_at, closed_at | 상담건 |
| messages | message_id, case_id, speaker, content, occurred_at | 대화 메시지 |
| satisfactions | satisfaction_id, case_id, store_id, score, collected_at | 만족도 |
| manuals | manual_id, store_id, title, category, content, edited_at, file_hash, embedding(vector 1024) | 규정/매뉴얼 |
| orders | order_id, customer_id, store_id, status, total_price, ordered_at | 주문 |
| items | item_id, order_id, product_id, quantity, total_price | 주문품목 |
| products | product_id, store_id, name, price | 상품 |
| shipments | shipment_id, order_id, store_id, tracking_no, carrier, promised_at, delivered_at | 배송 |
| tracks | track_id, shipment_id, event_at, event_type, location | 배송이력 |
| reservations | reservation_id, store_id, customer_id, reserved_at, status, headcount | 예약 |

### 3.2 관계 다이어그램

```
stores (1)
  ├──< customers (N)
  ├──< cases (N)
  ├──< orders (N)
  ├──< shipments (N)
  ├──< manuals (N)
  ├──< products (N)
  ├──< reservations (N)
  └──< satisfactions (N)

customers (1)
  ├──< cases (N)
  ├──< orders (N)
  └──< reservations (N)

cases (1)
  ├──< messages (N)
  ├──< satisfactions (N)
  ├── order_id → orders
  └── reservation_id → reservations

orders (1)
  ├──< items (N)
  └──< shipments (N) ──< tracks (N)
```

### 3.3 Enum 값

| 컬럼 | 허용값 |
|------|--------|
| stores.category | 병원, 식당, 이커머스 |
| cases.status | 대기, 상담, 종료, AI자동해결 |
| cases.emotion | 평온, 기쁨, 슬픔, 화남, 짜증 |
| cases.category | 업종별 상이, 단일 토픽. 병원: 예약/예약확인/예약변경/예약취소/진료과목. 식당: 예약/예약확인/예약변경/예약취소/메뉴/가격. 이커머스: 배송조회/주문확인/환불/교환/주문취소/상품정보 |
| orders.status | 준비, 배송, 완료, 반품, 취소 |
| reservations.status | 완료, 취소 |
| messages.speaker | 챗봇, 상담사, 고객 |
| tracks.event_type | 집하처리, 간선상차, 간선하차, 배송출고, 배송완료 |
| satisfactions.score | 0.5~5 (0.5 간격) |

---

## 4. API 엔드포인트 (50개)

### 4.1 가게 (stores.js — 13개)

| 메서드 | 경로 | 설명 | 인가 | 비고 |
|--------|------|------|------|------|
| POST | `/stores` | 가게 추가 | isAdmin | |
| GET | `/stores/:store_id` | 가게 정보 조회 | isAuthorized | |
| PATCH | `/stores/:store_id` | 가게 정보 수정 | isStoreOwner | |
| GET | `/stores/:store_id/cases` | 가게 상담 목록 | isStoreOwner | pagination |
| GET | `/stores/:store_id/satisfactions` | 가게 만족도 | isStoreOwner | pagination |
| GET | `/stores/:store_id/orders` | 가게 주문 목록 | isStoreOwner | pagination + status/start/end 필터 |
| GET | `/stores/:store_id/reservations` | 가게 예약 목록 | 공개 | pagination + status/start/end 필터. customer_id는 해당 가게 OWNER/ADMIN/내부 호출에만 노출 |
| GET | `/stores/:store_id/manuals` | 가게 매뉴얼 목록 | isAuthorized | pagination |
| POST | `/stores/:store_id/manuals` | 매뉴얼 추가 (+ 임베딩 자동 생성) | isStoreOwner | |
| PATCH | `/stores/:store_id/manuals/:manual_id` | 매뉴얼 수정 (content 변경 시 임베딩 재생성) | isStoreOwner | |
| GET | `/stores/:store_id/products` | 가게 상품 목록 | isAuthorized | pagination |
| POST | `/stores/:store_id/products` | 상품 추가 | isStoreOwner | |
| GET | `/stores/:store_id/solutions` | 상담 솔루션 분석 (AI) | isStoreOwner | `?hours=N` |

### 4.2 상담 (cases.js — 7개)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/cases` | 신규 상담 생성 |
| GET | `/cases/:case_id` | 상담 정보 조회 |
| PATCH | `/cases/:case_id` | 상담 정보 수정 (종료 시 AI 분석 트리거) |
| POST | `/cases/:case_id/satisfactions` | 만족도 추가 (0.5~5) |
| GET | `/cases/:case_id/satisfactions` | 만족도 조회 |
| GET | `/cases/:case_id/messages` | 메시지 조회 |
| POST | `/cases/:case_id/messages` | 메시지 추가 |

### 4.3 고객 (customers.js — 6개)

| 메서드 | 경로 | 설명 | 인가 | 비고 |
|--------|------|------|------|------|
| POST | `/customers` | 고객 추가 | isOwner | |
| GET | `/customers/:customer_id` | 고객 정보 조회 | isCustomerOrOwner | |
| PATCH | `/customers/:customer_id` | 고객 정보 수정 | isCustomerOrOwner | |
| GET | `/customers/:customer_id/cases` | 고객 상담 목록 | isCustomerOrOwner | pagination + status/category 필터 |
| GET | `/customers/:customer_id/orders` | 고객 주문 목록 | isCustomerOrOwner | pagination + status 필터 |
| GET | `/customers/:customer_id/reservations` | 고객 예약 목록 | isCustomerOrOwner | pagination + status 필터 |

### 4.4 매뉴얼 (manuals.js — 1개)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/manuals/:manual_id` | 매뉴얼 단건 조회 |

### 4.5 주문 (orders.js — 9개)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/orders` | 주문 추가 |
| GET | `/orders/:order_id` | 주문 정보 조회 |
| PATCH | `/orders/:order_id` | 주문 상태 수정 |
| DELETE | `/orders/:order_id` | 주문 삭제 (tracks→shipments→items 캐스케이드) |
| GET | `/orders/:order_id/shipments` | 주문 배송 조회 |
| GET | `/orders/:order_id/items` | 주문품목 목록 |
| POST | `/orders/:order_id/items` | 주문품목 추가 (가격 자동 계산) |
| PATCH | `/orders/:order_id/items/:item_id` | 주문품목 수량 수정 |
| DELETE | `/orders/:order_id/items/:item_id` | 주문품목 삭제 |

### 4.6 상품 (products.js — 2개)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/products/:product_id` | 상품 단건 조회 |
| PATCH | `/products/:product_id` | 상품 수정 |

### 4.7 챗봇 (chat.js — 3개, 비로그인 허용 + Rate Limit 분당 10회)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/chats` | AI 질문 → 답변 (세션 기반 케이스 유지) |
| POST | `/chats/:case_id/close` | 상담 종료 + 세션 초기화 + 비동기 AI 분석 |
| POST | `/chats/:case_id` | 대화 분석 → emotion/summary 자동 저장 |

### 4.8 배송 (shipments.js — 6개)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/shipments` | 배송 추가 |
| GET | `/shipments/:shipment_id` | 배송 단건 조회 |
| PATCH | `/shipments/:shipment_id` | 배송 정보 수정 |
| GET | `/shipments/:shipment_id/tracks` | 배송이력 조회 |
| POST | `/shipments/:shipment_id/tracks` | 배송이력 추가 |
| PATCH | `/shipments/:shipment_id/tracks/:track_id` | 배송이력 수정 |

### 4.9 예약 (reservations.js — 3개)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/reservations` | 예약 추가 |
| GET | `/reservations/:reservation_id` | 예약 단건 조회 |
| PATCH | `/reservations/:reservation_id` | 예약 수정 |

---

## 5. 인증 및 인가

### 5.1 Google OAuth 인증 흐름 (passport.js)

1. `ADMIN_EMAIL` 매칭 → role: `ADMIN`
2. `stores.email` 매칭 → role: `OWNER` (+ store_id)
3. `customers.email` 매칭 → role: `CUSTOMER` (+ customer_id)
4. 미등록 → 로그인 거부

### 5.2 인가 미들웨어 (auth.js)

| 미들웨어 | 허용 대상 | 용도 |
|----------|-----------|------|
| isAuthorized | 인증된 사용자 또는 x-internal-secret | 일반 라우터 보호 |
| isAdmin | ADMIN 또는 x-internal-secret | POST /stores 등 |
| isOwner | OWNER/ADMIN 또는 x-internal-secret | POST /customers 등 |
| isStoreOwner | 해당 가게 OWNER / ADMIN / x-internal-secret | stores.js 하위 리소스 |
| isCustomerOrOwner | 본인 CUSTOMER / OWNER / ADMIN / x-internal-secret | customers.js |

### 5.3 라우터 보호 구조 (app.js)

```
/auth          → 공개
/chats         → 공개 + Rate Limit (isAuthorized 앞에 등록)
/api-docs      → isAdmin
그 외 전체     → isAuthorized 이후 등록
```

---

## 6. AI 오케스트레이션 (bedrock.js)

LangGraph 상태 머신 기반 파이프라인 (최적화 완료):

```
guardrail + memory (병렬) → supervisor → [API | RAG | Store] → composer → END
                                       → greeting → composer → END (인사)
                                       → escalate → END (상담사 연결)
                                       → unsupported → END (업종 미지원)
```

이전 버전 대비 변경 사항:
- FT(Fine-Tuned) 에이전트 노드 제거
- Verifier 노드 제거 (검증 단계 삭제)
- Guardrail + Memory 노드 병렬 실행 (순차→병렬)
- Guardrail: 표준 티어 + 교차 리전 추론(cross-region inference) 적용
- Escalate 노드 추가 (AI 분석(요약/감정/추천답변) + 상담사 호출)
- Store 노드 추가 (가게 정보 + 예약 현황 + 상품 목록 조회, Bedrock 호출 없음)
- greeting: supervisor에서 인사 감지 → rag 건너뛰고 composer로 직접
- unsupported: supervisor에서 업종 미지원 감지 → 바로 END
- API Agent: 비로그인 시 상황별 login_required 메시지
- SSE 스트리밍: graph.stream()으로 노드별 진행 상황 실시간 전송
- reservation_type: Supervisor가 예약 질문을 inquiry(조회) / action(실제 예약 의사)으로 세분화
  - inquiry → 텍스트로 가능 시간만 안내 (폼/슬롯 미전달)
  - action + 로그인 → `showReservationForm: true` + `availableSlots`
  - action + 비로그인 → `login_required` (가능한 시간 참고 포함)
- store_category: Supervisor에 가게 업종 전달 → 업종별 분류 제약
- Supervisor LLM이 자연어 날짜를 YYYY-MM-DD 형식으로 직접 추출 ({{today}} 변수 주입). 실패 시 extractDateRange 정규식 폴백
- LangGraph 체크포인트 carry-over 방지: 매 턴 `app.stream()` 호출 시 state 필드 명시적 리셋

| 노드 | 역할 | Bedrock 호출 |
|------|------|-------------|
| Guardrail (병렬) | 입력 안전성 검증 (표준 티어, 교차 리전 추론) | Bedrock Guardrail API |
| Memory (병렬) | 최근 5개 메시지 맥락 요약 | invokePrompt |
| Supervisor | 질문 분류 + 코드 후처리 (업종 체크, 인사, 예약, store 보정, reservation_type 판정) | invokePrompt |
| API Agent | 내부 REST API 자동 호출 (최대 2회). 비로그인 시 상황별 login_required | invokePrompt (루프) |
| RAG Agent | pgvector 매뉴얼 검색 + LLM 답변 | invokePrompt |
| Store Agent | GET /stores/:id + 예약 현황 + 상품 목록 + availableSlots 계산. reservation_type(inquiry/action)별 분기 — action+비로그인은 login_required로 조기 종료 | 없음 (내부 API) |
| Escalate | AI 분석(요약/감정/추천답변) + status='대기' | invokePrompt (Case Writer) |
| Composer | 최종 답변 + 추천 질문 3개 | invokePrompt |

**호출 횟수:** 3~4회 (store 시 3회, escalate 시 3회, reservation 시 2회, 약 4~8초)

### 상태 채널

```js
{ userQuery, caseId, storeId, storeCategory, customerId, category, historySummary, intent, sourceData, retrievedContext, finalAnswer, loginMessage, showReservationForm, availableSlots, dateStart, dateEnd, productKeyword, reservationType, reason, retryCount }
```

### Case Writer (종료 시 별도)

상담 종료(`/chats/:case_id/close`) 시 `setImmediate`로 비동기 실행:
- 전체 대화 → LLM 분석 → emotion + summary 추출 → cases 테이블 업데이트

### Solution Analyzer (솔루션 분석)

`GET /stores/:store_id/solutions?hours=24` 호출 시:
- SQL로 카테고리별/감정별 통계 정확히 계산 (코드)
- 통계 + 상담 요약 텍스트를 LLM에 전달 (AI)
- headline + issues + strategies 반환 (환각 방지: 숫자는 코드, 해석만 AI)

---

## 7. 벡터 DB & RAG 파이프라인

### 임베딩 (embeddingService.js)

- **모델**: Amazon Titan Embed Text v2 (1024차원, 정규화)
- **저장**: manuals.embedding 컬럼 (pgvector)
- **자동 생성**: POST/PATCH manuals 시 content → `generateEmbedding()` 호출 → 임베딩 자동 생성
- **일괄 처리**: `node src/scripts/embed-manuals.js`
- **서비스 분리**: `embeddingService.js`가 벡터 생성, `searchService.js`가 검색 전담

### 검색 (searchService.js)

```sql
SELECT content FROM manuals
WHERE store_id = $2
ORDER BY embedding <=> $1 LIMIT 2
```

- 해당 가게 매뉴얼만 필터 (store_id)
- 코사인 유사도 top 2 반환
- **db.js의 공유 pool 사용** (독립 클라이언트 생성 없음)
- 내부적으로 `getQuestionVector()` → `findSimilarContext()` 순서로 실행
- bedrock.js에서 `findSimilarContext`를 직접 import하여 RAG 노드에서 호출

---

## 8. 페이지네이션 (pagination.js)

### 공통 유틸: `parsePagination(query)`

`src/utils/pagination.js`에 정의된 단일 함수로 모든 목록 엔드포인트에서 공유.

```js
// 기본값: page=1, limit=20 / 상한: limit=100
const { page, limit, offset } = parsePagination(req.query);
```

### 목록 응답 형식 (페이지네이션 적용 엔드포인트 공통)

```json
{
  "data": [...],
  "total": 42,
  "page": 1,
  "limit": 20,
  "_links": [...]
}
```

### 페이지네이션 적용 엔드포인트

| 라우터 | 엔드포인트 | 추가 필터 |
|--------|-----------|-----------|
| stores.js | `GET /stores/:id/cases` | — |
| stores.js | `GET /stores/:id/satisfactions` | — |
| stores.js | `GET /stores/:id/orders` | status, start, end (ordered_at 범위) |
| stores.js | `GET /stores/:id/reservations` | status, start, end (reserved_at 범위) |
| stores.js | `GET /stores/:id/manuals` | — |
| stores.js | `GET /stores/:id/products` | — |
| customers.js | `GET /customers/:id/cases` | status, category |
| customers.js | `GET /customers/:id/orders` | status |
| customers.js | `GET /customers/:id/reservations` | status |

---

## 9. 채팅 세션 관리

### 세션 흐름

```
caseId 우선순위: body > session > 신규 생성
종료된 케이스 감지: status가 '종료'/'AI자동해결'이면 새 케이스
비로그인→로그인: customer_id IS NULL인 케이스에 자동 연결
세션 maxAge: 30분 (브라우저 닫거나 비활성 30분 시 만료)
```

### 상담 status 전이

```
상담 (AI 처리 중)
  → AI 해결 가능: 계속 상담
  → AI 해결 불가 / 환불·취소·교환 카테고리: 대기 (상담사 호출)

고객이 close 호출
  → 상담사 개입 없었으면 (대기 없었으면): AI자동해결
  → 상담사 개입 있었으면 (대기였으면): 종료
```

### 상담사 대화

```
상담사: POST /cases/:id/messages { speaker:'상담사' }
고객:   GET /cases/:id/messages (프론트 3초 polling)
```

WebSocket 없이 REST polling으로 동작.

---

## 10. 설계 패턴

| 패턴 | 설명 |
|------|------|
| HATEOAS | 모든 응답에 `_links` 배열 |
| 파라미터화 쿼리 | `$1, $2` 바인딩 → SQL 인젝션 방지 |
| 트랜잭션 | 주문 삭제 시 `BEGIN/COMMIT` (tracks→shipments→items→orders) |
| 비동기 분석 | `setImmediate`로 종료 분석 비차단 |
| Rate Limiting | /chats 분당 10회 제한 (express-rate-limit) |
| 중앙 에러 핸들러 | app.js 하단에 통합 에러 미들웨어 (`(err, req, res, next)`) |
| 공유 pool | db.js에서 단일 커넥션 풀 export → 모든 라우터/서비스에서 재사용 |
| 공통 페이지네이션 | `parsePagination` 유틸로 page/limit/offset 일관 처리 |
| 소유권 검증 | isStoreOwner — OWNER가 자기 가게만 접근 |
| 세션 기반 채팅 | express-session 쿠키로 caseId 유지 (비로그인 포함) |
| AI 환각 방지 | 솔루션 분석 시 숫자는 SQL, 해석만 AI |
| 서비스 분리 | 임베딩(embeddingService) / 검색(searchService) 역할 분리 |

---

## 11. 환경 변수 (.env)

| 변수 | 용도 |
|------|------|
| BEDROCK_API_KEY | Bedrock API 인증 키 |
| AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY | AWS 자격증명 |
| AWS_REGION | AWS 리전 (ap-northeast-2) |
| BEDROCK_GUARDRAIL_ARN | 입력 검증 가드레일 (표준티어, 교차추론) |
| BEDROCK_MEMORY_LOADER_ARN | 대화 맥락 요약 프롬프트 |
| BEDROCK_SUPERVISOR_ARN | 질문 분류 프롬프트 (api/rag/store/escalate) + 코드 후처리 (greeting/unsupported) |
| BEDROCK_API_ARN | API 에이전트 프롬프트 |
| BEDROCK_RAG_ARN | RAG 에이전트 프롬프트 |
| BEDROCK_COMPOSER_ARN | 최종 답변 생성 프롬프트 |
| BEDROCK_CASE_WRITER_ARN | 종료 시 감정/요약 분석 프롬프트 |
| BEDROCK_SOLUTION_ANALYZER_ARN | 솔루션 분석 프롬프트 |
| INTERNAL_SECRET_KEY | AI→API 내부 호출 인증 키 |
| DB_HOST / DB_PORT / DB_USER / DB_PASS / DB_NAME | PostgreSQL 연결 |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | Google OAuth |
| SESSION_SECRET | express-session 암호화 키 |
| ADMIN_EMAIL | 관리자 이메일 |
| ROOT_URL | 서버 기본 URL |
