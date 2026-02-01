// src/routes/orders.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Orders
 *     description: "주문 API"
 */

/**
 * @swagger
 * /orders/{order_id}:
 *   get:
 *     summary: "주문 정보 조회"
 *     tags:
 *       - Orders
 *     description: 해당 주문의 정보를 조회합니다.
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "주문 ID"
 *     responses:
 *       200:
 *         description: "주문 정보"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 order_id:
 *                   type: integer
 *                   description: 주문 ID
 *                 customer_id:
 *                   type: integer
 *                   description: 고객 ID
 *                 ordered_at:
 *                   type: string
 *                   format: date-time
 *                   description: 주문일
 *                 status:
 *                   type: string
 *                   description: 주문 상태
 *                 total_price:
 *                   type: integer
 *                   description: 전체 가격
 *                 _links:
 *                   type: array
 *                   items:
 *                     type: object
 *             example:
 *               order_id: 1
 *               customer_id: 1
 *               status: "완료"
 *               total_price: 20000
 *               ordered_at: "2025-09-01T04:08:31.231Z"
 *               _links:
 *                 - rel: "self"
 *                   href: "/orders/1"
 *                   method: "GET"
 *                 - rel: "update"
 *                   href: "/orders/1"
 *                   method: "PATCH"
 *                 - rel: "delete"
 *                   href: "/orders/1"
 *                   method: "DELETE"
 *                 - rel: "items"
 *                   href: "/orders/1/order-items"
 *                   method: "GET"
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "주문 없음"
 *       500:
 *         description: "서버 오류"
 *   patch:
 *     summary: "주문 상태 수정"
 *     description: 해당 주문의 상태를 수정합니다.
 *     tags:
 *       - Orders
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "주문 ID"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: ["준비", "배송", "완료"]
 *                 description: "주문 상태"
 *           example:
 *             status: "완료"
 *     responses:
 *       200:
 *         description: "수정된 주문"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ordered_at:
 *                   type: string
 *                   format: date-time
 *                   description: 주문일
 *                 status:
 *                   type: string
 *                   description: 주문 상태
 *                 total_price:
 *                   type: integer
 *                   description: 전체 가격
 *                 _links:
 *                   type: array
 *             example:
 *               ordered_at: "2025-09-01T04:08:31.231Z"
 *               status: "준비"
 *               total_price: 5000
 *               _links:
 *                 - rel: "self"
 *                   href: "/orders/1"
 *                   method: "PATCH"
 *                 - rel: "get_order"
 *                   href: "/orders/1"
 *                   method: "GET"
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "주문 없음"
 *       500:
 *         description: "서버 오류"
 *   delete:
 *     summary: "주문 삭제"
 *     description: 해당 주문을 삭제합니다. 주문 내 상품도 삭제됩니다.
 *     tags:
 *       - Orders
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "주문 ID"
 *     responses:
 *       200:
 *         description: "삭제 성공"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 _links:
 *                   type: array
 *             example:
 *               message: "order 1 deleted"
 *               _links:
 *                 - rel: "list"
 *                   href: "/orders"
 *                   method: "GET"
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "주문 없음"
 *       500:
 *         description: "서버 오류"
 */


router.get('/:order_id', async (req, res) => {
  try {
    const orderId = parseInt(req.params.order_id, 10);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
    }

    const sql = `
      SELECT order_id, customer_id, ordered_at, status, total_price
      FROM orders
      WHERE order_id = $1
    `;
    const { rows } = await pool.query(sql, [orderId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    }

    const orderData = rows[0];
    return res.json({
      ...orderData,
      _links: [
        { rel: 'self', href: `/orders/${orderId}`, method: 'GET' },
        { rel: 'update', href: `/orders/${orderId}`, method: 'PATCH' },
        { rel: 'delete', href: `/orders/${orderId}`, method: 'DELETE' },
        { rel: 'items', href: `/orders/${orderId}/order-items`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('주문 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.patch('/:order_id', async (req, res) => {
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

    
    const allowed = ['준비', '배송', '완료'];
    if (!allowed.includes(newStatus)) {
      return res.status(400).json({ error: `status는 ${allowed.join(', ')} 중 하나여야 합니다.` });
    }

    const sql = `
      UPDATE orders
      SET status = $1
      WHERE order_id = $2
      RETURNING order_id, ordered_at, status, total_price
    `;
    const { rows } = await pool.query(sql, [newStatus, orderId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    }

    const updatedOrder = rows[0];
    return res.json({
      ...updatedOrder,
      _links: [
        { rel: 'self', href: `/orders/${orderId}`, method: 'PATCH' },
        { rel: 'get_order', href: `/orders/${orderId}`, method: 'GET' },
        { rel: 'items', href: `/orders/${orderId}/order-items`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('주문 상태 변경 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.delete('/:order_id', async (req, res) => {
  const orderId = parseInt(req.params.order_id, 10);
  if (Number.isNaN(orderId)) {
    return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) 자식 먼저 삭제
    await client.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);

    // 2) 주문 삭제 (없으면 404)
    const delOrder = await client.query('DELETE FROM orders WHERE order_id = $1', [orderId]);
    if (delOrder.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    }

    await client.query('COMMIT');
    return res.json({ 
      message: `order ${orderId} deleted`,
      _links: [
        { rel: 'list', href: '/orders', method: 'GET' }
      ]
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
 * /orders/{order_id}/order-items:
 *   get:
 *     summary: "주문 상품 조회"
 *     tags:
 *       - Orders
 *     description: 해당 주문에 포함된 상품들을 조회합니다.
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "주문 ID"
 *     responses:
 *       200:
 *         description: "주문 정보"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 _links:
 *                   type: array
 *             example:
 *               data:
 *                 - order_item_id: 1
 *                   product_id: 1
 *                   quantity: 3
 *                   price: 25000
 *               _links:
 *                 - rel: "self"
 *                   href: "/orders/1/order-items"
 *                   method: "GET"
 *                 - rel: "order"
 *                   href: "/orders/1"
 *                   method: "GET"
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "주문 품목 없음"
 *       500:
 *         description: "서버 오류"
 *   post:
 *     summary: "주문 상품 추가"
 *     tags: [Orders]
 *     description: 해당 주문에 상품을 추가합니다.
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "주문 ID"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_id, quantity]
 *             properties:
 *               product_id:
 *                 type: integer
 *               quantity:
 *                 type: integer
 *           example:
 *             product_id: 1
 *             quantity: 3
 *     responses:
 *       201:
 *         description: "주문 품목 생성 완료"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 order_item_id:
 *                   type: integer
 *                   description: 주문 품목 ID
 *                 product_id:
 *                   type: integer
 *                   description: 상품 ID
 *                 quantity:
 *                   type: integer
 *                   description: 주문 수량
 *                 price:
 *                   type: integer
 *                   description: 총합 가격
 *                 _links:
 *                   type: array
 *             example:
 *               order_item_id: 1
 *               product_id: 1
 *               quantity: 3
 *               price: 50000
 *               _links:
 *                 - rel: "self"
 *                   href: "/orders/1/order-items"
 *                   method: "POST"
 *                 - rel: "order"
 *                   href: "/orders/1"
 *                   method: "GET"
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "해당 주문을 찾을 수 없음"
 *       500:
 *         description: "서버 오류"
 * 
 */


router.get('/:order_id/order-items', async (req, res) => {
  try {
    const orderId = parseInt(req.params.order_id, 10);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
    }

    const sql = `
      SELECT order_item_id, product_id, quantity, price
      FROM order_items
      WHERE order_id = $1
    `;
    const { rows } = await pool.query(sql, [orderId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '주문 품목을 찾을 수 없습니다.' });
    }

    return res.json({
      data: rows,
      _links: [
        { rel: 'self', href: `/orders/${orderId}/order-items`, method: 'GET' },
        { rel: 'order', href: `/orders/${orderId}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('주문 상품 조회 상세 오류:', err); // 이 줄을 추가해서 터미널 로그를 확인하세요!
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.post('/:order_id/order-items', async (req, res) => {

  const orderId = Number.parseInt(req.params.order_id, 10);
  if (Number.isNaN(orderId)) {
    return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
  }

  const { product_id, quantity } = req.body;

  if (!Number.isInteger(product_id)) {
    return res.status(400).json({ error: 'product_id의 형식은 integer이어야 합니다.' });
  }
  if (!Number.isInteger(quantity)) {
    return res.status(400).json({ error: 'quantity의 형식은 integer이어야 합니다.' });
  }
  try {

    const { rows } = await pool.query(
      `INSERT INTO order_items (order_id, product_id, quantity)
       VALUES ($1, $2, $3)
       RETURNING order_item_id, product_id, quantity, price`,
      [orderId, product_id, quantity]
    );

    const newItem = rows[0];
    res.status(201).json({
      ...newItem,
      _links: [
        { rel: 'self', href: `/orders/${orderId}/order-items`, method: 'POST' },
        { rel: 'order', href: `/orders/${orderId}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});


export default router;