import express from 'express';
const router = express.Router();

/**
 * @swagger
 * /orders/{id}:
 *   get:
 *     summary: 특정 주문 조회
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 주문 ID
 *     responses:
 *       200:
 *         description: 주문 정보
 *         content:
 *           application/json:
 *             example:
 *               order_id: 1
 *               customer_id: 1
 *               status: "processing"
 *               total_amount: 20000
 *   patch:
 *     summary: 특정 주문 상태 변경
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           example:
 *             status: "delivered"
 *     responses:
 *       200:
 *         description: 수정된 주문
 *   delete:
 *     summary: 특정 주문 삭제
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: 삭제 성공
 */
router.get('/:id', (req, res) => {
  res.json({ order_id: req.params.id, customer_id: 1, status: "processing", total_amount: 20000 });
});

router.patch('/:id', (req, res) => {
  res.json({ order_id: req.params.id, status: req.body.status || "updated" });
});

router.delete('/:id', (req, res) => {
  res.json({ message: `order ${req.params.id} deleted` });
});

export default router;
