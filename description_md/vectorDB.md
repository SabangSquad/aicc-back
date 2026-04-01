# 벡터 DB & RAG 파이프라인 정리

## 개요

가게별 정책/규정 문서(manuals)를 벡터로 변환하여 PostgreSQL(pgvector)에 저장하고, 고객 질문이 들어오면 유사도 검색으로 관련 문서를 찾아 AI 답변에 활용한다.

---

## 아키텍처

```
[매뉴얼 저장]
POST /stores/:store_id/manuals { title, category, content }
  ↓
src/routes/stores.js POST "/:store_id/manuals"
  ├─ content → src/services/embeddingService.js generateEmbedding()
  │            → Bedrock Titan Embed v2 → 1024차원 벡터 생성
  └─ INSERT INTO manuals (..., embedding) → pgvector에 저장

[RAG 검색 — 고객 질문 시]
POST /chats { message, store_id }
  ↓
src/routes/chat.js → processAICC()
  ↓
src/bedrock.js → supervisorNode → intent='rag' → ragNode
  ↓
src/bedrock.js retrieveKB(query, storeId)
  ↓
src/services/searchService.js → findSimilarContext(query, storeId)
  ├─ 고객 질문 → src/services/searchService.js getQuestionVector()
  │              → Bedrock Titan → 1024차원 벡터 변환
  └─ SELECT content FROM manuals
     WHERE store_id = $2
     ORDER BY embedding <=> $1 LIMIT 2
  ↓
유사도 top 2 매뉴얼 content 반환
  ↓
src/bedrock.js ragNode → invokePrompt(BEDROCK_RAG_ARN, { user_query, retrieved_context })
RAG 프롬프트: "다음 규정을 참고하여 답변하세요: {context}"
  ↓
src/bedrock.js composerNode → 최종 답변 + 추천 질문 생성
  ↓
AI 답변 생성
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
| 기존 데이터 일괄 | src/scripts/embed-manuals.js | embedding IS NULL인 행 전부 벡터화 |

---

## 벡터 검색 (RAG)

### 파일: src/services/searchService.js

```js
export async function findSimilarContext(query, storeId) {
  const vector = await getQuestionVector(query);  // 질문 → 벡터
  const sql = `
    SELECT content FROM manuals
    WHERE store_id = $2
    ORDER BY embedding <=> $1 LIMIT 2   -- 코사인 유사도 검색
  `;
  const res = await client.query(sql, [toSql(vector), storeId]);
  return res.rows.map(row => row.content).join('\n\n');
}
```

### 검색 방식

- **필터**: `store_id` — 해당 가게의 매뉴얼만 검색 (다른 가게 정보 혼입 방지)
- **정렬**: `embedding <=> $1` — pgvector의 코사인 거리 연산자 (값이 작을수록 유사)
- **상위 2개** 문서의 content를 합쳐서 반환

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
[4단계] src/bedrock.js ragNode → invokePrompt(BEDROCK_RAG_ARN, {...})
  invokePrompt(BEDROCK_RAG_ARN, {
    user_query: "환불 규정 알려주세요",
    retrieved_context: "# 에브리샵 환불 규정\n환불은 7일 이내..."  ← 벡터 검색 결과
  })

  프롬프트 내부:
  ┌────────────────────────────────────────────────┐
  │ 다음 규정을 참고하여 고객의 질문에 답변하세요.  │
  │                                                │
  │ [규정/매뉴얼]                                   │
  │ # 에브리샵 환불 규정                            │
  │ 환불은 상품 수령 후 7일 이내 신청 가능...        │
  │                                                │
  │ [고객 질문]                                     │
  │ 환불 규정 알려주세요                            │
  └────────────────────────────────────────────────┘
  ↓
  AI(Nova)가 매뉴얼을 읽고 답변 생성
  ↓
[5단계] src/bedrock.js composerNode → 최종 답변 + 추천 질문 구성
  ↓
고객에게 반환:
{
  answer: "환불은 상품 수령 후 7일 이내 신청 가능하며, 미개봉·미사용 상태여야 합니다.
           고객 변심 시 왕복 배송비 6,000원이 차감됩니다.",
  suggestions: ["교환 절차도 알려주세요", "배송비는 얼마인가요?", "반품 접수 방법이 궁금해요"]
}
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
