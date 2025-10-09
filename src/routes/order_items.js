// src/routes/order_items.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: OrderItems
 *     description: 주문 품목 API
 */

/**
 * @swagger
 * /order-items/{order_id}:
 *   get:
 *     summary: 주문한 물품 조회
 *     tags:
 *       - OrderItems
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 주문 ID
 *     responses:
 *       200:
 *         description: 해당 주문의 품목 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   order_item_id:
 *                     type: integer
 *                   order_id:
 *                     type: integer
 *                   product_id:
 *                     type: integer
 *                   quantity:
 *                     type: integer
 *                   unit_price:
 *                     type: number
 *                     format: float
 *       400:
 *         description: 잘못된 요청
 *       404:
 *         description: 주문 없음
 *       500:
 *         description: 서버 오류
 */
router.get('/:order_id', async (req, res) => {
  try {
    const orderId = parseInt(req.params.order_id, 10);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
    }

    const exist = await pool.query('SELECT 1 FROM orders WHERE order_id = $1', [orderId]);
    if (exist.rowCount === 0) {
      return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    }

    const { rows } = await pool.query(
      `SELECT order_item_id, order_id, product_id, quantity, unit_price
       FROM order_items
       WHERE order_id = $1
       ORDER BY order_item_id ASC`,
      [orderId]
    );

    return res.json(rows);
  } catch (err) {
    console.error('주문 품목 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /order-items/{order_id}:
 *   post:
 *     summary: 주문할 물품 추가
 *     description: 이미 같은 상품이 존재하면 해당 품목의 수량에 더합니다.
 *     tags:
 *       - OrderItems
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 주문 ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - product_id
 *               - quantity
 *               - unit_price
 *             properties:
 *               product_id:
 *                 type: integer
 *               quantity:
 *                 type: integer
 *               unit_price:
 *                 type: number
 *                 format: float
 *           example:
 *             product_id: 101
 *             quantity: 2
 *             unit_price: 10000
 *     responses:
 *       201:
 *         description: 품목이 추가(또는 수량 합산)되었습니다.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 order_item_id:
 *                   type: integer
 *                 order_id:
 *                   type: integer
 *                 product_id:
 *                   type: integer
 *                 quantity:
 *                   type: integer
 *                 unit_price:
 *                   type: number
 *                   format: float
 *       400:
 *         description: 잘못된 요청
 *       404:
 *         description: 주문 없음
 *       500:
 *         description: 서버 오류
 */
router.post('/:order_id', async (req, res) => {
  const client = await pool.connect();
  try {
    const orderId = parseInt(req.params.order_id, 10);
    const { product_id, quantity, unit_price } = req.body ?? {};

    if (Number.isNaN(orderId)) {
      client.release();
      return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
    }
    const productId = parseInt(product_id, 10);
    const qty = parseInt(quantity, 10);
    const price = Number(unit_price);

    if (!Number.isInteger(productId) || productId <= 0) {
      client.release();
      return res.status(400).json({ error: 'product_id는 양의 정수여야 합니다.' });
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      client.release();
      return res.status(400).json({ error: 'quantity는 양의 정수여야 합니다.' });
    }
    if (!Number.isFinite(price) || price < 0) {
      client.release();
      return res.status(400).json({ error: 'unit_price는 0 이상 숫자여야 합니다.' });
    }

    await client.query('BEGIN');

    const exist = await client.query('SELECT 1 FROM orders WHERE order_id = $1', [orderId]);
    if (exist.rowCount === 0) {
      await client.query('ROLLBACK'); client.release();
      return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    }

    const found = await client.query(
      `SELECT order_item_id, quantity, unit_price
       FROM order_items
       WHERE order_id = $1 AND product_id = $2
       FOR UPDATE`,
      [orderId, productId]
    );

    let row;
    if (found.rowCount > 0) {
      const newQty = found.rows[0].quantity + qty;
      const upd = await client.query(
        `UPDATE order_items
         SET quantity = $1, unit_price = $2
         WHERE order_item_id = $3
         RETURNING order_item_id, order_id, product_id, quantity, unit_price`,
        [newQty, price, found.rows[0].order_item_id]
      );
      row = upd.rows[0];
    } else {
      const ins = await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)
         RETURNING order_item_id, order_id, product_id, quantity, unit_price`,
        [orderId, productId, qty, price]
      );
      row = ins.rows[0];
    }

    await client.query('COMMIT');
    return res.status(201).json(row);
  } catch (err) {
    try { await pool.query('ROLLBACK'); } catch (e) { /* ignore */ }
    console.error('주문 품목 추가 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  } finally {
    try { /* may be undefined if early return */ } catch (e) {}
    try { (await client)?.release?.(); } catch (e) {}
  }
});

/**
 * @swagger
 * /order-items/{order_id}:
 *   patch:
 *     summary: 주문할 물품 수정
 *     description: 수량(quantity)을 새 값으로 변경합니다.
 *     tags:
 *       - OrderItems
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 주문 ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - product_id
 *               - quantity
 *             properties:
 *               product_id:
 *                 type: integer
 *               quantity:
 *                 type: integer
 *           example:
 *             product_id: 101
 *             quantity: 5
 *     responses:
 *       200:
 *         description: 품목이 수정되었습니다.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 order_item_id:
 *                   type: integer
 *                 order_id:
 *                   type: integer
 *                 product_id:
 *                   type: integer
 *                 quantity:
 *                   type: integer
 *                 unit_price:
 *                   type: number
 *                   format: float
 *       400:
 *         description: 잘못된 요청
 *       404:
 *         description: 주문 또는 품목 없음
 *       500:
 *         description: 서버 오류
 */
router.patch('/:order_id', async (req, res) => {
  try {
    const orderId = parseInt(req.params.order_id, 10);
    const { product_id, quantity } = req.body ?? {};
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
    }
    const productId = parseInt(product_id, 10);
    const qty = parseInt(quantity, 10);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: 'product_id는 양의 정수여야 합니다.' });
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: 'quantity는 양의 정수여야 합니다.' });
    }

    const upd = await pool.query(
      `UPDATE order_items
       SET quantity = $1
       WHERE order_id = $2 AND product_id = $3
       RETURNING order_item_id, order_id, product_id, quantity, unit_price`,
      [qty, orderId, productId]
    );

    if (upd.rowCount === 0) {
      return res.status(404).json({ error: '해당 주문의 품목을 찾을 수 없습니다.' });
    }

    return res.json(upd.rows[0]);
  } catch (err) {
    console.error('주문 품목 수정 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /order-items/{order_id}:
 *   delete:
 *     summary: 주문할 물품 삭제
 *     description: 본문에 전달된 product_id에 해당하는 품목을 삭제합니다.
 *     tags:
 *       - OrderItems
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 주문 ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - product_id
 *             properties:
 *               product_id:
 *                 type: integer
 *           example:
 *             product_id: 101
 *     responses:
 *       200:
 *         description: 품목이 삭제되었습니다.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted:
 *                   type: boolean
 *                 order_id:
 *                   type: integer
 *                 product_id:
 *                   type: integer
 *       400:
 *         description: 잘못된 요청
 *       404:
 *         description: 주문 또는 품목 없음
 *       500:
 *         description: 서버 오류
 */
router.delete('/:order_id', async (req, res) => {
  try {
    const orderId = parseInt(req.params.order_id, 10);
    const { product_id } = req.body ?? {};
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
    }
    const productId = parseInt(product_id, 10);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: 'product_id는 양의 정수여야 합니다.' });
    }

    const del = await pool.query(
      `DELETE FROM order_items
       WHERE order_id = $1 AND product_id = $2`,
      [orderId, productId]
    );

    if (del.rowCount === 0) {
      return res.status(404).json({ error: '해당 주문의 품목을 찾을 수 없습니다.' });
    }

    return res.json({ deleted: true, order_id: orderId, product_id: productId });
  } catch (err) {
    console.error('주문 품목 삭제 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
