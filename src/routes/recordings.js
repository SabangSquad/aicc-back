import express from 'express';
const router = express.Router();

/**
 * @swagger
 * /recordings/{id}:
 *   get:
 *     summary: 특정 상담 녹취 조회
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 녹취 파일
 *         content:
 *           application/json:
 *             example:
 *               recording_id: 1
 *               case_id: 10
 *               file_url: "https://s3/recordings/rec1.mp3"
 */
router.get('/:id', (req, res) => {
  res.json({ recording_id: req.params.id, case_id: 10, file_url: "https://s3/recordings/rec1.mp3" });
});

export default router;
