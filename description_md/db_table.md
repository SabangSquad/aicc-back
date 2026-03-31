# DB 테이블 정의서

> 기준: 테이블.html + ERD 이미지 + 데이터.txt 종합
> 작성일: 2026-03-24

---

## 목차

1. [stores (가게)](#1-stores-가게)
2. [customers (고객)](#2-customers-고객)
3. [cases (상담건)](#3-cases-상담건)
4. [messages (대화메시지)](#4-messages-대화메시지)
5. [satisfactions (만족도)](#5-satisfactions-만족도)
6. [manuals (규정)](#6-manuals-규정)
7. [orders (주문)](#7-orders-주문)
8. [items (주문품목)](#8-items-주문품목)
9. [products (상품)](#9-products-상품)
10. [shipments (배송)](#10-shipments-배송)
11. [tracks (배송이력)](#11-tracks-배송이력)
12. [reservations (예약)](#12-reservations-예약)
13. [관계 다이어그램](#13-관계-다이어그램)
14. [소스 간 불일치 및 주의사항](#14-소스-간-불일치-및-주의사항)

---

## 1. stores (가게)

| 컬럼명         | 타입         | 제약     | 설명                                        |
| -------------- | ------------ | -------- | ------------------------------------------- |
| store_id       | SERIAL       | PK       | 가게 고유번호                               |
| name           | VARCHAR(100) | NOT NULL | 가게명                                      |
| category       | VARCHAR(50)  | NOT NULL | 업종 —`병원` \| `식당` \| `이커머스` |
| phone          | VARCHAR(20)  | NOT NULL | 전화번호                                    |
| email          | VARCHAR(100) | NOT NULL | 이메일                                      |
| address        | VARCHAR(255) | NOT NULL | 주소                                        |
| business_hours | JSON         |          | 영업시간                                    |
| facilities     | JSON         |          | 편의시설 목록                               |
| notice         | TEXT         |          | 공지                                        |
| store_items    | JSON         |          | 업종별 가변 항목                            |

### 비고

**`business_hours`** JSON 구조:

해당 속성이 전부이며 시간과 off 요일만 바뀜

```json
{
  "mon": "09:00-18:00",
  "tue": "09:00-18:00",
  "wed": "09:00-18:00",
  "thu": "09:00-18:00",
  "fri": "09:00-18:00",
  "sat": "10:00-15:00",
  "sun": "off",
}
```

**`facilities`** JSON 구조:

해당 속성이 전부이며 false/true만 바뀜

```json
{"wifi":false, "남/녀 화장실 구분": true, "휠체어": true, "주차": false}
```

**`store_items`** JSON 구조 — `category`에 따라 다름:

```json
// category = '병원'
{ "department": ["내과", "외과"] }

// category = '식당'
{ "menu": [{ "name": "김치찌개", "price": 6000, "description": "국내산" }] }

// category = '이커머스'
// store_items 미사용
```

---

## 2. customers (고객)

| 컬럼명      | 타입         | 제약         | 설명          |
| ----------- | ------------ | ------------ | ------------- |
| customer_id | SERIAL       | PK           | 고객 고유번호 |
| store_id    | INT          | FK → stores | 소속 가게     |
| name        | VARCHAR(50)  | NOT NULL     | 이름          |
| phone       | VARCHAR(20)  | NOT NULL     | 전화번호      |
| email       | VARCHAR(100) |              | 이메일        |
| address     | VARCHAR(255) |              | 주소          |
| birthdate   | DATE         |              | 생년월일      |

---

## 3. cases (상담건)

| 컬럼명         | 타입        | 제약            | 설명                                                                 |
| -------------- | ----------- | --------------- | -------------------------------------------------------------------- |
| case_id        | SERIAL      | PK              | 상담 고유번호                                                        |
| customer_id    | INT         | FK → customers | 고객                                                                 |
| store_id       | INT         | FK → stores    | 가게                                                                 |
| order_id       | INT         | FK              | 주문                                                                 |
| reservation_id | INT         | FK              | 예약                                                                 |
| category       | VARCHAR(50) |                 | 상담 카테고리 — 아래 비고 참조 |
| status         | VARCHAR(20) | NOT NULL        | 상담 상태 —`대기` \| `상담` \| `종료` \| `AI자동해결`       |
| summary        | TEXT        |                 | AI 요약 (자동 생성)                                                  |
| emotion        | VARCHAR(20) |                 | 감정 분석 —`평온` \| `기쁨` \| `슬픔` \| `화남` \| `짜증` |
| created_at     | TIMESTAMP   | DEFAULT NOW()   | 생성일시                                                             |
| closed_at      | TIMESTAMP   |                 | 종료일시                                                             |

### 비고

- `summary`, `emotion`은 AI 분석으로 자동 채워짐

**`category`** — `stores.category`에 따라 값이 다름:

| 업종 | category 값 |
|------|-------------|
| 병원 | `예약` \| `예약확인/변경/취소` \| `진료과목` |
| 식당 | `예약` \| `예약확인/변경/취소` \| `메뉴/가격` |
| 이커머스 | `배송조회,주문확인` \| `환불/교환/취소` \| `상품정보` |

---

## 4. messages (대화메시지)

| 컬럼명      | 타입        | 제약          | 설명                                        |
| ----------- | ----------- | ------------- | ------------------------------------------- |
| message_id  | SERIAL      | PK            | 메시지 고유번호                             |
| case_id     | INT         | FK → cases   | 소속 상담                                   |
| speaker     | VARCHAR(20) | NOT NULL      | 발화자 —`챗봇` \| `상담사` \| `고객` |
| content     | TEXT        | NOT NULL      | 메시지 내용                                 |
| occurred_at | TIMESTAMP   | DEFAULT NOW() | 발생일시                                    |

---

## 5. satisfactions (만족도)

| 컬럼명          | 타입      | 제약          | 설명                        |
| --------------- | --------- | ------------- | --------------------------- |
| satisfaction_id | SERIAL    | PK            | 만족도 고유번호             |
| case_id         | INT       | FK → cases   | 대상 상담                   |
| store_id        | INT       | FK → stores  | 가게                        |
| score           | NUMBER    | NOT NULL      | 점수 —`0.5-5 (0.5 간격)` |
| collected_at    | TIMESTAMP | DEFAULT NOW() | 수집일시                    |

---

## 6. manuals (규정)

| 컬럼명    | 타입         | 제약          | 설명                                       |
| --------- | ------------ | ------------- | ------------------------------------------ |
| manual_id | SERIAL       | PK            | 매뉴얼 고유번호                            |
| store_id  | INT          | FK → stores  | 소속 가게                                  |
| title     | VARCHAR(200) | NOT NULL      | 제목                                       |
| category  | VARCHAR(50)  | NOT NULL      | 카테고리 — cases.category와 동일 (업종별 상이) |
| content   | TEXT         | NOT NULL      | 본문 내용                                  |
| edited_at | TIMESTAMP    | DEFAULT NOW() | 수정일시                                   |
| file_hash | VARCHAR(64)  | NOT NULL      | 파일 수정 시 재벡터화 감지용 해시          |

### 비고

- S3로 마크다운 파일 자체를 저장하는 것이 아닌 내용 전체를 content에 넣음.
- `file_hash` — 파일 변경 여부 감지 → 임베딩 재생성 트리거용

---

## 7. orders (주문)

| 컬럼명      | 타입        | 제약            | 설명                                                                 |
| ----------- | ----------- | --------------- | -------------------------------------------------------------------- |
| order_id    | SERIAL      | PK              | 주문 고유번호                                                        |
| customer_id | INT         | FK → customers | 고객                                                                 |
| store_id    | INT         | FK → stores    | 가게                                                                 |
| status      | VARCHAR(20) | NOT NULL        | 주문 상태 —`준비` \| `배송` \| `완료` \| `반품` \| `취소` |
| total_price | INT         | NOT NULL        | 총 금액 (자동계산)                                                   |
| ordered_at  | TIMESTAMP   | DEFAULT NOW()   | 주문일시                                                             |

---

## 8. items (주문품목)

| 컬럼명      | 타입   | 제약           | 설명                                            |
| ----------- | ------ | -------------- | ----------------------------------------------- |
| item_id     | SERIAL | PK             | 주문품목 고유번호                               |
| order_id    | INT    | FK → orders   | 소속 주문                                       |
| product_id  | INT    | FK → products | 상품                                            |
| quantity    | INT    | NOT NULL       | 수량                                            |
| total_price | INT    |                | 품목 금액 (자동계산: quantity × product.price) |

---

## 9. products (상품)

| 컬럼명     | 타입         | 제약         | 설명          |
| ---------- | ------------ | ------------ | ------------- |
| product_id | SERIAL       | PK           | 상품 고유번호 |
| store_id   | INT          | FK → stores | 소속 가게     |
| name       | VARCHAR(200) | NOT NULL     | 상품명        |
| price      | INT          | NOT NULL     | 단가          |

---

## 10. shipments (배송)

| 컬럼명       | 타입        | 제약         | 설명          |
| ------------ | ----------- | ------------ | ------------- |
| shipment_id  | SERIAL      | PK           | 배송 고유번호 |
| order_id     | INT         | FK → orders | 소속 주문     |
| store_id     | INT         | FK → stores | 가게          |
| tracking_no  | VARCHAR(50) |              | 운송장 번호   |
| carrier      | VARCHAR(50) |              | 택배사        |
| promised_at  | TIMESTAMP   |              | 배송예정일시  |
| delivered_at | TIMESTAMP   |              | 배송완료일시  |

---

## 11. tracks (배송이력)

| 컬럼명      | 타입         | 제약            | 설명                                                                                       |
| ----------- | ------------ | --------------- | ------------------------------------------------------------------------------------------ |
| track_id    | SERIAL       | PK              | 배송이력 고유번호                                                                          |
| shipment_id | INT          | FK → shipments | 소속 배송                                                                                  |
| event_at    | TIMESTAMP    | NOT NULL        | 이벤트 발생일시                                                                            |
| event_type  | VARCHAR(50)  | NOT NULL        | 이벤트 종류 —`집하처리` \| `간선상차` \| `간선하차` \| `배송출고` \| `배송완료` |
| location    | VARCHAR(100) | NOT NULL        | 위치                                                                                       |

---

## 12. reservations (예약)

| 컬럼명         | 타입        | 제약            | 설명                             |
| -------------- | ----------- | --------------- | -------------------------------- |
| reservation_id | SERIAL      | PK              | 예약 고유번호                    |
| store_id       | INT         | FK → stores    | 가게                             |
| customer_id    | INT         | FK → customers | 고객                             |
| reserved_at    | TIMESTAMP   | NOT NULL        | 예약일시                         |
| status         | VARCHAR(20) | NOT NULL        | 예약 상태 —`완료` \| `취소` |
| headcount      | INT         |                 | 인원수                           |

---

## 13. 관계 다이어그램

```
stores (1)
  ├──< customers (N)        store_id
  ├──< cases (N)            store_id
  ├──< orders (N)           store_id
  ├──< shipments (N)        store_id
  ├──< manuals (N)          store_id
  ├──< products (N)         store_id
  ├──< reservations (N)     store_id
  └──< satisfactions (N)    store_id

customers (1)
  ├──< cases (N)            customer_id
  ├──< orders (N)           customer_id
  └──< reservations (N)     customer_id

cases (1)
  ├──< messages (N)         case_id
  ├──< satisfactions (N)    case_id
  ├──  order_id → orders.order_id
  └──  reservation_id → reservations.reservation_id

orders (1)
  ├──< items (N)            order_id
  └──< shipments (N)        order_id

shipments (1)
  └──< tracks (N)           shipment_id

products (1)
  └──< items (N)            product_id
```
