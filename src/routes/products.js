// src/routes/products.js
// GET   /products/:product_id — 상품 단건 조회
// PATCH /products/:product_id — 상품 정보 수정
// (목록 조회, 상품 추가는 /stores/:store_id/products 하위로 이동)
import express from 'express';
import pool from '../db.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Products
 *     description: "상품 API"
 */

/**
 * @swagger
 * /products/{product_id}:
 *   get:
 *     summary: "상품 단건 조회"
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: product_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "상품 정보" }
 *       404: { description: "상품 없음" }
 *   patch:
 *     summary: "상품 정보 수정"
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: product_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               price: { type: integer }
 *     responses:
 *       200: { description: "수정된 상품" }
 *       400: { description: "잘못된 요청" }
 *       404: { description: "상품 없음" }
 */
router.route('/:product_id')
  .get(async (req, res) => {
    try {
      const productId = Number.parseInt(req.params.product_id, 10);
      if (Number.isNaN(productId)) {
        return res.status(400).json({ error: '유효하지 않은 상품 ID입니다.' });
      }

      const { rows } = await pool.query(
        'SELECT product_id, store_id, name, price FROM products WHERE product_id = $1',
        [productId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
      }

      return res.status(200).json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/products/${productId}`, method: 'GET' },
          { rel: 'update', href: `/products/${productId}`, method: 'PATCH' }
        ]
      });
    } catch (err) {
      console.error('상품 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .patch(async (req, res) => {
    try {
      const productId = Number.parseInt(req.params.product_id, 10);
      if (Number.isNaN(productId)) {
        return res.status(400).json({ error: '유효하지 않은 상품 ID입니다.' });
      }

      let { name, price } = req.body ?? {};
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(String(name).trim());
      }
      if (price !== undefined) {
        const p = Number(price);
        if (!Number.isInteger(p)) {
          return res.status(400).json({ error: 'price는 정수여야 합니다.' });
        }
        updates.push(`price = $${paramIndex++}`);
        values.push(p);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: '수정할 내용을 입력해주세요.' });
      }

      values.push(productId);
      const { rows } = await pool.query(
        `UPDATE products SET ${updates.join(', ')} WHERE product_id = $${paramIndex}
         RETURNING product_id, store_id, name, price`,
        values
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
      }

      return res.status(200).json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/products/${productId}`, method: 'PATCH' },
          { rel: 'get_detail', href: `/products/${productId}`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('상품 수정 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });

export default router;
