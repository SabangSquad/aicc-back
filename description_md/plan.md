# AICC-Back 구현 계획서

> 기준: api_doc.md + db_table.md
> 작성일: 2026-03-25

---

## 구현 현황

### 완료

| 항목 | 설명 |
|------|------|
| 인증 시스템 개편 | passport.js (ADMIN/OWNER/CUSTOMER), auth.js (isOwner, isCustomerOrOwner) |
| 기존 라우터 수정 | cases.js, orders.js, chat.js, customers.js, manuals.js, products.js |
| 신규 라우터 추가 | stores.js (12개), shipments.js (6개), reservations.js (3개) |
| status 상수화 | caseStatus.js (대기/상담/종료/AI자동해결) |
| app.js 라우터 등록 | agents/order_items 제거, /chats 비로그인 허용, 신규 라우터 등록 |
| 종료 에이전트 | cases.js PATCH status→종료 시 setImmediate 비동기 AI 분석 |
| Swagger 갱신 | chat.js /chats 경로, summary, store_id, close 엔드포인트 반영 |
| 채팅 세션 관리 | 세션 기반 caseId 유지, 종료/AI자동해결 감지, 비로그인→로그인 customer_id 연결 |
| emotion 유효성 검증 | cases.js PATCH에서 평온/기쁨/슬픔/화남/짜증만 허용 |
| api_doc.md 반영 | POST /chats/{case_id}/close 엔드포인트 추가 |

### 미완료

| 우선순위 | 항목 | 설명 |
|----------|------|------|
| P0 | DB 스키마 마이그레이션 | 신규 테이블 생성 + 기존 테이블 변경 |
| P0 | 레거시 파일 삭제 | agents.js, order_items.js, assignAgent.js |
| P0 | bedrock.js API 에이전트 갱신 | memo→summary, 변경된 경로 반영 |
| P1 | searchService.js manuals 전환 | aicc_knowledge → manuals 기반 벡터 검색 |
| P1 | store 컨텍스트 AI 전달 | processAICC에 storeId 전달, 가게별 매뉴얼 검색 |
| P1 | store 소유권 검증 | OWNER가 자기 가게만 접근하도록 store_id 검증 |
| P2 | 임베딩 파이프라인 | manuals 기반 벡터 재구축 (aicc_knowledge 대체) |
| P2 | 상담사 에스컬레이션 | AI 미해결 시 상담사(OWNER) 전환 메커니즘 |
| P2 | 상담 자동 카테고리 분류 | 첫 메시지 분석으로 cases.category 자동 설정 |
| P3 | 꼬리 질문 + 맥락 유지 | bedrock.js closer 노드, 이전 케이스 요약 전달 |

---

## 1. DB 스키마 마이그레이션 (P0)

### 1-1. 신규 테이블 생성

```sql
-- stores (가게)
CREATE TABLE stores (
  store_id       SERIAL PRIMARY KEY,
  name           VARCHAR(100) NOT NULL,
  category       VARCHAR(50)  NOT NULL CHECK (category IN ('병원', '식당', '이커머스')),
  phone          VARCHAR(20)  NOT NULL,
  email          VARCHAR(100) NOT NULL UNIQUE,
  address        VARCHAR(255) NOT NULL,
  business_hours JSON,
  parking        BOOLEAN,
  facilities     JSON,
  notice         TEXT,
  store_items    JSON
);

-- satisfactions (만족도)
CREATE TABLE satisfactions (
  satisfaction_id SERIAL PRIMARY KEY,
  case_id         INTEGER   NOT NULL REFERENCES cases(case_id),
  store_id        INTEGER   NOT NULL REFERENCES stores(store_id),
  score           INTEGER   NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment         TEXT,
  collected_at    TIMESTAMP DEFAULT NOW()
);

-- manuals (규정)
CREATE TABLE manuals (
  manual_id  SERIAL PRIMARY KEY,
  store_id   INTEGER      NOT NULL REFERENCES stores(store_id),
  title      VARCHAR(200) NOT NULL,
  category   VARCHAR(50)  NOT NULL,
  content    TEXT         NOT NULL,
  edited_at  TIMESTAMP    DEFAULT NOW(),
  file_url   TEXT,
  file_hash  VARCHAR(64)  NOT NULL,
  embedding  vector(1024)
);

-- shipments (배송)
CREATE TABLE shipments (
  shipment_id  SERIAL PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(order_id),
  store_id     INTEGER NOT NULL REFERENCES stores(store_id),
  tracking_no  VARCHAR(50),
  carrier      VARCHAR(50),
  requirement  TEXT,
  promised_at  TIMESTAMP,
  delivered_at TIMESTAMP
);

-- tracks (배송이력)
CREATE TABLE tracks (
  track_id     SERIAL PRIMARY KEY,
  shipment_id  INTEGER      NOT NULL REFERENCES shipments(shipment_id),
  event_at     TIMESTAMP    NOT NULL,
  event_type   VARCHAR(50)  NOT NULL
    CHECK (event_type IN ('집하처리', '간선상차', '간선하차', '배송출고', '배송완료')),
  location     VARCHAR(100) NOT NULL
);

-- reservations (예약)
CREATE TABLE reservations (
  reservation_id SERIAL PRIMARY KEY,
  store_id       INTEGER     NOT NULL REFERENCES stores(store_id),
  customer_id    INTEGER     NOT NULL REFERENCES customers(customer_id),
  reserved_at    TIMESTAMP   NOT NULL,
  status         VARCHAR(20) NOT NULL CHECK (status IN ('완료', '취소')),
  headcount      INTEGER,
  requirement    TEXT
);
```

### 1-2. 기존 테이블 변경

```sql
-- cases: 컬럼 추가/변경
ALTER TABLE cases
  ADD COLUMN store_id    INTEGER REFERENCES stores(store_id),
  ADD COLUMN ref_id      INTEGER,
  ADD COLUMN ref_type    VARCHAR(20),
  ADD COLUMN title       VARCHAR(255),
  ADD COLUMN content     TEXT,
  ADD COLUMN summary     TEXT;

-- memo → summary 이전 후 삭제
UPDATE cases SET summary = memo;
ALTER TABLE cases DROP COLUMN memo;

-- agent_id 제거
ALTER TABLE cases DROP COLUMN agent_id;

-- customers: store_id, birthdate 추가
ALTER TABLE customers
  ADD COLUMN store_id  INTEGER REFERENCES stores(store_id),
  ADD COLUMN birthdate DATE;

-- orders: store_id, requirement 추가
ALTER TABLE orders
  ADD COLUMN store_id    INTEGER REFERENCES stores(store_id),
  ADD COLUMN requirement TEXT;

-- messages: speaker 값 변경
UPDATE messages SET speaker = '상담사' WHERE speaker = 'agent';
UPDATE messages SET speaker = '챗봇'   WHERE speaker = 'chatbot';
UPDATE messages SET speaker = '고객'   WHERE speaker = 'customer';

-- order_items → items 이름 변경
ALTER TABLE order_items RENAME TO items;
ALTER TABLE items RENAME COLUMN order_item_id TO item_id;
ALTER TABLE items RENAME COLUMN price TO total_price;

-- products: store_id 추가
ALTER TABLE products
  ADD COLUMN store_id INTEGER REFERENCES stores(store_id);
```

### 1-3. 실행 순서

1. stores 생성 (다른 테이블이 FK 참조)
2. 기존 테이블 ALTER (cases, customers, orders, products, items)
3. 나머지 신규 테이블 생성 (satisfactions, manuals, shipments, tracks, reservations)
4. 데이터 마이그레이션 (memo→summary, speaker 값, order_items→items)

---

## 2. 레거시 파일 삭제 (P0)

| 파일 | 이유 |
|------|------|
| `src/routes/agents.js` | agents 테이블 제거, app.js에서 미등록 |
| `src/routes/order_items.js` | orders.js로 통합, app.js에서 미등록 |
| `src/utils/assignAgent.js` | agents 배정 로직 제거 |

---

## 3. bedrock.js API 에이전트 갱신 (P0)

### 문제

현재 bedrock.js의 API 에이전트가 옛 스키마/경로를 기준으로 동작한다.

| 현재 코드 (bedrock.js) | 문제 |
|------------------------|------|
| line 206: `callInfo.r === 'cases'`일 때 `memo`, `content` 필터링 | `memo`는 `summary`로 변경됨 |
| API agent가 호출하는 경로 | `/order-items` → `/orders/:id/items`, `/chat` → `/chats` 등 전면 변경 |
| searchService.js `aicc_knowledge` 테이블의 `api` 카테고리 | API 문서가 변경된 엔드포인트를 반영하지 않음 |

### 변경 사항

#### 3-1. cases 필드 필터링 수정

```js
// Before (bedrock.js line 206-211)
if (callInfo.r === 'cases' || callInfo.r === 'case') {
  const { memo, content, ...rest } = res.data;
  filteredData = { ...rest, _note: "...", past_memo_summary: memo?.substring(0, 20) + "..." };
}

// After
if (callInfo.r === 'cases' || callInfo.r === 'case') {
  const { summary, content, ...rest } = res.data;
  filteredData = { ...rest, _note: "summary/content는 과거 상담 요약입니다. 무시하고 ref_id를 추출하세요." };
}
```

#### 3-2. API 지식 베이스 갱신

`api` 카테고리의 벡터 데이터를 현재 api_doc.md 기준으로 재생성해야 한다.
주요 변경된 경로:

| Before | After |
|--------|-------|
| `/order-items/:id` | `/orders/:order_id/items/:item_id` |
| `/chat` | `/chats` |
| `/agents/:id` | 제거 |
| `/customers/:id/orders` (POST) | `/orders` (POST) |
| `/products` (GET 목록, POST) | `/stores/:store_id/products` |
| `/manuals` (GET 목록, POST, PATCH) | `/stores/:store_id/manuals`, `/manuals/:id` |
| 없음 | `/stores`, `/shipments`, `/reservations` 신규 |

---

## 4. searchService.js manuals 전환 (P1)

### 문제

현재 `searchService.js`가 `aicc_knowledge` 테이블을 직접 조회한다.

### 변경 사항

```js
// Before
const sql = `
  SELECT content FROM aicc_knowledge
  WHERE category = $2 ORDER BY embedding <=> $1 LIMIT 2
`;

// After — manuals 테이블 + store_id 필터 추가
const sql = `
  SELECT content FROM manuals
  WHERE store_id = $3 AND category = $2
  ORDER BY embedding <=> $1 LIMIT 2
`;
```

manuals 테이블에 `embedding` 벡터 컬럼 추가 필요:

```sql
ALTER TABLE manuals ADD COLUMN embedding vector(1024);
```

`findSimilarContext` 시그니처 변경:

```js
// Before
export async function findSimilarContext(query, category)

// After — store_id 추가
export async function findSimilarContext(query, category, storeId)
```

---

## 5. store 컨텍스트 AI 전달 (P1)

### 문제

현재 AI는 어떤 가게의 상담인지 모른다. 가게마다 매뉴얼/상품/정책이 다르므로, AI가 올바른 정보를 참조하려면 store_id를 알아야 한다.

### 변경 사항

#### 5-1. chat.js — store_id를 processAICC에 전달

```js
// Before
const result = await processAICC(message, caseId);

// After
const result = await processAICC(message, caseId, storeId);
```

#### 5-2. bedrock.js — store_id를 그래프 상태에 추가

```js
const graphState = {
  channels: {
    userQuery: null,
    caseId: null,
    storeId: null,     // 추가
    // ...
  }
};
```

#### 5-3. RAG/API 노드에서 store_id 활용

- **RAG**: `findSimilarContext(query, 'policy', state.storeId)` — 해당 가게 매뉴얼만 검색
- **API**: 내부 API 호출 시 store_id 기반 경로 자동 구성

---

## 6. store 소유권 검증 (P1)

### 문제

현재 `isOwner` 미들웨어는 "OWNER 역할인가?"만 확인한다. OWNER A가 가게 B의 데이터에 접근하는 것을 막지 못한다.

### 변경 사항

```js
// src/middlewares/auth.js — isStoreOwner 추가
export const isStoreOwner = (req, res, next) => {
  const secret = req.headers['x-internal-secret'];
  if (secret === process.env.INTERNAL_SECRET_KEY) return next();
  if (req.isAuthenticated() && req.user?.role === 'ADMIN') return next();

  if (req.isAuthenticated() && req.user?.role === 'OWNER') {
    const storeId = Number(req.params.store_id);
    if (req.user.store_id === storeId) return next();
  }

  res.status(403).json({ message: '해당 가게의 오너만 접근 가능합니다.' });
};
```

적용 대상 (stores.js):
- `PATCH /stores/:store_id`
- `GET /stores/:store_id/cases`
- `GET /stores/:store_id/satisfactions`
- `GET /stores/:store_id/orders`
- `GET /stores/:store_id/reservations`
- `POST /stores/:store_id/manuals`
- `PATCH /stores/:store_id/manuals/:manual_id`
- `POST /stores/:store_id/products`

---

## 7. 임베딩 파이프라인 (P2)

### 목표
- `aicc_knowledge` 테이블 → `manuals` 테이블 기반 벡터 검색으로 전환
- `file_hash`로 변경 감지 → 재임베딩 최소화

### 신규 파일

```
src/
  services/
    embeddingService.js   # Bedrock Titan 1024차원 벡터 생성
    manualService.js      # manuals 테이블 upsert (file_hash 비교)
  scripts/
    embed-local.js        # 로컬 MD → manuals DB
    migrate-s3.js         # S3 → manuals DB (migration.js 대체)
```

### manualService.js 핵심 로직

```js
export async function upsertManual({ storeId, title, category, content, fileUrl }) {
  const fileHash = crypto.createHash('sha256').update(content).digest('hex');

  const existing = await pool.query(
    'SELECT file_hash FROM manuals WHERE store_id = $1 AND title = $2',
    [storeId, title]
  );
  if (existing.rows[0]?.file_hash === fileHash) return null; // 변경 없음 → 스킵

  return pool.query(
    `INSERT INTO manuals (store_id, title, category, content, file_url, file_hash, edited_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (store_id, title)
     DO UPDATE SET content = EXCLUDED.content, file_hash = EXCLUDED.file_hash, edited_at = NOW()
     RETURNING manual_id`,
    [storeId, title, category, content, fileUrl ?? null, fileHash]
  );
}
```

### DB 제약 추가

```sql
ALTER TABLE manuals ADD CONSTRAINT manuals_store_title_unique UNIQUE (store_id, title);
```

---

## 8. 상담사 에스컬레이션 (P2)

### 문제

AI가 해결하지 못하는 케이스를 상담사(OWNER)에게 넘기는 메커니즘이 없다.

### 접근 방식

AI가 해결 불가 판단 시 → status를 `'대기'`로 변경하고 `summary`에 AI 분석 결과를 남긴다.
(별도 status 추가 없이 기존 흐름 활용)

```js
// bedrock.js verifier 노드에서 "ESCALATE" 상태 반환 시
if (status === "ESCALATE") {
  await pool.query(
    `UPDATE cases SET status = '대기', summary = $1 WHERE case_id = $2`,
    [`[AI 에스컬레이션] ${state.sourceData}`, state.caseId]
  );
  return { finalAnswer: '상담사에게 연결해 드리겠습니다. 잠시만 기다려 주세요.' };
}
```

---

## 9. 상담 자동 카테고리 분류 (P2)

### 문제

cases.category가 수동 입력이라 빈 경우가 많다. 첫 메시지로 자동 분류하면 통계/필터링에 유용하다.

### 접근 방식

chat.js에서 케이스 최초 생성 시 Supervisor 노드의 분류 결과를 활용:

```js
// chat.js — 케이스 생성 직후, AI 응답 후
if (isNewCase && result.detectedCategory) {
  await pool.query(
    'UPDATE cases SET category = $1 WHERE case_id = $2',
    [result.detectedCategory, caseId]
  );
}
```

bedrock.js Supervisor 프롬프트에 카테고리 분류 지시 추가:
- 출력에 `category` 필드 포함 (취소, 교환, 반품, 배송일정, 상품문의 등)

---

## 10. 꼬리 질문과 맥락 유지 (P3)

### 10-1. bedrock.js — Supervisor에 close intent 추가

```js
workflow.addConditionalEdges("supervisor", (state) => state.intent, {
  api: "api", rag: "rag", ft: "ft", close: "closer",
});
```

### 10-2. closer 노드 — 종료 확인 질문

```js
const closerNode = async (state) => {
  if (!state.closingConfirmed) {
    return {
      ...state,
      finalAnswer: '상담을 종료할까요? 더 궁금하신 점이 있으시면 말씀해 주세요.',
      closingPending: true,
    };
  }
  // 실제 종료 + 분석
};
```

### 10-3. 이전 케이스 요약 전달

```js
const { rows: prevCase } = await pool.query(
  `SELECT summary FROM cases
   WHERE customer_id = (SELECT customer_id FROM cases WHERE case_id = $1)
     AND case_id != $1 AND closed_at IS NOT NULL
   ORDER BY closed_at DESC LIMIT 1`,
  [state.caseId]
);
// 프롬프트에 previous_case_summary 추가
```

---

## 전체 파일 현황

### 수정 완료

| 파일 | 변경 내용 |
|------|-----------|
| src/app.js | 라우터 등록 구조 변경 |
| src/config/passport.js | ADMIN/OWNER/CUSTOMER 인증 |
| src/middlewares/auth.js | isOwner, isCustomerOrOwner 추가 |
| src/constants/caseStatus.js | 상담 상태 상수 (신규) |
| src/routes/stores.js | 가게 12개 엔드포인트 (신규) |
| src/routes/cases.js | summary, category, satisfactions, messages, 종료 에이전트, emotion 검증 |
| src/routes/customers.js | isCustomerOrOwner, reservations, POST /customers |
| src/routes/orders.js | items 통합, POST /orders, shipments 조회, 캐스케이드 삭제 |
| src/routes/chat.js | 세션 관리, close 엔드포인트, 비로그인→로그인 연결, Swagger |
| src/routes/manuals.js | GET /:manual_id 단건만 |
| src/routes/products.js | GET/PATCH /:product_id만 |
| src/routes/shipments.js | 배송 6개 엔드포인트 (신규) |
| src/routes/reservations.js | 예약 3개 엔드포인트 (신규) |

### 삭제 예정

| 파일 | 이유 |
|------|------|
| src/routes/agents.js | agents 제거 |
| src/routes/order_items.js | orders.js 통합 |
| src/utils/assignAgent.js | agents 제거 |

### 미변경 (추후 작업)

| 파일 | 예정 작업 | 우선순위 |
|------|-----------|----------|
| src/bedrock.js | API 에이전트 경로/스키마 갱신, store_id 전달, 에스컬레이션, closer 노드 | P0/P1/P2/P3 |
| src/services/searchService.js | aicc_knowledge → manuals 벡터 검색 전환 | P1 |
| src/middlewares/auth.js | isStoreOwner 미들웨어 추가 | P1 |
| src/routes/stores.js | isStoreOwner 적용 | P1 |
| src/routes/chat.js | store_id → processAICC 전달, 자동 카테고리 분류 | P1/P2 |
| src/migration.js | scripts/migrate-s3.js로 대체 | P2 |
