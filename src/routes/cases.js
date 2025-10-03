import express from 'express';
const router = express.Router();

/**
 * @swagger
 * /cases:
 *   get:
 *     summary: 상담 케이스 조회
 *     parameters:
 *       - in: query
 *         name: agent_id
 *         schema: { type: integer }
 *       - in: query
 *         name: customer_id
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 상담 목록
 *         content:
 *           application/json:
 *             example:
 *               - cases_id: 1
 *                 customer_id: 1
 *                 agent_id: 2
 *                 title: "배송 지연"
 *                 status: "open"
 */
router.get('/', (req, res) => {
  res.json([{ cases_id: 1, customer_id: req.query.customer_id || 1, agent_id: req.query.agent_id || 2, title: "배송 지연", status: "open" }]);
});

export default router;
