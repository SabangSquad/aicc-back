import express from 'express';
import pool from '../db.js';   // DB 연결용 모듈
const router = express.Router();

/**
 * @swagger
 * /customers/{id}:
 *   get:
 *     summary: 특정 고객 조회
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 고객 ID
 *     responses:
 *       200:
 *         description: 고객 정보
 *         content:
 *           application/json:
 *             example:
 *               customer_id: 1
 *               name: "홍길동"
 *               email: "hong@test.com"
 *               phone: "010-1234-5678"
 *               grade: "VIP"
 *       404:
 *         description: 고객 없음
 */
router.get('/:id', async (req, res) => {
  try {
    // id를 정수형으로 변환
    const { id } = req.params;
    const customerId = parseInt(id, 10);

    // id가 숫자가 아닐 경우의 예외 처리
    if (isNaN(customerId)) {
        return res.status(400).json({ error: 'Invalid customer ID' });
    }

    const result = await pool.query(
      'SELECT * FROM customers WHERE customer_id = $1',
      [customerId] // 변환된 숫자 id 사용
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('DB Error');
  }
});

export default router;
