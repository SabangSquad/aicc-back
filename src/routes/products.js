// src/routes/products.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Products
 *     description: "상품 API"
 */

function getOrderByClause(sortBy, order) {
  const dir = String(order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  switch (sortBy) {
    case 'price':
      return `ORDER BY p.price ${dir}, p.product_id DESC`;
    case 'name': // product_name으로 매핑
      return `ORDER BY p.product_name ${dir}, p.product_id DESC`;
    default:
      return `ORDER BY p.product_id ${dir}`;
  }
}

/**
 * @swagger
 * /products:
 *   get:
 *     summary: "전체 상품 조회"
 *     description: "페이지네이션, 검색, 가격 필터, 정렬을 지원합니다."
 *     tags:
 *       - Products
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *         description: "페이지 번호(1부터 시작)"
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *         description: "페이지 크기(최대 100)"
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: "상품명 검색어(부분 일치, 대소문자 무시)"
 *       - in: query
 *         name: price_min
 *         schema: { type: number }
 *         description: "최소 가격"
 *       - in: query
 *         name: price_max
 *         schema: { type: number }
 *         description: "최대 가격"
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [price, name]
 *         description: "정렬 기준 (name은 product_name)"
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: "desc"
 *         description: "정렬 순서"
 *     responses:
 *       200:
 *         description: "상품 목록"
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
 *                       product_id: { type: integer }
 *                       product_name: { type: string }
 *                       price: { type: number, format: float }
 *                 meta:
 *                   type: object
 *                   properties:
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *                     total: { type: integer }
 *             example:
 *               data:
 *                 - product_id: 101
 *                   product_name: "무선 이어폰"
 *                   price: 99000
 *               meta:
 *                 page: 1
 *                 limit: 20
 *                 total: 1
 *       400: { description: "잘못된 요청" }
 *       500: { description: "서버 오류" }
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
    const offset = (page - 1) * limit;

    const { q, price_min, price_max, sortBy, order } = req.query;

    const where = [];
    const params = [];
    let idx = 1;

    if (q) {
      where.push(`p.product_name ILIKE $${idx++}`);
      params.push(`%${String(q).trim()}%`);
    }
    if (price_min !== undefined) {
      const min = Number(price_min);
      if (Number.isFinite(min)) {
        where.push(`p.price >= $${idx++}`);
        params.push(min);
      }
    }
    if (price_max !== undefined) {
      const max = Number(price_max);
      if (Number.isFinite(max)) {
        where.push(`p.price <= $${idx++}`);
        params.push(max);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderBy = getOrderByClause(sortBy, order);

    const listSql = `
      SELECT
        p.product_id, p.product_name, p.price
      FROM products p
      ${whereSql}
      ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countSql = `
      SELECT COUNT(*) AS total
      FROM products p
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
    console.error('상품 목록 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /products/{id}:
 *   get:
 *     summary: "특정 상품 조회"
 *     tags:
 *       - Products
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: "상품 ID"
 *     responses:
 *       200:
 *         description: "상품 상세"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 product_id: { type: integer }
 *                 product_name: { type: string }
 *                 price: { type: number, format: float }
 *       400: { description: "잘못된 요청" }
 *       404: { description: "상품 없음" }
 *       500: { description: "서버 오류" }
 */
router.get('/:id', async (req, res) => {
  try {
    const productId = parseInt(req.params.id, 10);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ error: '유효하지 않은 상품 ID입니다.' });
    }

    const sql = `
      SELECT product_id, product_name, price
      FROM products
      WHERE product_id = $1
    `;
    const { rows } = await pool.query(sql, [productId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('상품 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
