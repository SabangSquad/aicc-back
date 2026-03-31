import express from 'express';
import dotenv from 'dotenv';
import session from 'express-session';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import setupSwagger from './swagger.js';

// 인증 및 미들웨어
import { setupPassport } from './config/passport.js';
import { isAuthorized, isAdmin } from './middlewares/auth.js';

// 라우터 import
import authRouter         from './routes/auth.js';
import casesRouter        from './routes/cases.js';
import customersRouter    from './routes/customers.js';
import manualsRouter      from './routes/manuals.js';
import ordersRouter       from './routes/orders.js';
import productsRouter     from './routes/products.js';
import chatRouter         from './routes/chat.js';
import storesRouter       from './routes/stores.js';
import shipmentsRouter    from './routes/shipments.js';
import reservationsRouter from './routes/reservations.js';

dotenv.config();
const app = express();

app.set('trust proxy', 1);
app.use(express.json({ type: ['application/json', 'application/merge-patch+json'] }));
app.use(express.urlencoded({ extended: true }));

// 1. 세션 설정
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  },
}));

// 2. Passport 초기화
app.use(passport.initialize());
app.use(passport.session());
setupPassport();

// 3. Swagger
app.use('/api-docs', isAdmin);
setupSwagger(app);

// 4. 공개 라우터
app.use('/auth', authRouter);

// 5. 챗봇 — isAuthorized 앞 (비로그인 허용) + Rate Limiting
const chatLimiter = rateLimit({ windowMs: 60000, max: 10, message: { error: '요청이 너무 많습니다. 1분 후 다시 시도해주세요.' } });
app.use('/chats', chatLimiter, chatRouter);

// 6. 권한 적용
app.use(isAuthorized);

// 7. 모든 라우터 등록
app.use('/stores',       storesRouter);
app.use('/cases',        casesRouter);
app.use('/customers',    customersRouter);
app.use('/manuals',      manualsRouter);
app.use('/orders',       ordersRouter);
app.use('/products',     productsRouter);
app.use('/shipments',    shipmentsRouter);
app.use('/reservations', reservationsRouter);

// 8. 중앙 에러 핸들러
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || '서버 오류가 발생했습니다.' });
});

// 서버 실행
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 서버가 http://localhost:${PORT}에서 구동 중입니다.`);
  console.log(`📖 Swagger: http://localhost:${PORT}/api-docs`);

  // LangGraph 체크포인터 테이블 자동 생성
  try {
    const { initializeCheckpointer } = await import('./bedrock.js');
    await initializeCheckpointer();
  } catch (err) {
    console.error('체크포인터 초기화 실패:', err.message);
  }
});
