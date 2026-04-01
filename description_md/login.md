# 로그인/인증 시스템 정리

## 개요

Google OAuth 2.0 + Passport.js 기반 세션 인증. 역할(role)에 따라 API 접근 권한이 달라진다.

---

## 역할(Role)

| 역할 | 판별 기준 | 할 수 있는 것 |
|------|----------|--------------|
| ADMIN | `.env`의 `ADMIN_EMAIL`과 일치 | 모든 API 접근, Swagger UI |
| OWNER | `stores.email`과 일치 | 자기 가게 관리 (상담/주문/매뉴얼/솔루션 등) |
| CUSTOMER | `customers.email`과 일치 | 본인 정보 조회/수정, 본인 주문/예약/상담 조회 |
| 비로그인 | 로그인 안 함 | `/chats` (챗봇)만 가능 |
| AI(내부) | `x-internal-secret` 헤더 | 모든 API 접근 (bedrock.js가 API 호출 시 사용) |

---

## 로그인 흐름 → `src/routes/auth.js`

```
[1단계] 프론트에서 로그인 버튼 클릭
  → GET /auth/google                          ← src/routes/auth.js line 6
  → passport.authenticate('google') 호출
  → Google 로그인 페이지로 리다이렉트

[2단계] Google에서 로그인 완료
  → Google이 callback URL로 리다이렉트
  → GET /auth/google/callback                 ← src/routes/auth.js line 8

[3단계] Passport가 사용자 판별          ← src/config/passport.js line 14~44
  → Google profile에서 email 추출
  → 판별 순서:
     ① email === ADMIN_EMAIL?           → role: 'ADMIN'
     ② SELECT FROM stores WHERE email?  → role: 'OWNER' (+ store_id)
     ③ SELECT FROM customers WHERE email? → role: 'CUSTOMER' (+ customer_id)
     ④ 어디에도 없으면 → 403 "등록되지 않은 사용자"

[4단계] 세션에 사용자 정보 저장         ← src/config/passport.js line 47
  → passport.serializeUser(user) → 세션에 user 객체 저장
  → 쿠키(connect.sid)에 세션 ID 포함

[5단계] 프론트로 리다이렉트             ← src/routes/auth.js line 24
  → res.redirect(`${ROOT_URL}/home`)
```

---

## 세션에 저장되는 데이터

로그인 후 `req.user`에 담기는 정보:

```js
// ADMIN
{ email: "admin@example.com", name: "관리자", role: "ADMIN" }

// OWNER
{ store_id: 1, name: "에브리샵", email: "shop@example.com", role: "OWNER" }

// CUSTOMER
{ customer_id: 100, name: "김철수", email: "kim@example.com", role: "CUSTOMER" }
```

---

## 인증 상태 확인 → `src/routes/auth.js` GET "/status"

프론트에서 현재 로그인 상태를 확인할 때 사용:

```
GET /auth/status

로그인 됨 → 200 { isAuthenticated: true, user: { email, role, name } }
안 됨    → 401 { isAuthenticated: false }
```

---

## 로그아웃 → `src/routes/auth.js` GET "/logout"

```
GET /auth/logout
  → req.logout()                    세션에서 user 제거
  → req.session.destroy()           세션 완전 삭제
  → res.clearCookie('connect.sid')  쿠키 삭제
  → res.redirect(ROOT_URL)          메인 페이지로 이동
```

---

## 미들웨어 → `src/middlewares/auth.js`

### 미들웨어 종류

| 미들웨어 | 파일 위치 | 허용 대상 | 사용 위치 |
|---------|----------|----------|----------|
| `isAuthorized` | auth.js line 2 | 로그인 유저 + AI(x-internal-secret) | app.js — 전역 (line 59) |
| `isAdmin` | auth.js line 18 | ADMIN + AI | app.js — Swagger UI 접근 |
| `isOwner` | auth.js line 34 | OWNER + ADMIN + AI | customers.js POST (고객 추가) |
| `isStoreOwner` | auth.js line 42 | **해당 가게** OWNER + ADMIN + AI | stores.js PATCH/cases/orders 등 |
| `isCustomerOrOwner` | auth.js line 55 | 본인 CUSTOMER + OWNER + ADMIN + AI | customers.js GET/PATCH/cases/orders |

### 미들웨어 판단 흐름

```
요청 들어옴
  ↓
x-internal-secret 헤더 있음? → AI 내부 호출 → 통과
  ↓ (없음)
req.isAuthenticated()? → 로그인 안 됨 → 401
  ↓ (로그인 됨)
role 체크:
  isAuthorized     → 로그인만 되면 통과
  isAdmin          → role === 'ADMIN'만 통과
  isOwner          → role === 'OWNER' 또는 'ADMIN'만 통과
  isStoreOwner     → role === 'OWNER' AND store_id === req.params.store_id 만 통과
  isCustomerOrOwner → role === 'CUSTOMER' AND customer_id === req.params.customer_id, 또는 OWNER/ADMIN
```

---

## app.js에서 미들웨어 적용 순서 → `src/app.js`

```js
// 4. 공개 라우터 (인증 불필요)
app.use('/auth', authRouter);                    ← 로그인/로그아웃/상태확인

// 5. 챗봇 (비로그인 허용 — isAuthorized 앞에 배치)
app.use('/chats', chatLimiter, chatRouter);      ← 비로그인도 채팅 가능

// 6. 이 아래부터는 전부 로그인 필요
app.use(isAuthorized);                           ← 여기서 걸림

// 7. 라우터별로 추가 미들웨어
app.use('/stores', storesRouter);                ← 내부에서 isStoreOwner 적용
app.use('/cases', casesRouter);
app.use('/customers', customersRouter);          ← 내부에서 isCustomerOrOwner 적용
// ...
```

핵심: **`/auth`와 `/chats`는 `isAuthorized` 위에 있어서 비로그인 접근 가능.** 나머지는 전부 로그인 필요.

---

## AI 내부 호출 (x-internal-secret) → `src/bedrock.js` apiNode

AI가 내부 API를 호출할 때는 로그인 세션이 없다. 대신 `x-internal-secret` 헤더를 보낸다:

```js
// src/bedrock.js apiNode (line ~192)
const res = await axios({
  method: callInfo.m || 'GET',
  url: targetUrl,
  headers: {
    "x-internal-secret": process.env.INTERNAL_SECRET_KEY,  ← 이 헤더로 인증 통과
    "Content-Type": "application/json"
  }
});
```

모든 미들웨어(isAuthorized, isAdmin, isOwner 등)가 첫 줄에서 이 헤더를 체크하고 통과시킨다.

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/routes/auth.js` | 로그인/로그아웃/상태확인 엔드포인트 |
| `src/config/passport.js` | Google OAuth 전략 + 역할 판별 (ADMIN/OWNER/CUSTOMER) |
| `src/middlewares/auth.js` | 5개 미들웨어 (isAuthorized, isAdmin, isOwner, isStoreOwner, isCustomerOrOwner) |
| `src/app.js` | 미들웨어 적용 순서 (공개→챗봇→인증→라우터) |
| `src/bedrock.js` | AI 내부 호출 시 x-internal-secret 사용 |
| `.env` | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ADMIN_EMAIL, INTERNAL_SECRET_KEY |
