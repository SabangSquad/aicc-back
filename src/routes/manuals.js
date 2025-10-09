// src/routes/manuals.js
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
 * /manuals:
 *   get:
 *     summary: "매뉴얼 전체 목록 조회"
 *     tags:
 *       - Manuals
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: "페이지 번호(1부터 시작)"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: "페이지 크기(최대 100)"
 *       - in: query
 *         name: category_id
 *         schema:
 *           type: integer
 *         description: "카테고리 필터(예: 배송, 반품 등)"
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: "제목 검색어"
 *     responses:
 *       200:
 *         description: "매뉴얼 목록"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       manual_id:
 *                         type: integer
 *                       title:
 *                         type: string
 *                       category_id:
 *                         type: integer
 *                       edited_at:
 *                         type: string
 *                         format: date
 *                       file_path:
 *                         type: string
 *                 meta:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *             example:
 *               data:
 *                 - manual_id: 1
 *                   title: "배송 매뉴얼"
 *                   category_id: 3
 *                   edited_at: "2025-09-01"
 *                   file_path: "https://s3/manuals/shipping.md"
 *               meta:
 *                 page: 1
 *                 limit: 20
 *                 total: 42
 *       400:
 *         description: "잘못된 요청"
 *       500:
 *         description: "서버 오류"
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
    const offset = (page - 1) * limit;

    const { q } = req.query;

    const where = [];
    const params = [];
    let idx = 1;

    if (q && String(q).trim() !== '') {
      where.push(`title ILIKE $${idx++}`);
      params.push(`%${String(q).trim()}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const listSql = `
      SELECT
        manual_id,
        title,
        category_id, 
        TO_CHAR(edited_at, 'YYYY-MM-DD') AS edited_at,
        file_path
      FROM manuals
      ${whereSql}
      ORDER BY edited_at DESC, manual_id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countSql = `
      SELECT COUNT(*) AS total
      FROM manuals
      ${whereSql}
    `;

    const [listRes, countRes] = await Promise.all([
      pool.query(listSql, params),
      pool.query(countSql, params),
    ]);

    const total = Number(countRes.rows[0]?.total ?? 0);

    return res.json({
      data: listRes.rows,
      meta: { page, limit, total },
    });
  } catch (err) {
    console.error('매뉴얼 목록 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /manuals/{id}:
 *   get:
 *     summary: "특정 카테고리 매뉴얼 조회"
 *     tags:
 *       - Manuals
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "카테고리 ID"
 *     responses:
 *       200:
 *         description: "카테고리 상세"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 manual_id:
 *                   type: integer
 *                 title:
 *                   type: string
 *                 category_id:
 *                   type: integer
 *                 edited_at:
 *                   type: string
 *                   format: date
 *                 file_path:
 *                   type: string
 *             example:
 *               manual_id: 1
 *               title: "배송 매뉴얼"
 *               category_id: 3
 *               edited_at: "2025-09-01"
 *               file_path: "https://s3/manuals/shipping.md"
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "매뉴얼 없음"
 *       500:
 *         description: "서버 오류"
 */
router.get('/:id', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id, 10);
    if (Number.isNaN(categoryId)) {
      return res.status(400).json({ error: '유효하지 않은 카테고리 ID입니다.' });
    }

    const sql = `
      SELECT manual_id, title, categoryId, TO_CHAR(edited_at, 'YYYY-MM-DD') AS edited_at, file_path
      FROM manuals
      WHERE manual_id = $1
    `;
    const { rows } = await pool.query(sql, [manualId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: '매뉴얼을 찾을 수 없습니다.' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('매뉴얼 상세 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
