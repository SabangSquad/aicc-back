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
 * /orders/{id}:
 *   get:
 *     summary: "특정 주문 조회"
 *     tags:
 *       - Orders
 *     parameters:
 *       - in: path
 *         name: id
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
 *                 customer_id:
 *                   type: integer
 *                 status:
 *                   type: string
 *                 total_amount:
 *                   type: number
 *                   format: float
 *                 ordered_at:
 *                   type: string
 *                   format: date-time
 *             example:
 *               order_id: 1
 *               customer_id: 1
 *               status: "완료"
 *               total_amount: 20000
 *               ordered_at: "2025-10-09T03:00:00Z"
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "주문 없음"
 *       500:
 *         description: "서버 오류"
 *   patch:
 *     summary: "특정 주문 상태 변경"
 *     tags:
 *       - Orders
 *     parameters:
 *       - in: path
 *         name: id
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
 *                 description: "새 주문 상태"
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
 *                 order_id:
 *                   type: integer
 *                 status:
 *                   type: string
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "주문 없음"
 *       500:
 *         description: "서버 오류"
 *   delete:
 *     summary: "특정 주문 삭제"
 *     tags:
 *       - Orders
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "주문 ID"
 *     responses:
 *       200:
 *         description: "삭제 성공"
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "주문 없음"
 *       500:
 *         description: "서버 오류"
 */

/**
 * @swagger
 * /orders/{id}/status:
 *   get:
 *     summary: "주문 상태 조회"
 *     description: "해당 주문의 상태만 반환합니다."
 *     tags:
 *       - Orders
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "주문 ID"
 *     responses:
 *       200:
 *         description: "주문 상태"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 order_id:
 *                   type: integer
 *                 status:
 *                   type: string
 *             example:
 *               order_id: 1
 *               status: "완료"
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "주문 없음"
 *       500:
 *         description: "서버 오류"
 */

router.get('/:id', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
    }

    const sql = `
      SELECT order_id, customer_id, status, total_amount, ordered_at
      FROM orders
      WHERE order_id = $1
    `;
    const { rows } = await pool.query(sql, [orderId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('주문 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.get('/:id/status', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
    }

    const sql = `SELECT order_id, status FROM orders WHERE order_id = $1`;
    const { rows } = await pool.query(sql, [orderId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('주문 상태 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
    }

    const { status } = req.body ?? {};
    if (typeof status !== 'string' || status.trim().length === 0) {
      return res.status(400).json({ error: 'status 필드는 비어있지 않은 문자열이어야 합니다.' });
    }
    const newStatus = status.trim();

    
    const allowed = ['배송준비', '배송중', '완료'];
    if (!allowed.includes(newStatus)) {
      return res.status(400).json({ error: `status는 ${allowed.join(', ')} 중 하나여야 합니다.` });
    }

    const sql = `
      UPDATE orders
      SET status = $1
      WHERE order_id = $2
      RETURNING order_id, status
    `;
    const { rows } = await pool.query(sql, [newStatus, orderId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('주문 상태 변경 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: '유효하지 않은 주문 ID입니다.' });
    }

    const del = await pool.query('DELETE FROM orders WHERE order_id = $1', [orderId]);
    if (del.rowCount === 0) {
      return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    }
    return res.json({ message: `order ${orderId} deleted` });
  } catch (err) {
    console.error('주문 삭제 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
