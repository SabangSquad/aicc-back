// src/routes/orders.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

const ORDER_STATUSES = new Set(['준비', '배송', '완료', '반품', '취소']);

/**
 * @swagger
 * tags:
 *   - name: Orders
 *     description: "주문 API"
 */

/**
 * @swagger
 * /orders:
 *   post:
 *     summary: "주문 추가"
 *     tags: [Orders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer_id, store_id]
 *             properties:
 *               customer_id: { type: integer }
 *               store_id: { type: integer }
 *     responses:
 *       201: { description: "주문 생성 완료" }
 *       400: { description: "잘못된 요청" }
 */
router.post('/', async (req, res) => {
  const { customer_id, store_id } = req.body ?? {};

  if (!customer_id || !store_id) {
    return res.status(400).json({ error: '필수 입력값(customer_id, store_id)이 누락되었습니다.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO orders (customer_id, store_id, status, total_price, ordered_at)
       VALUES ($1, $2, '준비', 0, NOW())
       RETURNING order_id, customer_id, store_id, status, total_price, ordered_at`,
      [customer_id, store_id]
    );
    const newOrder = rows[0];
    return res.status(201).json({
      ...newOrder,
      _links: [
        { rel: 'self', href: '/orders', method: 'POST' },
        { rel: 'get_order', href: `/orders/${newOrder.order_id}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('주문 생성 오류:', err);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /orders/{order_id}:
 *   get:
 *     summary: "주문 정보 조회"
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "주문 정보" }
 *       404: { description: "주문 없음" }
 *   patch:
 *     summary: "주문 상태 수정"
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: ["준비","배송","완료","반품","취소"] }
 *     responses:
 *       200: { description: "수정된 주문" }
 *       400: { description: "잘못된 요청" }
 *       404: { description: "주문 없음" }
 *   delete:
 *     summary: "주문 삭제"
 *     description: "주문 내 상품, 배송, 배송이력도 함께 삭제됩니다."
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "삭제 성공" }
 *       404: { description: "주문 없음" }
 */
router.route('/:order_id')
  .get(async (req, res) => {
    try {
      const orderId = parseInt(req.params.order_id, 10);
      if (Number.isNaN(orderId)) {
        return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
      }

      const { rows } = await pool.query(
        `SELECT order_id, customer_id, store_id, ordered_at, status, total_price
         FROM orders WHERE order_id = $1`,
        [orderId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
      }

      return res.json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/orders/${orderId}`, method: 'GET' },
          { rel: 'update', href: `/orders/${orderId}`, method: 'PATCH' },
          { rel: 'delete', href: `/orders/${orderId}`, method: 'DELETE' },
          { rel: 'items', href: `/orders/${orderId}/items`, method: 'GET' },
          { rel: 'shipments', href: `/orders/${orderId}/shipments`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('주문 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .patch(async (req, res) => {
    try {
      const orderId = parseInt(req.params.order_id, 10);
      if (Number.isNaN(orderId)) {
        return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
      }

      const { status } = req.body ?? {};
      if (typeof status !== 'string' || status.trim().length === 0) {
        return res.status(400).json({ error: 'status 필드는 비어있지 않은 문자열이어야 합니다.' });
      }
      const newStatus = status.trim();
      if (!ORDER_STATUSES.has(newStatus)) {
        return res.status(400).json({ error: `status는 ${[...ORDER_STATUSES].join(', ')} 중 하나여야 합니다.` });
      }

      const { rows } = await pool.query(
        `UPDATE orders SET status = $1 WHERE order_id = $2
         RETURNING order_id, ordered_at, status, total_price`,
        [newStatus, orderId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
      }

      return res.json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/orders/${orderId}`, method: 'PATCH' },
          { rel: 'get_order', href: `/orders/${orderId}`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('주문 상태 변경 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .delete(async (req, res) => {
    const orderId = parseInt(req.params.order_id, 10);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // tracks → shipments → items → orders 순서로 캐스케이드 삭제
      await client.query(
        'DELETE FROM tracks WHERE shipment_id IN (SELECT shipment_id FROM shipments WHERE order_id = $1)',
        [orderId]
      );
      await client.query('DELETE FROM shipments WHERE order_id = $1', [orderId]);
      await client.query('DELETE FROM items WHERE order_id = $1', [orderId]);
      const delOrder = await client.query('DELETE FROM orders WHERE order_id = $1', [orderId]);
      if (delOrder.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
      }
      await client.query('COMMIT');
      return res.json({
        message: `order ${orderId} deleted`,
        _links: [{ rel: 'list', href: '/orders', method: 'GET' }]
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('주문 삭제 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    } finally {
      client.release();
    }
  });


/**
 * @swagger
 * /orders/{order_id}/shipments:
 *   get:
 *     summary: "주문 배송 정보 조회"
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "배송 목록" }
 */
router.get('/:order_id/shipments', async (req, res) => {
  try {
    const orderId = parseInt(req.params.order_id, 10);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
    }

    const { rows } = await pool.query(
      `SELECT shipment_id, order_id, store_id, tracking_no, carrier,
              promised_at, delivered_at
       FROM shipments WHERE order_id = $1`,
      [orderId]
    );

    return res.json({
      data: rows,
      _links: [
        { rel: 'self', href: `/orders/${orderId}/shipments`, method: 'GET' },
        { rel: 'order', href: `/orders/${orderId}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('주문 배송 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /orders/{order_id}/items:
 *   get:
 *     summary: "주문품목 목록 조회"
 *     description: "주문에 포함된 품목 목록을 반환합니다. products 테이블과 조인해 상품명(product_name)을 함께 제공합니다."
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: "주문품목 목록"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       item_id: { type: integer, example: 1 }
 *                       order_id: { type: integer, example: 8 }
 *                       product_id: { type: integer, example: 12 }
 *                       product_name:
 *                         type: string
 *                         nullable: true
 *                         description: "상품명 (상품이 삭제됐으면 null)"
 *                         example: "프리미엄 로스팅 원두 200g"
 *                       quantity: { type: integer, example: 2 }
 *                       total_price: { type: integer, example: 30000 }
 *                 _links:
 *                   type: array
 *                   items: { type: object }
 *       404: { description: "주문품목 없음" }
 *   post:
 *     summary: "주문품목 추가"
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_id, quantity]
 *             properties:
 *               product_id: { type: integer }
 *               quantity: { type: integer }
 *     responses:
 *       201: { description: "주문품목 추가 완료" }
 *       400: { description: "잘못된 요청" }
 */
router.route('/:order_id/items')
  .get(async (req, res) => {
    try {
      const orderId = parseInt(req.params.order_id, 10);
      if (Number.isNaN(orderId)) {
        return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
      }

      const { rows } = await pool.query(
        `SELECT i.item_id, i.order_id, i.product_id, p.name AS product_name,
                i.quantity, i.total_price
         FROM items i
         LEFT JOIN products p ON p.product_id = i.product_id
         WHERE i.order_id = $1`,
        [orderId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: '주문 품목을 찾을 수 없습니다.' });
      }

      return res.json({
        data: rows,
        _links: [
          { rel: 'self', href: `/orders/${orderId}/items`, method: 'GET' },
          { rel: 'order', href: `/orders/${orderId}`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('주문 품목 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .post(async (req, res) => {
    const orderId = Number.parseInt(req.params.order_id, 10);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
    }

    const { product_id, quantity } = req.body ?? {};
    if (!Number.isInteger(product_id)) {
      return res.status(400).json({ error: 'product_id의 형식은 integer이어야 합니다.' });
    }
    if (!Number.isInteger(quantity)) {
      return res.status(400).json({ error: 'quantity의 형식은 integer이어야 합니다.' });
    }

    try {
      // 상품 가격 조회 → total_price 계산
      const prodRes = await pool.query('SELECT price FROM products WHERE product_id = $1', [product_id]);
      if (prodRes.rows.length === 0) {
        return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
      }
      const totalPrice = prodRes.rows[0].price * quantity;

      const { rows } = await pool.query(
        `INSERT INTO items (order_id, product_id, quantity, total_price)
         VALUES ($1, $2, $3, $4)
         RETURNING item_id, order_id, product_id, quantity, total_price`,
        [orderId, product_id, quantity, totalPrice]
      );
      return res.status(201).json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/orders/${orderId}/items`, method: 'POST' },
          { rel: 'order', href: `/orders/${orderId}`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('주문 품목 추가 오류:', err);
      return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
    }
  });


/**
 * @swagger
 * /orders/{order_id}/items/{item_id}:
 *   patch:
 *     summary: "주문품목 수량 수정"
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: item_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity]
 *             properties:
 *               quantity: { type: integer }
 *     responses:
 *       200: { description: "수정된 주문품목" }
 *       404: { description: "주문품목 없음" }
 *   delete:
 *     summary: "주문품목 삭제"
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: item_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "삭제 성공" }
 *       404: { description: "주문품목 없음" }
 */
router.route('/:order_id/items/:item_id')
  .patch(async (req, res) => {
    try {
      const orderId = parseInt(req.params.order_id, 10);
      const itemId  = parseInt(req.params.item_id, 10);
      if (Number.isNaN(orderId) || Number.isNaN(itemId)) {
        return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
      }

      const { quantity } = req.body ?? {};
      if (!Number.isInteger(quantity)) {
        return res.status(400).json({ error: 'quantity의 형식은 integer이어야 합니다.' });
      }

      const { rows } = await pool.query(
        `UPDATE items SET quantity = $1
         WHERE item_id = $2 AND order_id = $3
         RETURNING item_id, order_id, product_id, quantity, total_price`,
        [quantity, itemId, orderId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: '주문 품목을 찾을 수 없습니다.' });
      }

      return res.json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/orders/${orderId}/items/${itemId}`, method: 'PATCH' },
          { rel: 'order', href: `/orders/${orderId}`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('주문 품목 수정 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .delete(async (req, res) => {
    try {
      const orderId = parseInt(req.params.order_id, 10);
      const itemId  = parseInt(req.params.item_id, 10);
      if (Number.isNaN(orderId) || Number.isNaN(itemId)) {
        return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
      }

      const del = await pool.query(
        'DELETE FROM items WHERE item_id = $1 AND order_id = $2',
        [itemId, orderId]
      );
      if (del.rowCount === 0) {
        return res.status(404).json({ error: '주문 품목을 찾을 수 없습니다.' });
      }

      return res.status(200).json({
        message: `item ${itemId} deleted`,
        _links: [{ rel: 'order_items', href: `/orders/${orderId}/items`, method: 'GET' }]
      });
    } catch (err) {
      console.error('주문 품목 삭제 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });

export default router;
