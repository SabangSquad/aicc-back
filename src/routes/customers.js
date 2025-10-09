// src/routes/customers.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Customers
 *     description: "고객 API"
 */

/**
 * @swagger
 * /customers/{id}:
 *   get:
 *     summary: "특정 고객 조회"
 *     tags:
 *       - Customers
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "고객 ID"
 *     responses:
 *       200:
 *         description: "고객 정보"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 customer_id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 email:
 *                   type: string
 *                   format: email
 *                 phone:
 *                   type: string
 *                 grade_id:
 *                   type: integer
 *                   nullable: true
 *             example:
 *               customer_id: 1
 *               name: "홍길동"
 *               email: "hong@test.com"
 *               phone: "010-1234-5678"
 *               grade_id: 1
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "고객 없음"
 */
router.get('/:id', async (req, res) => {
  try {
    const customerId = parseInt(req.params.id, 10);
    if (Number.isNaN(customerId)) {
      return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
    }

    const result = await pool.query(
      `SELECT customer_id, name, email, phone, grade_id
       FROM customers
       WHERE customer_id = $1`,
      [customerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '고객을 찾을 수 없습니다.' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('고객 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /customers/{id}:
 *   patch:
 *     summary: "고객 정보 수정"
 *     tags:
 *       - Customers
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "고객 ID"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               grade_id:
 *                 type: integer
 *                 nullable: true
 *           example:
 *             name: "홍길동"
 *             email: "hong@test.com"
 *             phone: "010-1234-5678"
 *             grade_id: 1
 *     responses:
 *       200:
 *         description: "수정된 고객 정보"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 customer_id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 email:
 *                   type: string
 *                   format: email
 *                 phone:
 *                   type: string
 *                 grade_id:
 *                   type: integer
 *                   nullable: true
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "고객 없음"
 *       500:
 *         description: "서버 오류"
 */
router.patch('/:id', async (req, res) => {
  try {
    const customerId = parseInt(req.params.id, 10);
    if (Number.isNaN(customerId)) {
      return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
    }

    let { name, email, phone, grade_id } = req.body ?? {};
    if (name !== undefined) name = String(name).trim();
    if (email !== undefined) email = String(email).trim();
    if (phone !== undefined) phone = String(phone).trim();

    if (email !== undefined && email.length > 0) {
      const simpleEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!simpleEmail.test(email)) {
        return res.status(400).json({ error: '유효하지 않은 이메일 형식입니다.' });
      }
    }

    if (grade_id !== undefined && grade_id !== null) {
      const gid = Number.parseInt(grade_id, 10);
      if (!Number.isInteger(gid) || gid < 0) {
        return res.status(400).json({ error: 'grade_id는 0 이상의 정수이거나 null이어야 합니다.' });
      }
      grade_id = gid;
    }

    const fields = { name, email, phone, grade_id };
    const updates = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates.push(`${key} = $${idx++}`);
        values.push(value);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '수정할 내용을 입력해주세요.' });
    }

    values.push(customerId);

    const sql = `
      UPDATE customers
      SET ${updates.join(', ')}
      WHERE customer_id = $${idx}
      RETURNING customer_id, name, email, phone, grade_id
    `;
    const result = await pool.query(sql, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '수정할 고객을 찾을 수 없습니다.' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('고객 수정 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /customers/{customer_id}/cases:
 *   get:
 *     summary: "고객 상담 건 조회"
 *     tags:
 *       - Customers
 *     parameters:
 *       - in: path
 *         name: customer_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "고객 ID"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum:
 *             - waiting
 *             - chatting
 *             - closed
 *         description: "상담 상태 코드 필터"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: "최대 100까지 허용"
 *     responses:
 *       200:
 *         description: "상담 이력 목록"
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
 *                       case_id:
 *                         type: integer
 *                       title:
 *                         type: string
 *                       status:
 *                         type: string
 *                         enum:
 *                           - waiting
 *                           - chatting
 *                           - closed
 *                       category_id:
 *                         type: integer
 *                       emotion_id:
 *                         type: integer
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                       closed_at:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                 meta:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *       400:
 *         description: "잘못된 요청"
 *       500:
 *         description: "서버 오류"
 */
router.get('/:customer_id/cases', async (req, res) => {
  try {
    const customerId = parseInt(req.params.customer_id, 10);
    if (Number.isNaN(customerId)) {
      return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
    }

    const rawStatus = req.query.status;
    const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
    const offset = (page - 1) * limit;

    const where = ['c.customer_id = $1'];
    const params = [customerId];
    let idx = 2;

    if (rawStatus !== undefined) {
      const s = String(rawStatus).trim().toLowerCase();
      const allowed = ['waiting', 'chatting', 'closed'];
      if (!allowed.includes(s)) {
        return res.status(400).json({ error: 'status는 waiting | chatting | closed 중 하나여야 합니다.' });
      }
      where.push(`c.status = $${idx++}`);
      params.push(s);
    }

    const whereSql = 'WHERE ' + where.join(' AND ');

    const listSql = `
      SELECT c.case_id, c.title, c.status, c.category_id, c.emotion_id, c.created_at, c.closed_at
      FROM cases c
      ${whereSql}
      ORDER BY c.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countSql = `
      SELECT COUNT(*) AS total
      FROM cases c
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
    console.error('고객 상담 이력 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /customers/{customer_id}/orders:
 *   get:
 *     summary: "고객 주문 내역 조회"
 *     tags:
 *       - Customers
 *     parameters:
 *       - in: path
 *         name: customer_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "고객 ID"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: "주문 상태 필터 (배송준비, 배송중, 완료)"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: "최대 100까지 허용"
 *     responses:
 *       200:
 *         description: "주문 목록"
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
 *                       order_id:
 *                         type: integer
 *                       customer_id:
 *                         type: integer
 *                       status:
 *                         type: string
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                 meta:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *       400:
 *         description: "잘못된 요청"
 *       500:
 *         description: "서버 오류"
 */
router.get('/:customer_id/orders', async (req, res) => {
  try {
    const customerId = parseInt(req.params.customer_id, 10);
    if (Number.isNaN(customerId)) {
      return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
    }

    const { status } = req.query;
    const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
    const offset = (page - 1) * limit;

    const where = ['o.customer_id = $1'];
    const params = [customerId];
    let idx = 2;

    if (status) {
      where.push('o.status = $' + idx++);
      params.push(String(status));
    }

    const whereSql = 'WHERE ' + where.join(' AND ');

    const listSql = `
      SELECT o.order_id, o.customer_id, o.status, o.ordered_at
      FROM orders o
      ${whereSql}
      ORDER BY o.ordered_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countSql = `
      SELECT COUNT(*) AS total
      FROM orders o
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
    console.error('고객 주문 내역 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /customers/{customer_id}/orders:
 *   post:
 *     summary: "고객 주문 추가"
 *     tags:
 *       - Customers
 *     parameters:
 *       - in: path
 *         name: customer_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "고객 ID"
 *     responses:
 *       201:
 *         description: "주문이 생성되었습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: "DB 기본값이 적용된 주문 레코드"
 *       400: { description: "잘못된 요청" }
 *       404: { description: "고객 없음" }
 *       500: { description: "서버 오류" }
 */

router.post('/:customer_id/orders', async (req, res) => {
  const client = await pool.connect();
  try {
    const customerId = parseInt(req.params.customer_id, 10);
    if (Number.isNaN(customerId)) {
      client.release();
      return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
    }

    await client.query('BEGIN');

    const exist = await client.query(
      'SELECT 1 FROM customers WHERE customer_id = $1',
      [customerId]
    );
    if (exist.rowCount === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: '고객을 찾을 수 없습니다.' });
    }

    const insert = await client.query(
      `INSERT INTO orders (customer_id)
       VALUES ($1)
       RETURNING *`,                 
      [customerId]
    );

    await client.query('COMMIT');

    return res.status(201).json(insert.rows[0]);
  } catch (err) {
    try { await pool.query('ROLLBACK'); } catch (_) {}
    console.error('주문 생성 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  } finally {
    try { client.release(); } catch (_) {}
  }
});


export default router;
