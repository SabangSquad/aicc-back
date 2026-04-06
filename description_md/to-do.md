# To-Do

## 현재 해야 할 것

### 1. 예약 가능 시간 슬롯 계산 (프론트 처리)

프론트에서 `GET /stores/:id` (business_hours) + `GET /stores/:id/reservations?start=...&end=...` (예약 현황)을 조합하여 빈 슬롯 계산 + 예약 버튼 표시.

백엔드는 `showReservationForm: true` 플래그만 제공 (완료).

---

### 2. 프론트 연동

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
