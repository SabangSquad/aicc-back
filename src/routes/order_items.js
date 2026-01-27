import express from 'express';
import pool from '../db.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: OrderItems
 *     description: "주문 상품 API"
 */

/**
 * @swagger
 * /order-items/{order_item_id}:
 *   patch:
 *     summary: "주문 상품 수량 수정"
 *     description: 해당 주문 상품의 수량을 수정합니다.
 *     tags:
 *       - OrderItems
 *     parameters:
 *       - in: path
 *         name: order_item_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "주문 상품 ID"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quantity
 *             properties:
 *               quantity:
 *                 type: integer
 *                 description: "주문 수량"
 *           example:
 *             quantity: 3
 *     responses:
 *       200:
 *         description: "수정된 주문 상품"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 order_id:
 *                   type: integer
 *                   description: 주문 ID
 *                 product_id:
 *                   type: integer
 *                   description: 상품 ID
 *                 quantity:
 *                   type: integer
 *                   description: 주문 수량
 *                 total_price:
 *                   type: integer
 *                   description: 전체 가격
 *                 _links:
 *                   type: array
 *                   items:
 *                     type: object
 *             example:
 *               order_id: 1
 *               product_id: 1
 *               quantity: 3
 *               total_price: 40000
 *               _links:
 *                 - rel: "self"
 *                   href: "/order-items/1"
 *                   method: "PATCH"
 *                 - rel: "delete"
 *                   href: "/order-items/1"
 *                   method: "DELETE"
 *                 - rel: "order"
 *                   href: "/orders/1"
 *                   method: "GET"
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "주문 상품 없음"
 *       500:
 *         description: "서버 오류"
 *   delete:
 *     summary: "주문 상품 삭제"
 *     description: 해당 주문 상품을 삭제합니다.
 *     tags:
 *       - OrderItems
 *     parameters:
 *       - in: path
 *         name: order_item_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "주문 상품 ID"
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
 *               message: "order_item 1 deleted"
 *               _links:
 *                 - rel: "order_list"
 *                   href: "/orders"
 *                   method: "GET"
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "주문 상품 없음"
 *       500:
 *         description: "서버 오류"
 */


router.patch('/:order_item_id', async (req, res) => {
  try {
    const orderItemId = parseInt(req.params.order_item_id, 10);
    if (Number.isNaN(orderItemId)) {
      return res.status(400).json({ error: '유효하지 않은 주문 상품 ID입니다.' });
    }

    let { quantity } = req.body ?? {};
    if (!Number.isInteger(quantity)) {
      return res.status(400).json({ error: 'quantity의 형식은 integer이어야 합니다.' });
    }

    const sql = `
      UPDATE order_items
      SET quantity = $1
      WHERE order_item_id = $2
      RETURNING order_id, product_id, quantity, total_price
    `;
    const { rows } = await pool.query(sql, [quantity, orderItemId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '주문 상품을 찾을 수 없습니다.' });
    }

    const updatedItem = rows[0];
    return res.json({
      ...updatedItem,
      _links: [
        { rel: 'self', href: `/order-items/${orderItemId}`, method: 'PATCH' },
        { rel: 'delete', href: `/order-items/${orderItemId}`, method: 'DELETE' },
        { rel: 'order', href: `/orders/${updatedItem.order_id}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('주문 상품 수량 수정 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.delete('/:order_item_id', async (req, res) => {
  try {
    const orderItemId = parseInt(req.params.order_item_id, 10);
    if (Number.isNaN(orderItemId)) {
      return res.status(400).json({ error: '유효하지 않은 주문 상품 ID입니다.' });
    }

    const del = await pool.query(
      'DELETE FROM order_items WHERE order_item_id = $1',
      [orderItemId]
    );
    if (del.rowCount === 0) {
      return res.status(404).json({ error: '주문 상품을 찾을 수 없습니다.' });
    }
    return res.status(200).json({ 
      message: `order_item ${orderItemId} deleted`,
      _links: [
        { rel: 'order_list', href: '/orders', method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('주문 상품 삭제 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});


export default router;