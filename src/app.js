import express from 'express';
import dotenv from 'dotenv';
import setupSwagger from './swagger.js';

// 라우터 import
import agentsRouter from './routes/agents.js';
import casesRouter from './routes/cases.js';
import customersRouter from './routes/customers.js';
import manualsRouter from './routes/manuals.js';
import orderItemsRouter from './routes/order_items.js';
import ordersRouter from './routes/orders.js';
import productsRouter from './routes/products.js';
dotenv.config();
const app = express();
app.use(express.json({ type: ['application/json', 'application/merge-patch+json'] }));
app.use(express.urlencoded({ extended: true }));

// Swagger 연결
setupSwagger(app);

// 라우터 등록
app.use('/agents', agentsRouter);
app.use('/cases', casesRouter);
app.use('/customers', customersRouter);
app.use('/manuals', manualsRouter);
app.use('/order-items', orderItemsRouter);
app.use('/orders', ordersRouter);
app.use('/products', productsRouter);

// 서버 실행 - npm run dev
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 서버가 http://localhost:${PORT}에서 구동 중입니다.`);
  console.log(`📖 Swagger 문서는 http://localhost:${PORT}/api-docs 주소로 가세요.`);
});
