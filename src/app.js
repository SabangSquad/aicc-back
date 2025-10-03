import express from 'express';
import dotenv from 'dotenv';
import setupSwagger from './swagger.js';

// 라우터 import
import manualsRouter from './routes/manuals.js';
import demandsRouter from './routes/demands.js';
import customersRouter from './routes/customers.js';
import ordersRouter from './routes/orders.js';
import orderItemsRouter from './routes/order_items.js';
import recordingsRouter from './routes/recordings.js';
import satisfactionRouter from './routes/satisfactions.js';
import casesRouter from './routes/cases.js';
import shipmentsRouter from './routes/shipments.js';
import agentsRouter from './routes/agents.js';
import shipmentEventsRouter from './routes/shipment_events.js';
import messagesRouter from './routes/messages.js';
import productsRouter from './routes/products.js';

dotenv.config();
const app = express();
app.use(express.json());

// Swagger 연결
setupSwagger(app);

// 라우터 등록
app.use('/manuals', manualsRouter);
app.use('/demands', demandsRouter);
app.use('/customers', customersRouter);
app.use('/orders', ordersRouter);
app.use('/order-items', orderItemsRouter);
app.use('/recordings', recordingsRouter);
app.use('/satisfactions', satisfactionRouter);
app.use('/cases', casesRouter);
app.use('/shipments', shipmentsRouter);
app.use('/agents', agentsRouter);
app.use('/shipment-events', shipmentEventsRouter);
app.use('/messages', messagesRouter);
app.use('/products', productsRouter);

// 서버 실행
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📖 Swagger docs at http://localhost:${PORT}/api-docs`);
});
