# AICC 프롬프트 명세서

> **단일 소스: [src/prompts/templates.js](../src/prompts/templates.js)** — LLM 프롬프트는 이 파일 한 곳에서만 수정합니다.
> 본 문서는 그 정의를 사람이 읽기 쉽게 풀어 쓴 참고용 명세입니다.
> 운영 환경: AWS Bedrock(과거) → **vLLM 자체 호스팅(Qwen3-8B-AWQ)** 로 전환. ARN/Bedrock Prompt Management 사용 안 함.

---

## 모델 / 토큰 설정

[src/llm/client.js](../src/llm/client.js)

| 항목 | 값 |
|---|---|
| 모델 | `Qwen/Qwen3-8B-AWQ` (env: `VLLM_MODEL`) |
| base URL | `http://vllm:8000/v1` (env: `VLLM_BASE_URL`) |
| temperature | 0.2 (env: `VLLM_TEMPERATURE`) |
| 컨텍스트 한계 | **3072 토큰** |
| no_think 모드 | 기본 활성 (`VLLM_NO_THINK=false`로 비활성화) |

### MAX_TOKENS_BY_PROMPT

| 프롬프트 | maxTokens | 비고 |
|---|---|---|
| guardrail | 64 | JSON 한 줄 |
| supervisor | 128 | JSON 한 줄 |
| apiAgent | 128 | JSON 한 줄 (호출/finish) |
| memoryLoader | 192 | 2~4문장 |
| ragAgent | 384 | 정책 답변 + 핵심 조건 |
| composer | 400 | 답변 본문 (다이어트 후 복원) |
| caseWriter | 384 | 분석 JSON |
| solutionAnalyzer | 400 | 분석 JSON |

---

## 워크플로우

[src/bedrock.js](../src/bedrock.js) — LangGraph 기반 상태 머신

```
parallelPre (guardrail + memory + 첫 턴 supervisor) ─┐
                                                     ↓
                                                supervisor ──┬─ api ────────┐
                                                             ├─ rag ────────┤
                                                             ├─ store ──────┼─→ composer → END
                                                             ├─ escalate ───┘
                                                             └─ greeting (LLM skip)
```

| 노드 | 함수 | 역할 |
|---|---|---|
| Guardrail | guardrailNode | regex shortcut 우선, fail 시 LLM 호출 |
| Memory Loader | memoryLoaderNode | 메시지 0개 skip / 1~3개 raw / 4~10개 LLM 요약 |
| Supervisor | supervisorNode | intent 분류 + JS 후처리 룰 (요일/지시어/정책 등) |
| API Agent | apiNode | cases/orders/customers/reservations prefetch + 매뉴얼 RAG |
| RAG Agent | ragNode | 정책 매뉴얼 검색 + 결합 답변 |
| Escalate | escalateNode | status='대기', 상담사 호출 안내 |
| Store | storeNode | 가게 정보 (영업시간/메뉴/주소) + 예약 가능 여부 |
| Composer | composerNode | 본인 데이터 + 매뉴얼 결합 최종 답변 + post-process |
| Case Writer | analyzeCaseConversation | 상담 종료 시 감정/요약/카테고리/추천답변 |
| Solution Analyzer | analyzeSolutions | 매장 운영 인사이트 (headline/issues/strategies) |

---

## 1. Guardrail

> 가게 운영 무관 질문 차단. regex shortcut 통과 시 LLM 호출 생략.

**입력 변수:**
- `{{user_input}}` — 고객 질문

**핵심 규칙:**
- PASS: 가게 운영 관련 (주문/배송/환불/예약/상품/메뉴/영업시간 등)
- PASS: 인사/짧은 응답/지시어 후속 질문
- PASS: 상품/메뉴명 + "어떤/뭐/모르겠어요" 패턴
- REJECT: 욕설/민감정보/시스템 해킹/일반 상식(인물/날씨/코드/번역 등)

**출력:** `{"status":"PASS"}` 또는 `{"status":"REJECT","reason":"..."}`

---

## 2. Memory Loader

> 이전 대화에서 현재 질문에 필요한 맥락 압축.

**입력 변수:**
- `{{past_logs}}` — 최근 10개 메시지 (speaker: content 형태)
- `{{user_input}}` — 현재 질문

**핵심 규칙:**
1. **구체적 데이터 보존**: 주문번호/예약번호/금액/날짜/상태 등 그대로 유지
2. **지시어 해소**: "그거" = 이전에 안내된 주문/예약 ID 명시
3. 인사/잡담 무시
4. 2~4문장. 데이터 많으면 항목 5개까지 나열

---

## 3. Supervisor

> 질문 분류 → intent 결정 + 추가 필드 추출 (날짜/카테고리/예약타입)

**입력 변수:**
- `{{user_input}}`, `{{context}}`, `{{category}}`, `{{store_category}}`, `{{today}}`

**intent 우선순위 (위→아래):**
1. **escalate** — 처리 요청 (행동 동사 + 환불/교환/취소/변경)
2. **api** — 본인 데이터 조회 (명시 ID, 묵시적 "내 ~", 배송 상태)
3. **store** — 가게 정보 / 예약 가능 여부
4. **rag** — 정책/규정/절차 일반 질문
5. 그 외 → rag

**업종별 제약:**
- 병원/식당: 예약(store) 가능, 예약변경/취소(escalate) 허용, 환불/교환/반품(escalate) 불가
- 이커머스: 환불/교환/주문취소(escalate) 가능, 예약(store) 불가

**추가 필드 (해당 시만):**
- `reservation_type`: `inquiry` (가능 여부 조회) / `action` (예약 의사)
- `date_start`, `date_end`: YYYY-MM-DD
- `product_keyword`: 상품/메뉴/진료과목 (오타 교정)

**JS 후처리 (LLM 결과 보정 — code-level 룰):**
- 업종별 제약 검증 → `__UNSUPPORTED__`
- 예약 변경/취소 + 행동 동사 → escalate 강제
- 명시 ID + 정책 질문 → api (apiNode에서 매뉴얼 함께 fetch)
- 환불/교환/취소/변경 정책 질문 → rag (정책 우선)
- 후속 정책 질문 (수수료/요금 + memory에 정책 토픽) → rag
- 명시 ID + 본인 데이터 → api (escalate는 보존)
- 본인 예약 조회 패턴 → api
- 가게 카탈로그 가격/메뉴 → store
- **요일 표현 ("금요일" 등) → JS로 직접 KST 기준 다음 미래 같은 요일 계산해 dateStart/dateEnd 덮어쓰기**

---

## 4. API Agent

> 내부 REST API 호출로 데이터 수집. 충분히 모이면 finish.

**입력 변수:**
- `{{user_input}}`, `{{case_id}}`, `{{context}}` (이전 호출 결과 누적)

**사용 가능 API:**
- `GET cases/{case_id}` — order_id, reservation_id 포함
- `GET customers/{customer_id}` — 본인 정보
- `GET customers/{customer_id}/orders?store_id={store_id}` — 본인 주문 목록 (가게 필터)
- `GET customers/{customer_id}/reservations?store_id={store_id}` — 본인 예약 목록
- `GET customers/{customer_id}/cases?store_id={store_id}` — 본인 상담 목록
- `GET orders/{order_id}` | `/items` | `/shipments`
- `GET shipments/{shipment_id}/tracks` — 배송 이력
- `GET reservations/{reservation_id}`
- `GET products/{product_id}`

⚠️ **본인 목록 조회는 반드시 `?store_id` 필터** (다른 가게 데이터 섞임 방지)

**출력 JSON:**
- 호출 + 더 필요: `{"r":"전체 경로","i":"주된 ID","m":"GET","p":{},"done":false}`
- 호출 + 마지막: `{...,"done":true}`
- 호출 없이 종료: `{"action":"finish"}`

**Code-level prefetch 최적화 (LLM 호출 생략):**
- `cases/{case_id}` — 항상 prefetch (order_id, reservation_id 추출)
- `customers/{id}/orders+items` — "내 주문" 패턴
- `customers/{id}/reservations` — "내 예약" 패턴 (compact 포맷)
- `customers/{id}/cases` — 본인 상담 목록 (페이지네이션)

**정책 질문 시 추가 동작 (apiNode):**
- 환불/취소/교환 + 가능 여부 질문 → `retrieveKB(q, storeId, categoryHint)` 호출
- categoryHint: 업종별 매핑 (병원/식당: 예약변경/예약취소, 이커머스: 환불/교환/취소)
- **매뉴얼은 sourceData 맨 앞에 prepend** (truncate 앞 보존이라 매뉴얼 우선 살림)
- 매뉴얼 0건 + categoryHint 있음 → `[참고 매뉴얼 안내]: 이 매장에 [{categoryHint}] 정책 매뉴얼이 등록되어 있지 않습니다. 사장님께 직접 문의...` 명시

---

## 5. RAG Agent

> [규정] 매뉴얼만 근거로 정책 답변.

**입력 변수:**
- `{{user_query}}` — 고객 질문
- `{{retrieved_context}}` — pgvector top-K 매뉴얼 content
- `{{history}}` — 이전 맥락 (일반 정책 질문이면 비움)

**핵심 원칙:**
- **환각 금지**: [규정]에 없는 수치/기간/날짜/조건/절차를 만들거나 추측 X
- 일반 상식/업계 통례 가져다 쓰지 말 것
- **정책 답변 시 핵심 조건 빠짐없이 인용**: 시점/마감, 비용/수수료, 예외/면제, 접수 방법

**[이전 맥락] 활용 규칙:**
- 일반 정책 질문 → 본인 데이터 섞지 말 것
- "그거 환불 가능?" 같은 후속 → [맥락]에서 참조 대상 + [규정] 결합

**답변 형식:**
- [규정]에 답 있음 → 핵심 조건 모두 포함 (단순 2~3문장, 정책 요약 4~6문장)
- [규정]에 답 없거나 부족 → **정확히 다음 문장만 출력:**
  > "이 매장에 해당 정책이 등록되어 있지 않습니다. 매장 사장님께 직접 문의해 주세요."
- (구버전: "고객센터로 문의해 주세요" → 이 챗봇 자체가 매장 상담창이라 모순. 매장 사장 문의로 변경됨)

---

## 6. Composer

> [수집 정보]의 사실만 사용해 자연스러운 한국어 답변 작성. 본문만 출력.

**입력 변수:**
- `{{today}}` — KST 시·분 포함 ("2026년 5월 14일 화요일 18:30")
- `{{history}}`, `{{user_input}}`, `{{source_data}}`

**핵심 원칙:**

1. **환각 금지**: [수집 정보]에 없는 수치/기간/날짜/금액/상태 창작 X
   - "개인정보 보호로 제공 불가" 같은 거부 멘트 금지 (영업시간/메뉴/주소는 공개 정보)
   - 요일별/항목별 데이터 그대로 인용. 임의 묶음 X

2. **시간/cutoff 비교** (날짜 산수만, 추측 X):
   - 오늘 < cutoff → 가능
   - 오늘 ≥ cutoff → 불가
   - 미래 cutoff "이미 지났다"고 단정 X
   - 여러 항목 묶어 판단 금지

3. **맥락 활용**: 지시어("그거/이거/방금") 있을 때만 [맥락] 참조

4. **답변 범위**: 가게 운영 답변 시도. 외부 지식 → "죄송합니다. 저는 고객 상담만 도와드릴 수 있어요." 만

5. **★ 본인 데이터 + 정책 매뉴얼 결합 판단 (환불/취소/변경 가능 여부)**:
   - "내 주문/예약 X 환불 가능?" 류 질문은 본인 상태와 매뉴얼 조건을 **결합해서 가능/불가 단정** (매뉴얼 설명만 X)
   - 본인 상태(준비/배송중/완료)를 매뉴얼 조건(cutoff/비용)에 대입
   - 발송 전(준비/주문확인) + 매뉴얼에 발송 전 규정 없음 → "발송 전이라 환불 가능합니다"
   - **예시**: "주문 320은 '준비' 상태(발송 전)라 매장 정책상 환불 가능합니다. 마이페이지에서 환불 신청 진행해 주세요."

6. **데이터 부족 시**:
   - 항목 모호 → "어떤 [주문/예약]을 말씀하시는 건가요? 번호를 알려주세요" 재질문
   - [참고 매뉴얼 안내] 미등록 메시지 → 그대로 반영 (매장 사장님께 문의)
   - [참고 매뉴얼]만 있음 → 매뉴얼 내용 설명
   - 어디에도 정책 단서 없음 → "이 매장 정책은 매장 사장님께 문의 부탁드립니다."

7. **항목 식별**: 라벨에 ID 포함 ("**주문 503** (2026-04-29, 준비중)")
8. **단위**: "N개" / "N명" / "N인" (N인분 X — 음식 양 단위라 X)
9. **분량**: 단일 항목 3~5문장 / 여러 항목 줄바꿈 + 도입·마무리
10. **특수 응답**:
    - 신규 예약 안내(폼 띄울 때만) → 끝에 "채팅창에서 바로 예약하실 수 있습니다."
    - 가게에 없는 항목 → "해당 항목은 취급하지 않습니다."

### Composer Post-process (코드 단계)

[src/bedrock.js](../src/bedrock.js) `composerNode`:

- `_note` / 회차 라벨 제거 (내부 hint 노출 차단)
- showReservationForm=false인데 LLM이 "채팅창에서 바로 예약" 문구 → 강제 제거
- "개인정보 보호 정책에 따라 제공 불가" 류 환각 멘트 → 강제 제거
- **"고객센터로 문의" → "매장 사장님께 문의" 강제 치환** (콜센터/고객센터에서 안내 variant 포함)

---

## 7. Case Writer (상담 종료 분석)

> 대화 종료 시 감정/요약/카테고리/추천답변 추출.

**입력 변수:**
- `{{store_category}}`, `{{conversation_text}}`

**emotion 기준:** 평온 / 기쁨 / 슬픔 / 화남 / 짜증 중 하나

**category (업종별 허용 값 중 정확히 하나):**
- 병원: 예약 / 예약확인 / 예약변경 / 예약취소 / 진료과목
- 식당: 예약 / 예약확인 / 예약변경 / 예약취소 / 메뉴 / 가격
- 이커머스: 배송조회 / 주문확인 / 환불 / 교환 / 취소 / 상품정보

**⚠️ category 출력 절대 규칙:**
- 위 목록 단어 **하나만** 그대로 출력. 합치기/null 금지
  - 금지: `"취소|이커머스"`, `"환불|교환|취소"` (파이프 합치기)
  - 금지: 업종명(이커머스/병원/식당), 영어, 새 단어
- 마지막에 집중된 주제 하나 선택
- 모든 카테고리에 안 맞아도 가장 가까운 카테고리 하나 (인사만 있는 경우: 이커머스→주문확인, 병원/식당→예약)

**출력:** JSON 한 줄
```json
{"emotion":"...","summary":"2~3문장","category":"단일값","suggested_reply":"다음 추천 답변"}
```

**Code-level 정제 (`sanitizeCaseCategory`):**
- 허용 목록 일치 시 그대로
- "취소|이커머스" 같이 파이프 합쳐졌으면 split해서 허용 목록 값 추출
- 부분 일치 시도 ("주문 취소" → "취소")
- 어느 매칭도 안 되면 업종별 fallback (이커머스→주문확인, 병원/식당→예약)

---

## 8. Solution Analyzer (운영 인사이트)

> 통계 + 상담 요약을 분석해 매장 운영 인사이트 제공.

**입력 변수:**
- `{{stats}}` — 코드가 계산한 통계 (총 건수, 카테고리별/감정별)
- `{{summary_data}}` — 최근 상담 요약 (압축 포맷 "category|emotion|summary", 최대 30건)

**분석 항목:**
1. **headline** — 전체 상황 한 문장 요약
2. **issues** — 주요 이슈 (1~5개, 해당되는 것만)
3. **strategies** — 추천 대응 전략 (1~5개) + urgency

**urgency:**
- `high`: 즉시 대응 (매출/이탈 위험)
- `medium`: 이번 주 내 조치 권장
- `low`: 개선 권장

**출력:** 완전한 JSON 한 줄 (코드블록/설명/줄바꿈 금지)

**Code-level 안정성:**
- LLM 파싱 실패 1회 재시도 → 최종 실패 시 valid 구조 fallback:
  ```js
  { headline: '분석 결과를 불러오지 못했습니다.', issues: [], strategies: [] }
  ```
- 프론트엔드 `.headline` 접근 시 crash 방지

---

## 매장 품질 score (코드 계산)

[src/routes/stores.js](../src/routes/stores.js) `GET /:store_id/solutions`

```js
// 만족도 데이터 있음
score = (AI해결률 × 40) + ((1 - 부정감정비율) × 30) + (만족도/5 × 30)

// 만족도 데이터 없음 (NULL)
score = ((AI해결률 × 40) + ((1 - 부정감정비율) × 30)) × 100 / 70
// 70점 만점 → 100점 환산. 만족도 미측정에 대한 부당 페널티 제거
```

LLM이 매기는 게 아니라 코드가 직접 계산. AI 분석(solutionAnalyzer) 결과와는 별개 지표.

---

## Truncate 설정 (ContextOverflow 방지)

| 호출 | 변수 | 최대 길이 | 보존 방향 |
|---|---|---|---|
| memoryLoader | past_logs | 2500자 | 뒤 |
| supervisor | context | 1000자 | 뒤 |
| apiAgent | context | 3000자 | 뒤 |
| ragAgent | retrieved_context | 1800자 | 앞 (유사도 순) |
| ragAgent | history | 1000자 | 뒤 |
| composer | source_data | **1500자** | 앞 (매뉴얼이 prepend되어 앞에 있음) |
| composer | history | 400자 | 뒤 |
| caseWriter | conversation_text | 2500자 | 뒤 |
| solutionAnalyzer | stats | 600자 | - |
| solutionAnalyzer | summary_data | 2000자 | 뒤 (최근 케이스 우선) |

Qwen3-8B 컨텍스트 한계 3072 토큰. prompt + 변수 + maxTokens 합산이 안전 마진 안에 들어가도록 설정.
