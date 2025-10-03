import express from 'express';
const router = express.Router();

/**
 * @swagger
 * /cases/{case_id}/messages:
 *   get:
 *     summary: 특정 상담의 메시지 조회
 *     parameters:
 *       - in: path
 *         name: case_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 케이스 ID
 *     responses:
 *       200:
 *         description: 메시지 목록
 *         content:
 *           application/json:
 *             example:
 *               - messages_id: 1
 *                 case_id: 10
 *                 content: "배송 늦어요"
 *                 speaker: "customer"
 *   post:
 *     summary: 특정 상담에 메시지 추가
 *     parameters:
 *       - in: path
 *         name: case_id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           example:
 *             content: "안녕하세요"
 *             speaker: "agent"
 *     responses:
 *       201:
 *         description: 생성된 메시지
 */
router.get('/cases/:case_id/messages', (req, res) => {
  res.json([{ messages_id: 1, case_id: req.params.case_id, content: "배송 늦어요", speaker: "customer" }]);
});

router.post('/cases/:case_id/messages', (req, res) => {
  res.status(201).json({ messages_id: 2, case_id: req.params.case_id, ...req.body });
});

export default router;
