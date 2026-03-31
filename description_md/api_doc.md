# AICC-Back API 명세서

> 기준: 명세서.html 분석 + 현재 코드베이스(research.md) 대조
> 작성일: 2026-03-24

---

## 목차

1. [가게 (Stores)](#1-가게)
2. [상담 (Cases)](#2-상담)
3. [고객 (Customers)](#3-고객)
4. [매뉴얼 (Manuals)](#4-매뉴얼)
5. [주문 (Orders)](#5-주문)
6. [상품 (Products)](#6-상품)
7. [챗봇 (Chat)](#7-챗봇)
8. [배송 (Shipments)](#8-배송)
9. [예약 (Reservations)](#9-예약)

---

## 1. 가게

| 메서드 | 경로                                       | 설명                  | 필터/비고                      |
| ------ | ------------------------------------------ | --------------------- | ------------------------------ |
| POST   | `/stores`                                | 가게 추가             |                                |
| GET    | `/stores/{store_id}`                     | 가게 정보 조회        |                                |
| PATCH  | `/stores/{store_id}`                     | 가게 정보 수정        |                                |
| GET    | `/stores/{store_id}/cases`               | 가게 상담 목록 조회   | 상담 상태, 감정 상태, 카테고리, 시작/종료 시간 |
| GET    | `/stores/{store_id}/satisfactions`       | 가게 상담 만족도 조회 | 시작 시간, 종료 시간           |
| GET    | `/stores/{store_id}/orders`              | 가게 주문 조회        |                                |
| GET    | `/stores/{store_id}/reservations`        | 가게 예약 조회        |                                |
| GET    | `/stores/{store_id}/manuals`             | 가게 매뉴얼 조회      | 카테고리                       |
| POST   | `/stores/{store_id}/manuals`             | 매뉴얼 추가           |                                |
| PATCH  | `/stores/{store_id}/manuals/{manual_id}` | 매뉴얼 수정           |                                |
| GET    | `/stores/{store_id}/products`            | 가게 상품 조회        |                                |
| POST   | `/stores/{store_id}/products`            | 상품 추가             |                                |
| GET    | `/stores/{store_id}/solutions`           | 상담 솔루션 분석      | hours (1~24, 기본 24)          |

---

## 2. 상담

| 메서드 | 경로                               | 설명             | 필터/비고 |
| ------ | ---------------------------------- | ---------------- | --------- |
| POST   | `/cases`                         | 신규 상담 생성   |           |
| GET    | `/cases/{case_id}`               | 상담 정보 조회   |           |
| PATCH  | `/cases/{case_id}`               | 상담 정보 수정   |           |
| POST   | `/cases/{case_id}/satisfactions` | 상담 만족도 추가 |           |
| GET    | `/cases/{case_id}/satisfactions` | 상담 만족도 조회 |           |
| GET    | `/cases/{case_id}/messages`      | 상담 메시지 조회 |           |
| POST   | `/cases/{case_id}/messages`      | 상담 메시지 추가 |           |

---

## 3. 고객

| 메서드 | 경로                                      | 설명                | 필터/비고 |
| ------ | ----------------------------------------- | ------------------- | --------- |
| POST   | `/customers`                            | 고객 추가           |           |
| GET    | `/customers/{customer_id}`              | 고객 정보 조회      |           |
| PATCH  | `/customers/{customer_id}`              | 고객 정보 수정      |           |
| GET    | `/customers/{customer_id}/cases`        | 고객 상담 목록 조회 |           |
| GET    | `/customers/{customer_id}/orders`       | 고객 주문 목록 조회 |           |
| GET    | `/customers/{customer_id}/reservations` | 고객 예약 목록 조회 |           |

---

## 4. 매뉴얼

| 메서드 | 경로                     | 설명        | 필터/비고 |
| ------ | ------------------------ | ----------- | --------- |
| GET    | `/manuals/{manual_id}` | 매뉴얼 조회 |           |

---

## 5. 주문

| 메서드 | 경로                                   | 설명                               | 필터/비고 |
| ------ | -------------------------------------- | ---------------------------------- | --------- |
| POST   | `/orders`                            | 주문 추가                          |           |
| GET    | `/orders/{order_id}`                 | 주문 정보 조회                     |           |
| PATCH  | `/orders/{order_id}`                 | 주문 상태 수정                     |           |
| DELETE | `/orders/{order_id}`                 | 주문 삭제 (주문 내 상품 포함 삭제) |           |
| GET    | `/orders/{order_id}/shipments`       | 주문 배송 정보 조회                |           |
| GET    | `/orders/{order_id}/items`           | 주문품목 목록 조회                 |           |
| POST   | `/orders/{order_id}/items`           | 주문품목 추가                      |           |
| PATCH  | `/orders/{order_id}/items/{item_id}` | 주문품목 수량 수정                 |           |
| DELETE | `/orders/{order_id}/items/{item_id}` | 주문품목 삭제                      |           |

---

## 6. 상품

| 메서드 | 경로                       | 설명           | 필터/비고 |
| ------ | -------------------------- | -------------- | --------- |
| GET    | `/products/{product_id}` | 상품 단건 조회 |           |
| PATCH  | `/products/{product_id}` | 상품 정보 수정 |           |

---

## 7. 챗봇

| 메서드 | 경로                 | 설명                                   | 필터/비고                            |
| ------ | -------------------- | -------------------------------------- | ------------------------------------ |
| POST   | `/chats`                  | AI에 질문 → 답변 수신                  | 세션으로 caseId 유지, 없으면 신규 생성 |
| POST   | `/chats/{case_id}/close`  | 상담 종료 + 세션 초기화                | 비동기 AI 분석 (감정/요약) 자동 실행   |
| POST   | `/chats/{case_id}`        | 해당 상담 추천 답변 + 요약 + 감정 분석 | 결과 자동 DB 저장 (summary, emotion)   |

---

## 8. 배송

| 메서드 | 경로                                           | 설명                | 필터/비고 |
| ------ | ---------------------------------------------- | ------------------- | --------- |
| POST   | `/shipments`                                 | 배송 추가           |           |
| GET    | `/shipments/{shipment_id}`                   | 배송 단건 조회      |           |
| PATCH  | `/shipments/{shipment_id}`                   | 배송 정보 수정      |           |
| GET    | `/shipments/{shipment_id}/tracks`            | 상세 배송 정보 조회 |           |
| POST   | `/shipments/{shipment_id}/tracks`            | 상세 배송 추가      |           |
| PATCH  | `/shipments/{shipment_id}/tracks/{track_id}` | 상세 배송 이력 수정 |           |

---

## 9. 예약

| 메서드 | 경로                               | 설명           | 필터/비고 |
| ------ | ---------------------------------- | -------------- | --------- |
| POST   | `/reservations`                  | 예약 추가      |           |
| GET    | `/reservations/{reservation_id}` | 예약 단건 조회 |           |
| PATCH  | `/reservations/{reservation_id}` | 예약 수정      |           |
