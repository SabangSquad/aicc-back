import express from 'express';
import dotenv from 'dotenv';
import session from 'express-session';
import passport from 'passport';  // Google 로그인
import rateLimit from 'express-rate-limit';  // 요청 제한
import { RedisStore } from 'connect-redis';  // 세션을 Redis에 저장
import { createClient } from 'redis';
import setupSwagger from './swagger.js';
import pool from './db.js';

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
const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });  // Redis 연결
redisClient.connect().catch(err => console.error('Redis 연결 실패:', err.message));
redisClient.on('error', err => console.error('Redis 오류:', err.message));

// 세션을 Redis에 저장
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,  // 변경 없으면 세션 재저장 X
  saveUninitialized: false,  // 빈 세션 저장 X
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 60 * 1000  // 30분 후 만료
  },
}));

// 2. Passport 초기화
app.use(passport.initialize());  // passport 시작
app.use(passport.session());  // 세션에서 req.user 복원
setupPassport();

// 3. Swagger
app.use('/api-docs', isAdmin);
setupSwagger(app);

// 4. 공개 라우터
app.use('/auth', authRouter);

// 5. 공개 라우터 — isAuthorized 앞 (비로그인 허용)
const chatLimiter = rateLimit({ windowMs: 60000, max: 10, message: { error: '요청이 너무 많습니다. 1분 후 다시 시도해주세요.' } });
app.use('/chats', chatLimiter, chatRouter);
app.use('/stores', storesRouter);  // GET /stores/:store_id는 공개, 나머지는 내부 isStoreOwner/isAdmin으로 보호

// 6. Health check (K8s liveness/readiness probe — 인증 불필요)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 7. 권한 적용
app.use(isAuthorized);
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
      // 30분 비활동 '상담' 케이스 조회
      const { rows: expiredCases } = await pool.query(`
        SELECT c.case_id,
          EXISTS (SELECT 1 FROM messages WHERE case_id = c.case_id AND speaker = '상담사') AS had_agent
        FROM cases c
        LEFT JOIN (
          SELECT case_id, MAX(occurred_at) AS last_at
          FROM messages GROUP BY case_id
        ) m ON c.case_id = m.case_id
        WHERE c.status = '상담'
          AND (m.last_at < NOW() - INTERVAL '30 minutes'
            OR (m.last_at IS NULL AND c.created_at < NOW() - INTERVAL '30 minutes'))
      `);

      for (const row of expiredCases) {
        // 상담사 개입 있었으면 '종료', 없었으면 'AI자동해결'
        const newStatus = row.had_agent ? '종료' : 'AI자동해결';
        await pool.query(
          'UPDATE cases SET status = $1, closed_at = NOW() WHERE case_id = $2',
          [newStatus, row.case_id]
        );

        // 비동기 AI 분석 (감정/요약)
        setImmediate(async () => {
          try {
            const { rows: msgs } = await pool.query(
              'SELECT speaker, content FROM messages WHERE case_id = $1 ORDER BY occurred_at ASC',
              [row.case_id]
            );
            if (!msgs.length) return;
            const { rows: storeRows } = await pool.query(
              'SELECT s.category FROM cases c LEFT JOIN stores s ON c.store_id = s.store_id WHERE c.case_id = $1',
              [row.case_id]
            );
            const storeCategory = storeRows[0]?.category || null;
            const { analyzeCaseConversation } = await import('./bedrock.js');
            const text = msgs.map(m => `${m.speaker}: ${m.content}`).join('\n');
            const analysis = await analyzeCaseConversation(text, storeCategory);
            await pool.query(
              'UPDATE cases SET emotion = $1, summary = $2, category = COALESCE($3, category) WHERE case_id = $4',
              [analysis.json?.emotion ?? null, analysis.json?.summary ?? null, analysis.json?.category ?? null, row.case_id]
            );
          } catch (err) {
            console.error(`[크론잡 분석] 케이스 ${row.case_id} 실패:`, err.message);
          }
        });
      }

      if (expiredCases.length > 0) console.log(`⏰ [크론잡] ${expiredCases.length}건 자동 종료`);
    } catch (err) {
      console.error('크론잡 오류:', err.message);
    }
  }, 5 * 60 * 1000);
});
