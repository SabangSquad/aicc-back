import express from 'express';
const router = express.Router();

/**
 * @swagger
 * /manuals:
 *   get:
 *     summary: 매뉴얼 전체 목록 조회
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 매뉴얼 목록
 *         content:
 *           application/json:
 *             example:
 *               - manual_id: 1
 *                 title: "배송 매뉴얼"
 *                 category: "배송"
 *                 edited_at: "2025-09-01"
 *                 file_path: "https://s3/manuals/shipping.md"
 *
 * /manuals/{id}:
 *   get:
 *     summary: 특정 매뉴얼 조회
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 매뉴얼 상세
 */
router.get('/', (req, res) => {
  res.json([{ manual_id: 1, title: "배송 매뉴얼", category: "배송", edited_at: "2025-09-01", file_path: "https://s3/manuals/shipping.md" }]);
});

router.get('/:id', (req, res) => {
  res.json({ manual_id: req.params.id, title: "배송 매뉴얼", category: "배송", edited_at: "2025-09-01", file_path: "https://s3/manuals/shipping.md" });
});

export default router;
