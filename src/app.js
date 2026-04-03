import express from 'express';
import dotenv from 'dotenv';
import session from 'express-session';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';
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

// 1. Redis + 세션 설정
const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.connect().catch(err => console.error('Redis 연결 실패:', err.message));
redisClient.on('error', err => console.error('Redis 오류:', err.message));

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 60 * 1000
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

  // 크론잡: 5분마다 30분 비활동 '상담' 케이스 자동 종료 (대기는 건드리지 않음)
  setInterval(async () => {
    try {
      const { rowCount } = await pool.query(`
        UPDATE cases SET status = '종료', closed_at = NOW()
        WHERE status = '상담'
          AND case_id IN (
            SELECT c.case_id FROM cases c
            LEFT JOIN (
              SELECT case_id, MAX(occurred_at) AS last_at
              FROM messages GROUP BY case_id
            ) m ON c.case_id = m.case_id
            WHERE c.status = '상담'
              AND (m.last_at < NOW() - INTERVAL '30 minutes'
                OR (m.last_at IS NULL AND c.created_at < NOW() - INTERVAL '30 minutes'))
          )
      `);
      if (rowCount > 0) console.log(`⏰ [크론잡] ${rowCount}건 상담 자동 종료`);
    } catch (err) {
      console.error('크론잡 오류:', err.message);
    }
  }, 5 * 60 * 1000);
});
