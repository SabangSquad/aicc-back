# To-Do

## 현재 해야 할 것

(우선순위 항목 없음. 향후 개선 항목은 plan.md "미완료 / 향후 개선" 참조)

### 잠재 후속 작업

- **Dynamic Few-shot** — 과거 종료 cases를 임베딩 → 유사 상담 답변을 composer에 예시로 주입 (현재 static few-shot만)
- **cases.suggested_reply 영속화** — 컬럼 추가 + caseWriter UPDATE에 포함 → 매번 재호출 없이 사장 화면에 추천 답변 노출
- **escalate 후 알림** — 상담사 답변 도착 시 고객에게 알림 (현재 polling)
- **매뉴얼 카테고리 자유화** — 현재 업종별 고정 → 매장 자율 카테고리 등록
- **세션 만료 활동 기반** — `rolling: true` 도입 검토 (현재 30분 고정)

---

## 완료된 것

### 초기 인프라

| 항목 | 상태 |
|------|------|
| Swagger JSDoc 전체 엔드포인트 | 완료 |
| 임베딩 파이프라인 (stores.js POST/PATCH + embed-manuals.js) | 완료 |
| 기존 매뉴얼 일괄 임베딩 | 완료 |
| LangGraph 워크플로우 (병렬 + verifier 통합) | 완료 |
| searchService.js 공유 pool | 완료 |
| Rate Limiting (/chats 분당 10회) | 완료 |
| 중앙 에러 핸들러 | 완료 |
| 레거시 파일 삭제 (agents.js, order_items.js, assignAgent.js) | 완료 |

### 채팅 / 세션

| 항목 | 상태 |
|------|------|
| 목록 API 페이지네이션 (page/limit/total) + status/날짜 필터 | 완료 |
| GET /stores/:store_id 공개 접근 허용 | 완료 |
| /auth/status에 store_id, customer_id 추가 | 완료 |
| SSE 스트리밍 (graph.stream) | 완료 |
| Redis 세션 스토어 | 완료 |
| 상담 자동 종료 (크론잡 30분 + 세션 복원 시 체크) | 완료 |
| 다른 가게 채팅 시 이전 세션 자동 종료 | 완료 |
| 로그인 상태 채팅 단일 세션 보장 | 완료 |
| 고객 로그인 후 /chat 리다이렉트 | 완료 |
| 자동 종료 시 AI자동해결/종료 분기 (speaker='상담사' 기준) | 완료 |
| 모든 종료 경로에서 AI 분석(감정/요약) 실행 | 완료 |

### Supervisor / 라우팅

| 항목 | 상태 |
|------|------|
| store_category Supervisor 전달 | 완료 |
| 업종별 미지원 기능 차단 (unsupported) | 완료 |
| greeting 분기 (인사 → composer 직행) | 완료 |
| reservation → showReservationForm 통일 | 완료 |
| 예약 날짜 추출 (extractDateRange) | 완료 |
| rag → store 자동 전환 (규정 아닌 일반 정보) | 완료 |
| 로그인 메시지 상황별 분리 | 완료 |
| 예약 inquiry/action 세분화 (reservation_type) | 완료 |
| 비로그인 예약 action → login_required (가능 시간 참고 포함) | 완료 |
| availableSlots 타임존 버그 수정 (toLocalDateStr) | 완료 |
| LangGraph 체크포인트 carry-over 방지 (state 리셋) | 완료 |
| **요일 표현 ("금요일") → JS로 KST 기준 미래 같은 요일 계산** | 완료 |
| **묵시적 본인 데이터 의도 ("배송 어디까지 왔어?") → api 분류** | 완료 |
| **명시 ID + 정책 질문 → api 강제 (apiNode가 매뉴얼 함께 fetch)** | 완료 |

### 본인 데이터 + 정책 결합

| 항목 | 상태 |
|------|------|
| **apiNode에 categoryHint 기반 매뉴얼 검색** | 완료 |
| **본인 데이터 + 매뉴얼 결합 단정 답변 (composer 룰 5)** | 완료 |
| **매뉴얼 0건 시 [참고 매뉴얼 안내] 명시 (매장 사장 문의 유도)** | 완료 |
| **매뉴얼 sourceData 맨 앞 prepend (truncate 보존)** | 완료 |
| **회피 멘트 변경 "고객센터" → "매장 사장님"** (composer post-process + ragAgent prompt) | 완료 |

### 솔루션 / 매장 운영

| 항목 | 상태 |
|------|------|
| GET /stores/:store_id/solutions (솔루션 분석 API) | 완료 |
| Solution Analyzer 프롬프트 + JSON 파싱 재시도 + valid fallback | 완료 |
| 매장 품질 score (AI해결률 + 부정감정 + 만족도) | 완료 |
| **만족도 없을 때 70점 만점 → 100점 환산 (부당 페널티 제거)** | 완료 |
| **cases 0건 시 ai_analysis valid 구조 fallback (프론트 .headline crash 방지)** | 완료 |
| Solution 404 → 200 valid 구조 | 완료 |

### 답변 근거 / 투명성

| 항목 | 상태 |
|------|------|
| RAG sources (manualId/title/category/score) | 완료 |
| API dataSources (case/order/shipment 등) | 완료 |
| decisionTrace (supervisor intent/rag score/api routes/store 응답 유형) | 완료 |
| 응답 explanation.answerType + reason | 완료 |

### 매뉴얼 / 상품 CRUD

| 항목 | 상태 |
|------|------|
| 매뉴얼 GET/POST/PATCH + 임베딩 자동 생성/재생성 | 완료 |
| **매뉴얼 DELETE (isStoreOwner)** | 완료 |
| 상품 GET/POST/PATCH | 완료 |
| **상품 DELETE (DB로 store_id 조회 후 권한 체크 + FK 위반 409 안내)** | 완료 |
| Swagger 문서화 (전체 엔드포인트) | 완료 |

### 인프라 / 운영

| 항목 | 상태 |
|------|------|
| AWS Bedrock → vLLM Qwen3-8B-AWQ 전환 | 완료 |
| 프롬프트 단일 소스 (src/prompts/templates.js) | 완료 |
| Truncate 유틸 (ContextOverflow 방지) | 완료 |
| max_tokens 노드별 분리 설정 | 완료 |
| Redis 끊김 노이즈 분리 (warn) + TCP keepAlive 5초 | 완료 |
| 상담 카테고리 재분류 스크립트 (scripts/recategorize-cases.js) | 완료 |

### 정성 평가 도구 (2026-05)

| 항목 | 상태 |
|------|------|
| **scripts/eval-export.js** (추천/감정 평가, 랜덤 매장, case_id 명시 모드, 자동 DB UPDATE) | 완료 |
| **scripts/eval-solutions.js** (솔루션 평가, 다중 매장 iterations, 인풋 케이스 노출) | 완료 |
| **정성 평가 결과: 4.275/5 (85.5%)** — Headline 4.5 / Issues 4.2 / Strategies 4.3 / Urgency 4.1 | 완료 |
