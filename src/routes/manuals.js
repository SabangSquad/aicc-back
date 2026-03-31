// src/routes/manuals.js
// GET /manuals/:manual_id — 매뉴얼 단건 조회
// (목록/추가/수정은 /stores/:store_id/manuals 하위로 이동)
import express from 'express';
import pool from '../db.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Manuals
 *     description: "매뉴얼 API"
 */

/**
 * @swagger
 * /manuals/{manual_id}:
 *   get:
 *     summary: "매뉴얼 단건 조회"
 *     tags: [Manuals]
 *     parameters:
 *       - in: path
 *         name: manual_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "매뉴얼 정보" }
 *       404: { description: "매뉴얼 없음" }
 */
router.get('/:manual_id', async (req, res) => {
  try {
    const manualId = Number.parseInt(req.params.manual_id, 10);
    if (Number.isNaN(manualId)) {
      return res.status(400).json({ error: '유효하지 않은 매뉴얼 ID입니다.' });
    }

    const { rows } = await pool.query(
      `SELECT manual_id, store_id, title, category, content, edited_at
       FROM manuals WHERE manual_id = $1`,
      [manualId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: '매뉴얼을 찾을 수 없습니다.' });
    }

    return res.json({
      ...rows[0],
      _links: [
        { rel: 'self', href: `/manuals/${manualId}`, method: 'GET' },
        { rel: 'update', href: `/stores/${rows[0].store_id}/manuals/${manualId}`, method: 'PATCH' }
      ]
    });
  } catch (err) {
    console.error('매뉴얼 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
