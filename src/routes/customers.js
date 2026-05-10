// src/routes/customers.js
import express from 'express';
import pool from '../db.js';
import { isCustomerOrOwner, isOwner } from '../middlewares/auth.js';
import { parsePagination } from '../utils/pagination.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Customers
 *     description: "고객 API"
 */

/**
 * @swagger
 * /customers:
 *   post:
 *     summary: "고객 추가"
 *     tags: [Customers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [store_id, name, phone]
 *             properties:
 *               store_id: { type: integer }
 *               name: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               address: { type: string }
 *               birthdate: { type: string, format: date }
 *     responses:
 *       201: { description: "고객 생성 완료" }
 *       400: { description: "잘못된 요청" }
 */
router.post('/', isOwner, async (req, res) => {
  const { store_id, name, phone, email, address, birthdate } = req.body ?? {};

  if (!store_id || !name || !phone) {
    return res.status(400).json({ error: '필수 입력값(store_id, name, phone)이 누락되었습니다.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO customers (store_id, name, phone, email, address, birthdate)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING customer_id, store_id, name, phone, email, address, birthdate`,
      [store_id, name, phone, email ?? null, address ?? null, birthdate ?? null]
    );
    const newCustomer = rows[0];
    return res.status(201).json({
      ...newCustomer,
      _links: [
        { rel: 'self', href: '/customers', method: 'POST' },
        { rel: 'get_customer', href: `/customers/${newCustomer.customer_id}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('고객 생성 오류:', err);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /customers/{customer_id}:
 *   get:
 *     summary: "고객 정보 조회"
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: customer_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "고객 정보" }
 *       404: { description: "고객 없음" }
 *   patch:
 *     summary: "고객 정보 수정"
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: customer_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               address: { type: string }
 *               birthdate: { type: string, format: date }
 *     responses:
 *       200: { description: "수정된 고객 정보" }
 *       400: { description: "잘못된 요청" }
 *       404: { description: "고객 없음" }
 */
router.route('/:customer_id')
  .get(isCustomerOrOwner, async (req, res) => {
    try {
      const customerId = parseInt(req.params.customer_id, 10);
      if (Number.isNaN(customerId)) {
        return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
      }

      const { rows } = await pool.query(
        `SELECT customer_id, store_id, name, phone, email, address, birthdate
         FROM customers WHERE customer_id = $1`,
        [customerId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: '고객을 찾을 수 없습니다.' });
      }

      return res.json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/customers/${customerId}`, method: 'GET' },
          { rel: 'update', href: `/customers/${customerId}`, method: 'PATCH' },
          { rel: 'cases', href: `/customers/${customerId}/cases`, method: 'GET' },
          { rel: 'orders', href: `/customers/${customerId}/orders`, method: 'GET' },
          { rel: 'reservations', href: `/customers/${customerId}/reservations`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('고객 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .patch(isCustomerOrOwner, async (req, res) => {
    try {
      const customerId = parseInt(req.params.customer_id, 10);
      if (Number.isNaN(customerId)) {
        return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
      }

      let { name, address, phone, email, birthdate } = req.body ?? {};
      if (name !== undefined) name = String(name).trim();
      if (address !== undefined) address = String(address).trim();
      if (phone !== undefined) phone = String(phone).trim();
      if (email !== undefined) email = String(email).trim();

      if (email !== undefined && email.length > 0) {
        const simpleEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!simpleEmail.test(email)) {
          return res.status(400).json({ error: '유효하지 않은 이메일 형식입니다.' });
        }
      }

      const fields = { name, address, phone, email, birthdate };
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
        RETURNING customer_id, store_id, name, phone, email, address, birthdate
      `;
      const { rows } = await pool.query(sql, values);

      if (rows.length === 0) {
        return res.status(404).json({ error: '수정할 고객을 찾을 수 없습니다.' });
      }

      return res.json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/customers/${customerId}`, method: 'PATCH' },
          { rel: 'get_customer', href: `/customers/${customerId}`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('고객 수정 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });


/**
 * @swagger
 * /customers/{customer_id}/cases:
 *   get:
 *     summary: "고객 상담 목록 조회"
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: customer_id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *     responses:
 *       200: { description: "상담 목록" }
 */
router.get('/:customer_id/cases', isCustomerOrOwner, async (req, res) => {
  try {
    const customerId = Number.parseInt(req.params.customer_id, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
    }

    const { status, category, store_id } = req.query;
    const where = ['c.customer_id = $1'];
    const params = [customerId];
    let idx = 2;

    if (status !== undefined) {
      const st = String(status).trim();
      if (st.length === 0) return res.status(400).json({ error: 'status는 빈 문자열일 수 없습니다.' });
      where.push(`c.status = $${idx++}`);
      params.push(st);
    }

    if (category !== undefined) {
      const cat = String(category).trim();
      if (cat.length === 0) return res.status(400).json({ error: 'category는 빈 문자열일 수 없습니다.' });
      where.push(`c.category = $${idx++}`);
      params.push(cat);
    }

    if (store_id !== undefined) {
      const sid = parseInt(store_id, 10);
      if (Number.isInteger(sid)) {
        where.push(`c.store_id = $${idx++}`);
        params.push(sid);
      }
    }

    const { page, limit, offset } = parsePagination(req.query);
    const whereSql = where.join(' AND ');

    const countRes = await pool.query(`SELECT COUNT(*)::int FROM cases c WHERE ${whereSql}`, params);
    const total = countRes.rows[0].count;

    const { rows } = await pool.query(
      `SELECT c.case_id, c.store_id, c.customer_id, c.order_id, c.reservation_id,
              c.status, c.category, c.emotion, c.created_at, c.closed_at
       FROM cases c WHERE ${whereSql} ORDER BY c.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return res.json({
      data: rows, total, page, limit,
      _links: [
        { rel: 'self', href: `/customers/${customerId}/cases${req._parsedUrl.search || ''}`, method: 'GET' },
        { rel: 'get_customer', href: `/customers/${customerId}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('상담 목록 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /customers/{customer_id}/orders:
 *   get:
 *     summary: "고객 주문 목록 조회"
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: customer_id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: ["준비","배송","완료","반품","취소"] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: "주문 목록" }
 */
router.get('/:customer_id/orders', isCustomerOrOwner, async (req, res) => {
  try {
    const customerId = Number.parseInt(req.params.customer_id, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
    }

    const { status, store_id } = req.query;
    const { page, limit, offset } = parsePagination(req.query);
    const conditions = ['customer_id = $1'];
    const params = [customerId];

    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (store_id) {
      const sid = parseInt(store_id, 10);
      if (Number.isInteger(sid)) {
        params.push(sid);
        conditions.push(`store_id = $${params.length}`);
      }
    }

    const where = conditions.join(' AND ');
    const countRes = await pool.query(`SELECT COUNT(*)::int FROM orders WHERE ${where}`, params);
    const total = countRes.rows[0].count;

    const { rows } = await pool.query(
      `SELECT order_id, store_id, ordered_at, status, total_price
       FROM orders WHERE ${where} ORDER BY ordered_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return res.json({
      data: rows, total, page, limit,
      _links: [
        { rel: 'self', href: `/customers/${customerId}/orders`, method: 'GET' },
        { rel: 'get_customer', href: `/customers/${customerId}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('주문 목록 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /customers/{customer_id}/reservations:
 *   get:
 *     summary: "고객 예약 목록 조회"
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: customer_id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: ["완료","취소"] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: "예약 목록" }
 */
router.get('/:customer_id/reservations', isCustomerOrOwner, async (req, res) => {
  try {
    const customerId = Number.parseInt(req.params.customer_id, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
    }

    const { status, store_id } = req.query;
    const { page, limit, offset } = parsePagination(req.query);
    const conditions = ['customer_id = $1'];
    const params = [customerId];

    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (store_id) {
      const sid = parseInt(store_id, 10);
      if (Number.isInteger(sid)) {
        params.push(sid);
        conditions.push(`store_id = $${params.length}`);
      }
    }

    const where = conditions.join(' AND ');
    const countRes = await pool.query(`SELECT COUNT(*)::int FROM reservations WHERE ${where}`, params);
    const total = countRes.rows[0].count;

    const { rows } = await pool.query(
      `SELECT reservation_id, store_id, customer_id, reserved_at, status, headcount
       FROM reservations WHERE ${where} ORDER BY reserved_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return res.json({
      data: rows, total, page, limit,
      _links: [
        { rel: 'self', href: `/customers/${customerId}/reservations`, method: 'GET' },
        { rel: 'get_customer', href: `/customers/${customerId}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('예약 목록 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
