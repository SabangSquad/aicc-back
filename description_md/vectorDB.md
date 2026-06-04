# 벡터 DB & RAG 파이프라인 정리

## 개요

가게별 정책/규정 문서(manuals)를 벡터로 변환하여 PostgreSQL(pgvector)에 저장하고, 고객 질문이 들어오면 유사도 검색으로 관련 문서를 찾아 AI 답변에 활용한다.

---

## 아키텍처

```
[매뉴얼 저장 / 수정 / 삭제]
POST   /stores/:store_id/manuals             { title, category, content }
PATCH  /stores/:store_id/manuals/:manual_id  (content 변경 시 임베딩 재생성)
DELETE /stores/:store_id/manuals/:manual_id  (isStoreOwner)
  ↓
src/routes/stores.js
  ├─ content → src/services/embeddingService.js generateEmbedding()
  │            → Bedrock Titan Embed v2 → 1024차원 벡터 생성
  └─ INSERT / UPDATE / DELETE manuals → pgvector

[RAG 검색 — 고객 질문 시 두 경로]

A) ragNode (정책 단독 질문)
POST /chats { message, store_id }
  → supervisorNode → intent='rag' → ragNode
  → retrieveKB(query, storeId)              # categoryHint 없음
  → findSimilarContext(query, storeId, null)
    SELECT content FROM manuals
    WHERE store_id = $2
    ORDER BY embedding <=> $1 LIMIT 2
  → 유사도 top 2 매뉴얼 → ragAgent 프롬프트

B) apiNode (본인 데이터 + 정책 결합 질문) — "주문 320 환불 가능?" 류
  → supervisorNode → intent='api' (명시 ID + 정책 질문 강제 룰)
  → apiNode가 본인 주문/예약/cases prefetch
  → 정책 질문 감지 (환불/취소/교환/변경 + 가능 여부)
    └─ categoryHint 매핑:
        병원/식당: 예약변경 / 예약취소 / 예약확인
        이커머스: 환불 / 교환 / 취소 (반품→환불)
  → retrieveKB(query, storeId, categoryHint)
  → findSimilarContext(query, storeId, categoryHint)
    categoryHint 있음: 카테고리 우선 정렬 + LIMIT 1
    categoryHint 없음: 임베딩 거리만으로 LIMIT 2
  → 결과를 [참고 매뉴얼] 라벨로 sourceData 맨 앞에 prepend
    (composer source_data truncate가 앞 보존이라 매뉴얼 우선 살림)
  → 매뉴얼 0건 + categoryHint 있음 → [참고 매뉴얼 안내]: 이 매장에
    [{categoryHint}] 정책 매뉴얼이 등록되어 있지 않습니다... 명시 추가
  → composer가 본인 상태 × 매뉴얼 조건 결합해서 가능/불가 단정

  ↓
src/bedrock.js composerNode → 본인 데이터 + 매뉴얼 결합 답변
```

---

## 벡터(임베딩)란?

텍스트를 **1024개의 숫자 배열**로 변환한 것이다. 의미가 비슷한 텍스트는 숫자 배열도 비슷해진다.

```
"환불 규정 알려주세요" → [0.012, -0.034, 0.078, ..., 0.045]  (1024개)
"반품 절차가 궁금해요" → [0.011, -0.031, 0.082, ..., 0.042]  (1024개) ← 비슷!
"오늘 날씨 어때?"     → [0.891, 0.234, -0.567, ..., 0.123]  (1024개) ← 전혀 다름
```

이 숫자 배열(벡터)을 DB에 저장해두고, 고객 질문도 벡터로 바꿔서 **가장 가까운 벡터를 찾으면** = 가장 관련 있는 매뉴얼을 찾는 것이다.

---

## 벡터 생성

### 임베딩 모델

- **Amazon Titan Embed Text v2** (`amazon.titan-embed-text-v2:0`)
- 차원: **1024** (숫자 1024개짜리 배열)
- 정규화: true (벡터 길이를 1로 맞춤 → 코사인 유사도 계산에 최적)

### 변환 과정

```
"에브리샵 환불 규정. 환불은 7일 이내..."
  ↓
AWS Bedrock Titan API 호출
  ↓
[0.012, -0.034, 0.078, ..., 0.045]  (float 1024개)
  ↓
manuals 테이블의 embedding 컬럼에 저장
```

### 파일: src/services/embeddingService.js

```js
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

export async function generateEmbedding(text) {
  const command = new InvokeModelCommand({
    modelId: "amazon.titan-embed-text-v2:0",
    body: JSON.stringify({ inputText: text, dimensions: 1024, normalize: true }),
  });
  const res = await client.send(command);
  return JSON.parse(new TextDecoder().decode(res.body)).embedding;
}
```

---

## 벡터 저장

### DB 테이블: manuals

```sql
embedding vector(1024)  -- pgvector 확장 사용
```

### 저장 시점

| 시점 | 파일 | 동작 |
|------|------|------|
| 매뉴얼 생성 | stores.js `POST /stores/:store_id/manuals` | content → 임베딩 → INSERT |
| 매뉴얼 수정 | stores.js `PATCH /stores/:store_id/manuals/:manual_id` | content 변경 시 → 임베딩 재생성 → UPDATE |
| 매뉴얼 삭제 | stores.js `DELETE /stores/:store_id/manuals/:manual_id` | isStoreOwner — DELETE FROM manuals |
| 기존 데이터 일괄 | src/scripts/embed-manuals.js | embedding IS NULL인 행 전부 벡터화 |

---

## 벡터 검색 (RAG)

### 파일: src/services/searchService.js

```js
// categoryHint: 정책 키워드 기반 카테고리 우선 정렬 (예: "예약변경", "환불", "교환")
export async function findSimilarContext(query, storeId, categoryHint = null) {
  const vector = await generateEmbedding(query);

  const sql = categoryHint
    ? `
      SELECT manual_id, title, category, content, embedding <=> $1 AS distance
      FROM manuals
      WHERE store_id = $2
      ORDER BY
        CASE WHEN category = $3 THEN 0 ELSE 1 END,  -- 일치하는 카테고리 우선
        embedding <=> $1                             -- 그 다음 임베딩 거리
      LIMIT 1
    `
    : `
      SELECT manual_id, title, category, content, embedding <=> $1 AS distance
      FROM manuals
      WHERE store_id = $2
      ORDER BY embedding <=> $1 LIMIT 2
    `;

  const res = await client.query(sql, categoryHint ? [toSql(vector), storeId, categoryHint] : [toSql(vector), storeId]);

  const context = res.rows.map(r => r.content).join('\n\n');
  const sources = res.rows.map(r => ({
    type: 'manual',
    manualId: r.manual_id,
    title: r.title,
    category: r.category,
    distance: parseFloat(r.distance),
    score: Number((1 - parseFloat(r.distance)).toFixed(3)),  // 0~1, 1에 가까울수록 유사
    excerpt: typeof r.content === 'string' ? r.content.slice(0, 120) : '',
  }));
  return { context, sources };
}
```

### 검색 방식

- **필터**: `store_id` — 해당 가게의 매뉴얼만 검색 (다른 가게 정보 혼입 방지)
- **정렬**: `embedding <=> $1` — pgvector의 코사인 거리 연산자 (값이 작을수록 유사)
- **categoryHint 있을 때**: 카테고리 일치 매뉴얼 1건 우선, 없으면 임베딩 거리 best 1건 (LIMIT 1)
- **categoryHint 없을 때**: 임베딩 거리 top 2 (모호성 보험, LIMIT 2)
- 반환 구조: `{ context: string, sources: [{ manualId, title, category, distance, score, excerpt }] }`
  → sources는 응답의 `explanation.sources`에 그대로 노출 (RAG 근거 투명성)

### 검색이 어떻게 작동하는가 (구체적 예시)

```
[DB에 저장된 매뉴얼 벡터들 — store_id=1]
manual_id=1  "주문확인 규정"    → 벡터 A [0.5, 0.1, ...]
manual_id=2  "배송조회 규정"    → 벡터 B [0.3, 0.7, ...]
manual_id=3  "환불 규정"        → 벡터 C [0.01, -0.03, ...]
manual_id=4  "교환 규정"        → 벡터 D [0.02, -0.02, ...]

[고객 질문]
"환불하고 싶은데 어떻게 하나요?" → 벡터 Q [0.01, -0.04, ...]

[코사인 거리 계산]
벡터 Q ↔ 벡터 A: 0.89 (멀다 = 관련 없음)
벡터 Q ↔ 벡터 B: 0.85 (멀다)
벡터 Q ↔ 벡터 C: 0.05 (가깝다 = 관련 있음!) ← 1등
벡터 Q ↔ 벡터 D: 0.12 (꽤 가깝다)           ← 2등

[결과]
→ "환불 규정" content + "교환 규정" content 반환
```

`<=>` 연산자가 이 거리 계산을 해주고, `ORDER BY ... LIMIT 2`로 가장 가까운 2개를 가져온다.

---

## AI가 벡터 검색 결과를 어떻게 사용하는가

### 전체 흐름 (RAG)

```
고객: "환불 규정 알려주세요"
  ↓
[1단계] src/routes/chat.js → src/bedrock.js processAICC("환불 규정 알려주세요", caseId=42, storeId=1)
  ↓
[2단계] src/bedrock.js supervisorNode
  → "환불 규정" = 정책 질문 → intent = "rag"
  ↓
[3단계] src/bedrock.js ragNode 실행
  → src/bedrock.js retrieveKB("환불 규정 알려주세요", 1)
  → src/services/searchService.js findSimilarContext()
    → src/services/searchService.js getQuestionVector() → Titan API → 벡터 Q
    → SQL: SELECT content FROM manuals WHERE store_id=1 ORDER BY embedding <=> Q LIMIT 2
    → 결과: "# 에브리샵 환불 규정\n환불은 7일 이내..." + "# 에브리샵 교환 규정\n..."
  ↓
[4단계] src/bedrock.js ragNode → invokePrompt("ragAgent", {...})
  invokePrompt("ragAgent", {
    user_query: "환불 규정 알려주세요",
    retrieved_context: "# 에브리샵 환불 규정\n환불은 7일 이내...",  ← 벡터 검색 결과
    history: "..." // 일반 정책 질문이면 비움 (본인 데이터 섞임 방지)
  })

  ragAgent 프롬프트 핵심:
  - [규정]에 없는 수치/기간/날짜/조건/절차 만들거나 추측 금지
  - 정책 답변 시 핵심 조건 빠짐없이 인용:
    · 시점/마감 (예: "전날 오후 6시까지")
    · 비용/수수료 (예: "30% 수수료 부과")
    · 예외/면제 조건
    · 접수 방법/절차
  - [규정] 부족 시 정확히 다음만 출력:
    "이 매장에 해당 정책이 등록되어 있지 않습니다. 매장 사장님께 직접 문의해 주세요."
    (구버전 "고객센터로 문의"는 이 챗봇 자체가 매장 상담창이라 모순 → 매장 사장 문의로 변경)
  ↓
  vLLM Qwen3-8B-AWQ가 매뉴얼을 읽고 답변 생성
  ↓
[5단계] src/bedrock.js composerNode → 최종 답변 구성 + post-process
  - "고객센터로 문의" / "콜센터 문의" / "고객센터에서 안내" → "매장 사장님께 문의" 강제 치환
  ↓
고객에게 반환:
{
  answer: "환불은 상품 수령 후 7일 이내 신청 가능하며, 미개봉·미사용 상태여야 합니다.
           고객 변심 시 왕복 배송비 6,000원이 차감됩니다.",
  explanation: {
    answerType: "manual_rag",
    sources: [{ manualId: 3, title: "환불 규정", category: "환불", score: 0.95 }]
  }
}
```

### 본인 데이터 + 정책 결합 답변 (apiNode 경로)

"주문 320 환불 가능?" 류 질문은 supervisor가 api로 라우팅 (명시 ID + 정책 질문).

```
apiNode
  ├─ cases/orders/customers prefetch → 주문 320 상태 "준비"
  └─ 정책 질문 감지 → retrieveKB(q, storeId, '환불')
       └─ "# 에브리샵 환불 규정\n환불은 수령 후 7일 이내..."

accumulatedContext (composer에 전달):
  [참고 매뉴얼]: # 에브리샵 환불 규정 ...           ← 앞에 prepend
  [참고 데이터 0회차]: 주문 320 (상태: 준비, ...)

composer 룰 5 (결합 판단):
  · 본인 상태 = "준비" (발송 전)
  · 매뉴얼 = "발송 전 전액 환불"
  → "주문 320은 '준비' 상태(발송 전)라 매장 정책상 환불 가능합니다.
     마이페이지에서 환불 신청 진행해 주세요."
```

매뉴얼 0건일 때:
```
[참고 매뉴얼 안내]: 이 매장에 [환불] 정책 매뉴얼이 등록되어 있지 않습니다.
사장님께 직접 문의가 필요한 사안임을 사용자에게 친절히 안내하세요.

→ composer: "주문 320은 '준비' 상태입니다. 이 매장에 환불 정책이
   등록되어 있지 않아 정확한 답변이 어렵습니다. 매장 사장님께 직접 문의해 주세요."
```

### 핵심 포인트

1. **AI는 매뉴얼 전체를 외우고 있지 않다** — 매번 질문이 올 때마다 벡터 검색으로 관련된 것만 찾는다
2. **찾은 매뉴얼 텍스트를 프롬프트에 넣어서** AI에게 "이걸 읽고 답해"라고 시키는 것이 RAG의 본질
3. **가게별로 다른 매뉴얼**을 갖고 있으므로 store_id로 필터 → 다른 가게 규정이 섞이지 않음

### API 에이전트에서도 활용

API 에이전트도 `retrieveKB`를 호출하지만 용도가 다르다:
- RAG: 매뉴얼 content를 고객에게 답변으로 활용
- API: 매뉴얼에서 참고할 정보를 찾아 내부 API 호출 판단에 활용

---

## 일괄 임베딩 스크립트

### 파일: src/scripts/embed-manuals.js

```bash
node src/scripts/embed-manuals.js
```

- manuals 테이블에서 `embedding IS NULL`인 행을 조회
- 각 content를 Bedrock Titan으로 벡터화
- embedding 컬럼 업데이트
- 진행 상황 출력: `[1/1193] manual_id=1 "주문확인 규정" 완료`

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/services/embeddingService.js` | Bedrock Titan 임베딩 생성 |
| `src/services/searchService.js` | pgvector 유사도 검색 (findSimilarContext) |
| `src/routes/stores.js` | 매뉴얼 POST/PATCH 시 임베딩 자동 생성 |
| `src/scripts/embed-manuals.js` | 기존 데이터 일괄 임베딩 |
| `src/bedrock.js` | ragNode에서 retrieveKB 호출 |

---

## 필요 인프라

| 항목 | 설명 |
|------|------|
| PostgreSQL + pgvector | `CREATE EXTENSION IF NOT EXISTS vector;` |
| manuals.embedding | `ALTER TABLE manuals ADD COLUMN embedding vector(1024);` |
| AWS Bedrock | Titan Embed Text v2 모델 접근 권한 |
| .env | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
