import express from 'express';
const router = express.Router();

/**
 * @swagger
 * /cases/{case_id}/satisfaction:
 *   get:
 *     summary: 특정 상담 만족도 조회
 *     parameters:
 *       - in: path
 *         name: case_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 만족도 정보
 *         content:
 *           application/json:
 *             example:
 *               satisfaction_id: 1
 *               case_id: 10
 *               score: 5
 *               comment: "좋았습니다"
 *               collected_at: "2025-10-02"
 *   post:
 *     summary: 특정 상담 만족도 등록
 *     parameters:
 *       - in: path
 *         name: case_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           example:
 *             score: 4
 *             comment: "보통이었음"
 *     responses:
 *       201:
 *         description: 등록 성공
 */
router.get('/cases/:case_id/satisfaction', (req, res) => {
  res.json({ satisfaction_id: 1, case_id: req.params.case_id, score: 5, comment: "좋았습니다", collected_at: "2025-10-02" });
});

router.post('/cases/:case_id/satisfaction', (req, res) => {
  res.status(201).json({ satisfaction_id: 2, case_id: req.params.case_id, ...req.body });
});

export default router;
