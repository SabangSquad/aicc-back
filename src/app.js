import express from 'express';
import dotenv from 'dotenv';
import session from 'express-session';
import passport from 'passport';
import setupSwagger from './swagger.js';

// 인증 및 미들웨어
import { setupPassport } from './config/passport.js';
import { isAuthorized } from './middlewares/auth.js';

// 라우터 import
import authRouter from './routes/auth.js';
import agentsRouter from './routes/agents.js';
import casesRouter from './routes/cases.js';
import customersRouter from './routes/customers.js';
import manualsRouter from './routes/manuals.js';
import orderItemsRouter from './routes/order_items.js';
import ordersRouter from './routes/orders.js';
import productsRouter from './routes/products.js';
import chatRouter from './routes/chat.js';

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
    secure: true, // HTTPS 환경
    httpOnly: true,
    sameSite: 'lax' // 크로스 사이트 요청 이슈 방지
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

// 5. 권한 적용
app.use(isAuthorized);

// 6. 모든 라우터 등록
app.use('/agents', agentsRouter);
app.use('/cases', casesRouter);
app.use('/customers', customersRouter);
app.use('/manuals', manualsRouter);
app.use('/order-items', orderItemsRouter);
app.use('/orders', ordersRouter);
app.use('/products', productsRouter);
app.use('/chat', chatRouter);

// 서버 실행
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 서버가 http://localhost:${PORT}에서 구동 중입니다.`);
  console.log(`📖 Swagger: http://localhost:${PORT}/api-docs`);
});