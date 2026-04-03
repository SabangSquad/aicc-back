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
| 4-16 | 상품 목록 | `GET /stores/:id/products` | 페이지네이션 |
| 4-17 | 상품 추가 | `POST /stores/:id/products { name, price }` | 201 생성 |

### 솔루션 분석

| # | 시나리오 | 요청 | 확인할 것 |
|---|---------|------|----------|
| 4-18 | 솔루션 조회 | `GET /stores/:id/solutions?hours=24` | stats(정확한 숫자) + ai_analysis(해석) |
| 4-19 | 데이터 없음 | `GET /stores/:id/solutions?hours=1` | 404 |
| 4-20 | hours 범위 | `hours=0`, `hours=25` | 기본값 24로 처리 |

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
