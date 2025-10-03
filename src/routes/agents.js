import express from 'express';
const router = express.Router();

/**
 * @swagger
 * /agents/{id}:
 *   get:
 *     summary: 상담원 상세 조회
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 상담원 ID
 *     responses:
 *       200:
 *         description: 상담원 정보
 *         content:
 *           application/json:
 *             example:
 *               agent_id: 1
 *               name: "김상담"
 *               status: "online"
 *               phone: "010-1111-2222"
 *               email: "agent@test.com"
 *   patch:
 *     summary: 상담원 상세 수정
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 상담원 ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           example:
 *             name: "김상담"
 *             status: "offline"
 *     responses:
 *       200:
 *         description: 수정된 상담원 정보
 *         content:
 *           application/json:
 *             example:
 *               agent_id: 1
 *               name: "김상담"
 *               status: "offline"
 */
router.get('/:id', (req, res) => {
  res.json({
    agent_id: req.params.id,
    name: "김상담",
    status: "online",
    phone: "010-1111-2222",
    email: "agent@test.com"
  });
});

router.patch('/:id', (req, res) => {
  res.json({ agent_id: req.params.id, ...req.body });
});

export default router;
