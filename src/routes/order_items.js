import express from 'express';
const router = express.Router();

/**
 * @swagger
 * /orders/{id}/items:
 *   get:
 *     summary: 특정 주문의 아이템 목록
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 아이템 목록
 *         content:
 *           application/json:
 *             example:
 *               - order_item_id: 1
 *                 order_id: 1
 *                 product_id: 101
 *                 quantity: 2
 *                 unit_price: 10000
 */
router.get('/orders/:id/items', (req, res) => {
  res.json([{ order_item_id: 1, order_id: req.params.id, product_id: 101, quantity: 2, unit_price: 10000 }]);
});

export default router;
