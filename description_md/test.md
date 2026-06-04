# AICC 백엔드 테스트 항목

---

## 1. 채팅 (POST /chats)

### 기본 흐름

| # | 시나리오 | 요청 | 확인할 것 |
|---|---------|------|----------|
| 1-1 | 첫 메시지 (비로그인) | `{ message, store_id }` | 케이스 생성, customer_id=NULL, 세션에 caseId 저장 |
| 1-2 | 이어서 메시지 (caseId 안 보냄) | `{ message }` | 세션에서 caseId 복원, 같은 케이스에 메시지 추가 |
| 1-3 | 로그인 후 메시지 | `{ message }` | customer_id 자동 연결 (cases UPDATE) |
| 1-4 | 종료 | `POST /chats/:id/close` | status='종료', 세션 초기화, AI 분석(감정/요약) 저장 |
| 1-5 | 종료 후 새 메시지 | `{ message, store_id }` | 새 케이스 생성 (이전 케이스와 다른 case_id) |
| 1-6 | 만족도 등록 | `POST /cases/:id/satisfactions { store_id, score }` | 종료 후 만족도 저장 |

### 자동 종료

| # | 시나리오 | 확인할 것 |
|---|---------|----------|
| 1-7 | 30분 후 메시지 | 이전 케이스 자동 종료 + 새 케이스 생성 |
| 1-8 | 크론잡 (5분 주기) | 30분 비활동 '상담' 케이스 자동 종료, '대기'는 유지 |

### AI 분류 (Supervisor)

| # | 시나리오 | 질문 예시 | 기대 결과 |
|---|---------|----------|----------|
| 1-9 | 규정 질문 → rag | "환불 규정 알려주세요" | 매뉴얼 기반 답변 |
| 1-10 | 데이터 조회 → api (로그인) | "내 주문 어디있어?" | 주문 데이터 조회 후 답변 |
| 1-11 | 데이터 조회 → api (비로그인) | "내 주문 어디있어?" | `login_required` 응답 |
| 1-12 | 처리 요청 → escalate | "환불해주세요" | status='대기', AI 요약/감정 저장 |
| 1-13 | 규정 질문 (처리 아님) | "교환 어떻게 해요?" | rag (escalate 아님) |

### SSE 스트리밍

| # | 시나리오 | 확인할 것 |
|---|---------|----------|
| 1-14 | 정상 응답 | `thinking` → `thinking` → `answer` 순서 |
| 1-15 | 로그인 필요 | `thinking` → `login_required` |
| 1-16 | 에러 발생 | `error` 타입 응답 |

### 가드레일

| # | 시나리오 | 입력 | 기대 결과 |
|---|---------|------|----------|
| 1-17 | 욕설 | "ㅅㅂ 환불해줘" | 차단 메시지 |
| 1-18 | 개인정보 | "카드번호 4140-1111-2222-3333" | 마스킹 또는 차단 |
| 1-19 | 정상 질문 | "배송 언제 오나요" | 정상 통과 |

### 에지 케이스

| # | 시나리오 | 확인할 것 |
|---|---------|----------|
| 1-20 | store_id 누락 | 400 에러 |
| 1-21 | 빈 메시지 | 400 에러 |
| 1-22 | 탭 닫고 재방문 (세션 유지) | 같은 케이스 이어감 |
| 1-23 | 다른 브라우저/시크릿 | 새 세션 → 새 케이스 |
| 1-24 | Rate Limiting (분당 10회 초과) | 429 에러 |

---

## 2. 상담사 대화 (에스컬레이션 후)

| # | 시나리오 | 요청 | 확인할 것 |
|---|---------|------|----------|
| 2-1 | 대기 케이스 조회 | `GET /stores/:id/cases?status=대기` | 에스컬레이션된 케이스 목록 |
| 2-2 | 메시지 조회 | `GET /cases/:id/messages` | 고객+챗봇 대화 내역 |
| 2-3 | 상담사 답변 | `POST /cases/:id/messages { speaker:'상담사' }` | 메시지 저장 |
| 2-4 | 고객 polling | `GET /cases/:id/messages` | 상담사 답변이 포함됨 |
| 2-5 | 상담사가 종료 | `PATCH /cases/:id { status:'종료' }` | status 변경, AI 분석 실행 |
| 2-6 | AI 요약 확인 | `GET /cases/:id` | summary, emotion 필드 채워짐 |

---

## 3. 인증/권한

### 로그인

| # | 시나리오 | 확인할 것 |
|---|---------|----------|
| 3-1 | Google 로그인 (ADMIN) | role='ADMIN' |
| 3-2 | Google 로그인 (OWNER) | role='OWNER', store_id 포함 |
| 3-3 | Google 로그인 (CUSTOMER) | role='CUSTOMER', customer_id 포함 |
| 3-4 | 미등록 이메일 | 403 거부 |
| 3-5 | 로그아웃 | 세션 삭제, 쿠키 삭제 |
| 3-6 | 상태 확인 (로그인) | `GET /auth/status` → isAuthenticated: true |
| 3-7 | 상태 확인 (비로그인) | `GET /auth/status` → 401 |

### 권한 체크

| # | 시나리오 | 확인할 것 |
|---|---------|----------|
| 3-8 | 비로그인 → 보호된 API | 401 |
| 3-9 | CUSTOMER → /stores/:id/cases | 403 (OWNER만 가능) |
| 3-10 | OWNER → 다른 가게 수정 | 403 (본인 가게만) |
| 3-11 | CUSTOMER → 다른 고객 정보 | 403 (본인만) |
| 3-12 | x-internal-secret 헤더 | 모든 API 통과 (AI 내부 호출) |
| 3-13 | Swagger (ADMIN) | 접근 가능 |
| 3-14 | Swagger (OWNER) | 403 |

### 세션

| # | 시나리오 | 확인할 것 |
|---|---------|----------|
| 3-15 | 서버 재시작 후 로그인 유지 | Redis에 세션 유지 |
| 3-16 | 30분 비활동 후 | 세션 만료 → 로그아웃 |
| 3-17 | 쿠키 위조 시도 | 서명 불일치 → 거부 |

---

## 4. 가게 (Stores)

| # | 시나리오 | 요청 | 확인할 것 |
|---|---------|------|----------|
| 4-1 | 가게 추가 (ADMIN) | `POST /stores` | 201 생성 |
| 4-2 | 가게 추가 (OWNER) | `POST /stores` | 403 (ADMIN만 가능) |
| 4-3 | 가게 조회 | `GET /stores/:id` | 전체 정보 + _links |
| 4-4 | 가게 수정 (본인) | `PATCH /stores/:id` | 수정 성공 |
| 4-5 | 가게 수정 (타인) | `PATCH /stores/:id` | 403 |
| 4-6 | 잘못된 category | `POST /stores { category:"카페" }` | 400 에러 |

### 가게 하위 리소스

| # | 시나리오 | 요청 | 확인할 것 |
|---|---------|------|----------|
| 4-7 | 상담 목록 (필터) | `GET /stores/:id/cases?status=대기&emotion=화남` | 필터 적용 |
| 4-8 | 상담 목록 (시간) | `GET /stores/:id/cases?start=...&end=...` | 기간 필터 |
| 4-9 | 상담 목록 (페이지네이션) | `GET /stores/:id/cases?page=2&limit=10` | total, page, limit 포함 |
| 4-10 | 만족도 조회 | `GET /stores/:id/satisfactions?start=...&end=...` | 시간 필터 + 페이지네이션 |
| 4-11 | 주문 목록 (필터) | `GET /stores/:id/orders?status=배송` | status 필터 |
| 4-12 | 예약 목록 (필터) | `GET /stores/:id/reservations?status=완료` | status 필터 |
| 4-13 | 매뉴얼 목록 | `GET /stores/:id/manuals?category=환불` | category 필터 |
| 4-14 | 매뉴얼 추가 | `POST /stores/:id/manuals { title, category, content }` | 저장 + 임베딩 생성 |
| 4-15 | 매뉴얼 수정 | `PATCH /stores/:id/manuals/:id { content }` | 수정 + 임베딩 재생성 |
| 4-15a | 매뉴얼 삭제 | `DELETE /stores/:id/manuals/:id` | isStoreOwner, 200 + deleted 정보 / 404 매뉴얼 없음 |
| 4-16 | 상품 목록 | `GET /stores/:id/products` | 페이지네이션 |
| 4-17 | 상품 추가 | `POST /stores/:id/products { name, price }` | 201 생성 |

### 솔루션 분석

| # | 시나리오 | 요청 | 확인할 것 |
|---|---------|------|----------|
| 4-18 | 솔루션 조회 | `GET /stores/:id/solutions?hours=24` | stats(정확한 숫자) + ai_analysis(해석) |
| 4-18a | 만족도 없는 매장 | `GET /stores/:id/solutions?hours=24` | score 70점 만점 → 100점 환산 (부당 페널티 없음) |
| 4-19 | 데이터 없음 | `GET /stores/:id/solutions?hours=1` | 200 + ai_analysis: { headline:'최근 상담 데이터가 없어...', issues:[], strategies:[] } (프론트 .headline crash 방지) |
| 4-20 | hours 범위 | `hours=0`, `hours=25` | 기본값 24로 처리 |
| 4-21 | ai_analysis 파싱 실패 | LLM JSON 깨짐 → 1회 재시도 후 valid fallback | { headline:'분석 결과를 불러오지 못했습니다.', issues:[], strategies:[] } |

---

## 5. 상담 (Cases)

| # | 시나리오 | 요청 | 확인할 것 |
|---|---------|------|----------|
| 5-1 | 상담 생성 | `POST /cases { customer_id, store_id }` | 201 생성 |
| 5-2 | 상담 조회 | `GET /cases/:id` | 전체 정보 + _links |
| 5-3 | 상담 수정 (status) | `PATCH /cases/:id { status:'종료' }` | closed_at 자동 설정, AI 분석 실행 |
| 5-4 | 상담 수정 (재오픈) | `PATCH /cases/:id { status:'상담' }` | closed_at = NULL |
| 5-5 | 잘못된 status | `PATCH /cases/:id { status:'완료' }` | 400 에러 |
| 5-6 | 만족도 추가 | `POST /cases/:id/satisfactions { store_id, score:4.5 }` | 201 생성 |
| 5-7 | 만족도 (잘못된 score) | `score: 0.3` 또는 `score: 6` | 400 에러 |
| 5-8 | 메시지 조회 | `GET /cases/:id/messages` | 시간순 정렬 |
| 5-9 | 메시지 추가 | `POST /cases/:id/messages { content, speaker:'상담사' }` | 201 생성 |
| 5-10 | 잘못된 speaker | `speaker: 'admin'` | 400 에러 |

---

## 6. 고객 (Customers)

| # | 시나리오 | 요청 | 확인할 것 |
|---|---------|------|----------|
| 6-1 | 고객 추가 | `POST /customers { store_id, name, phone }` | 201 생성 |
| 6-2 | 고객 조회 (본인) | `GET /customers/:id` | 200 |
| 6-3 | 고객 조회 (타인) | `GET /customers/:id` | 403 |
| 6-4 | 고객 수정 | `PATCH /customers/:id { name }` | 수정 성공 |
| 6-5 | 상담 목록 | `GET /customers/:id/cases?status=종료` | 필터 + 페이지네이션 |
| 6-6 | 주문 목록 | `GET /customers/:id/orders?status=배송` | 필터 + 페이지네이션 |
| 6-7 | 예약 목록 | `GET /customers/:id/reservations` | 페이지네이션 |

---

## 7. 주문 (Orders)

| # | 시나리오 | 요청 | 확인할 것 |
|---|---------|------|----------|
| 7-1 | 주문 추가 | `POST /orders { customer_id, store_id }` | 201 생성 |
| 7-2 | 주문 조회 | `GET /orders/:id` | _links에 items, shipments 포함 |
| 7-3 | 주문 상태 수정 | `PATCH /orders/:id { status:'배송' }` | 200 |
| 7-4 | 잘못된 status | `PATCH /orders/:id { status:'진행' }` | 400 에러 |
| 7-5 | 주문 삭제 | `DELETE /orders/:id` | tracks → shipments → items → orders 순서 삭제 |
| 7-6 | 배송 조회 | `GET /orders/:id/shipments` | 해당 주문의 배송 목록 |
| 7-7 | 품목 조회 | `GET /orders/:id/items` | 해당 주문의 품목 목록 |
| 7-8 | 품목 추가 | `POST /orders/:id/items { product_id, quantity }` | 201 생성 |
| 7-9 | 품목 수정 | `PATCH /orders/:id/items/:id { quantity }` | 수정 성공 |
| 7-10 | 품목 삭제 | `DELETE /orders/:id/items/:id` | 삭제 성공 |

---

## 8. 배송 (Shipments)

| # | 시나리오 | 요청 | 확인할 것 |
|---|---------|------|----------|
| 8-1 | 배송 추가 | `POST /shipments { order_id, store_id }` | 201 생성 |
| 8-2 | 배송 조회 | `GET /shipments/:id` | 전체 정보 |
| 8-3 | 배송 수정 | `PATCH /shipments/:id { carrier, tracking_no }` | 수정 성공 |
| 8-4 | 배송이력 추가 | `POST /shipments/:id/tracks { event_at, event_type, location }` | 201 |
| 8-5 | 잘못된 event_type | `event_type: '배달완료'` | 400 에러 |
| 8-6 | 배송이력 수정 | `PATCH /shipments/:id/tracks/:id { location }` | 수정 성공 |

---

## 9. 예약 (Reservations)

| # | 시나리오 | 요청 | 확인할 것 |
|---|---------|------|----------|
| 9-1 | 예약 추가 | `POST /reservations { store_id, customer_id, reserved_at }` | 201 생성 |
| 9-2 | 예약 조회 | `GET /reservations/:id` | 전체 정보 |
| 9-3 | 예약 수정 | `PATCH /reservations/:id { status:'취소' }` | 수정 성공 |
| 9-4 | 잘못된 status | `PATCH /reservations/:id { status:'대기' }` | 400 에러 |

---

## 10. 상품 (Products) / 매뉴얼 (Manuals)

| # | 시나리오 | 요청 | 확인할 것 |
|---|---------|------|----------|
| 10-1 | 상품 조회 | `GET /products/:id` | store_id 포함 |
| 10-2 | 상품 수정 | `PATCH /products/:id { price }` | 수정 성공 |
| 10-2a | 상품 삭제 (소유자) | `DELETE /products/:id` | 200 + deleted 정보 (DB에서 store_id 조회 후 권한 체크) |
| 10-2b | 상품 삭제 (권한 없음) | `DELETE /products/:id` (다른 매장 OWNER) | 403 |
| 10-2c | 상품 삭제 (FK 위반) | `DELETE /products/:id` (주문에서 참조 중) | 409 + "관련 주문 처리 후 다시..." |
| 10-3 | 매뉴얼 조회 | `GET /manuals/:id` | store_id 포함 |

---

## 11. 벡터 DB / RAG

| # | 시나리오 | 확인할 것 |
|---|---------|----------|
| 11-1 | 매뉴얼 추가 시 임베딩 | manuals.embedding 컬럼에 벡터 저장됨 |
| 11-2 | 매뉴얼 수정 시 임베딩 재생성 | content 변경 → embedding 업데이트 |
| 11-3 | RAG 검색 정확도 | "환불 규정" 질문 → 환불 매뉴얼이 검색됨 (다른 매뉴얼 아님) |
| 11-4 | store_id 격리 | store_id=1 질문 → store_id=1 매뉴얼만 검색 (다른 가게 안 섞임) |
| 11-5 | 일괄 임베딩 스크립트 | `node src/scripts/embed-manuals.js` → embedding IS NULL 전부 처리 |
| 11-6 | categoryHint 우선 정렬 | apiNode 정책 질문 → `retrieveKB(q, storeId, '환불')` → 환불 카테고리 매뉴얼 우선 LIMIT 1 |
| 11-7 | 매뉴얼 0건 + categoryHint | sourceData에 `[참고 매뉴얼 안내]: 이 매장에 [환불] 정책 매뉴얼이 등록되어 있지 않습니다...` 명시 |
| 11-8 | 본인 데이터 + 매뉴얼 결합 | "주문 320 환불 가능?" → 주문 상태 "준비" + 매뉴얼 "발송 전 환불" → composer "준비 상태라 환불 가능합니다" 단정 |
| 11-9 | 매뉴얼 prepend (truncate 보존) | `[참고 매뉴얼]` 라벨이 accumulatedContext 맨 앞 → composer source_data 1500자 앞 보존 truncate에서 안 잘림 |
| 11-10 | 회피 멘트 치환 | composer/ragAgent 출력에 "고객센터 문의" → "매장 사장님께 문의" 자동 변환 |

---

## 12. 정성 평가 (LLM 품질)

### 12-1. 평가 도구

| 스크립트 | 인자 | 출력 |
|----------|------|------|
| `scripts/eval-export.js` | `[store_id\|random\|cases:id1,id2,...] [cases_per_store=10] [max_case_id=500] [iterations=1]` | `eval-report-{store/iter/cases}-{ts}.md` |
| `scripts/eval-solutions.js` | `[store_id\|random] [limit=10] [max_case_id=500] [iterations=1]` | `eval-solutions-{store/iter}-{ts}.md` |

### 12-2. 사용 예시

```bash
POD=$(kubectl -n aicc get pods -l app=aicc-back -o name | head -1 | sed 's|pod/||')

# 추천/감정 평가용: 매장 10개 × 1건 = 10 iteration
kubectl -n aicc exec $POD -- node scripts/eval-export.js random 1 500 10

# 솔루션 평가용: 매장 10개 각각 분석
kubectl -n aicc exec $POD -- node scripts/eval-solutions.js random 5 500 10

# 특정 case_id들로 재평가 (messages 수정 후 자동 DB UPDATE)
kubectl -n aicc exec $POD -- node scripts/eval-export.js cases:412,405,318 1 500 1
```

### 12-3. 평가 항목

| 항목 | 평가 대상 | 점수 |
|---|---|---|
| 솔루션 제공 | solutionAnalyzer ai_analysis (headline/issues/strategies) | 1~5 |
| 답변 추천 | caseWriter suggested_reply | ○/△/X |
| 감정 분석 | caseWriter emotion (대화 분위기와 비교) | ○/X |

### 12-4. 평가 워크플로우

1. eval-export 실행 → markdown 받기
2. 케이스별 상세에서 **전체 대화** 읽고 본인 emotion 라벨 + suggested_reply 평가
3. 평가 후 `<details>` 펼쳐 LLM 결과와 비교 (anchoring bias 방지)
4. eval-solutions 실행 → 매장별 ai_analysis 평가
5. "분석에 쓰인 케이스" 표로 결과 검증

### 12-5. 평가 결과 (2026-05-19 기준)

10 iteration 평균:
- Headline 적절성: **4.5 / 5**
- Issues 가치: **4.2 / 5**
- Strategies 실행가능성: **4.3 / 5**
- Urgency 적정성: **4.1 / 5**
- **전체 평균: 4.275 / 5 (85.5%)**

### 12-6. 안전장치

- `cases:` 모드에서만 cases 테이블 자동 UPDATE (emotion/category/summary)
- caseWriter JSON 파싱 실패 시 valid 구조 fallback
- 케이스 N건 미달 매장은 랜덤 선택에서 자동 제외 (`HAVING COUNT >= cases_per_store`)
