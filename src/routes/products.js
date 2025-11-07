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
 * /products:
 *   get:
 *     summary: 상품 조회
 *     description: 전체 상품을 조회합니다.
 *     tags: [Products]
 *     responses:
 *       200:
 *         description: 상담 목록
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
 *                       product_id: 
 *                         type: integer 
 *                         description: 상품 ID
 *                       name:
 *                         type: string
 *                         description: 상품명
 *                       price:  
 *                         type: integer
 *                         description: 상품 가격
 *             example:
 *               product_id: 1
 *               name: "선풍기"
 *               price: 15000
 *       400:
 *         description: 잘못된 요청
 *       500:
 *         description: 서버 오류
 */

router.get('/', async (_, res) => {
  try {

    const listSql = `
      SELECT p.product_id, p.name, p.price
      FROM products p
    `;

    const { rows } = await pool.query(listSql);
    return res.json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /products:
 *   post:
 *     summary: "상품 추가"
 *     tags: [Products]
 *     description: 상품을 추가합니다.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, price]
 *             properties:
 *               name:
 *                 type: string
 *                 description: 상품명
 *               price:
 *                 type: integer
 *                 description: 상품 가격
 *           example:
 *             name: "선풍기"
 *             price: 15000
 *     responses:
 *       201:
 *         description: "상품 추가 완료"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 product_id:
 *                   type: integer
 *                   description: 상품 ID
 *                 name: 
 *                   type: string
 *                   description: 상품명
 *                 price:
 *                   type: integer
 *                   description: 상품 가격
 *             example:
 *               product_id: 1
 *               name: "선풍기"
 *               price: 15000
 *       400: 
 *         description: "잘못된 요청"
 *       404: 
 *         description: "상품 추가 오류"
 *       500:   
 *         description: "서버 오류"
 */

router.post('/', async (req, res) => {


  const { name, price } = req.body;

  if (typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name은 비어 있을 수 없습니다.' });
  }
  if (!Number.isInteger(price)) {
    return res.status(400).json({ error: 'price의 형식은 integer이어야 합니다.' });
  }
  
  
  try {

    const { rows } = await pool.query(
      `INSERT INTO products (name, price)
       VALUES ($1, $2)
       RETURNING product_id, name, price`,
      [name, price]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: '서버 내부 오류가 발생했습니다.'});
  }
});

/**
 * @swagger
 * /products/{product_id}:
 *   patch:
 *     summary: 상품 수정
 *     description: 해당 상품을 수정합니다.
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: product_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 상품 ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: 상품명
 *               price:
 *                 type: integer
 *                 description: 상품 가격
 *           example:
 *             name: "화분"
 *             price: 3500
 *     responses:
 *       200:
 *         description: 수정된 상품 정보
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 product_id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                   description: 상품명
 *                 price:
 *                   type: integer
 *                   description: 가격
 *             example:
 *               product_id: 1
 *               name: "화분"
 *               price: 3500
 *       400:
 *         description: 잘못된 요청
 *       404:
 *         description: 상품 없음
 *       500:
 *         description: 서버 오류
 */


router.route('/:product_id')
  .patch(async (req, res) => {
    try {
      const productId = Number.parseInt(req.params.product_id, 10);
      if (Number.isNaN(productId)) {
        return res.status(400).json({ error: '유효하지 않은 상품 ID입니다.' });
      }

      let { name, price } = req.body ?? {};
      if (name !== undefined) name = String(name).trim();
      if (price !== undefined) {
        const p = Number(price);
        if (!Number.isInteger(p)) {
          return res.status(400).json({ error: 'price는 정수여야 합니다.' });
        }
        price = p;
      }

      const fields = { name, price };
      const updates = [];
      const values = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
          updates.push(`${key} = $${paramIndex++}`);
          values.push(value);
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: '수정할 내용을 입력해주세요.' });
      }

      // WHERE 바인딩
      values.push(productId);

      const updateQuery = `
        UPDATE products
        SET ${updates.join(', ')}
        WHERE product_id = $${paramIndex}
        RETURNING product_id, name, price
      `;
      const result = await pool.query(updateQuery, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
      }

      return res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error('상품 수정 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });



export default router;
