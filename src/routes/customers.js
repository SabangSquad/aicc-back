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
 * /customers/{customer_id}:
 *   get:
 *     summary: "고객 정보 조회"
 *     tags:
 *       - Customers
 *     description: 해당 고객의 정보를 조회합니다.
 *     parameters:
 *       - in: path
 *         name: customer_id
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
 *                 address:
 *                   type: string
 *                 phone:
 *                   type: string
 *                 email:
 *                   type: string
 *                   format: email
 *                 joined_at:
 *                   type: string
 *                   format: date-time
 *                 points:
 *                   type: integer
 *                 grade:
 *                   type: string
 *                   nullable: true
 *             example:
 *               customer_id: 1
 *               name: "홍길동"
 *               address: "인천 연수구 송도 1동"
 *               phone: "010-1234-5678"
 *               email: "hong@test.com"
 *               joined_at: "2025-09-01T04:08:31.231Z"
 *               points: 1234
 *               grade: "VIP"
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "고객 없음"
 */
router.get('/:customer_id', async (req, res) => {
  try {
    const customerId = parseInt(req.params.customer_id, 10);
    if (Number.isNaN(customerId)) {
      return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
    }

    const result = await pool.query(
      `SELECT customer_id, name, address, phone, email, joined_at, points, grade
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
 * /customers/{customer_id}:
 *   patch:
 *     summary: "고객 정보 수정"
 *     tags:
 *       - Customers
 *     description: 해당 고객의 정보를 수정합니다.
 *     parameters:
 *       - in: path
 *         name: customer_id
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
 *               address:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               points:
 *                 type: integer
 *               grade:
 *                 type: string
 *                 nullable: true
 *             example:
 *               name: "홍길동"
 *               address: "인천 연수구 송도 1동"
 *               phone: "010-1234-5678"
 *               email: "hong@test.com"
 *               points: 1234
 *               grade: "VIP"
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
 *                 address:
 *                   type: string
 *                 phone:
 *                   type: string
 *                 email:
 *                   type: string
 *                   format: email
 *                 points:
 *                   type: integer
 *                 grade:
 *                   type: string
 *                   nullable: true
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "고객 없음"
 *       500:
 *         description: "서버 오류"
 */
router.patch('/:customer_id', async (req, res) => {
  try {
    const customerId = parseInt(req.params.customer_id, 10);
    if (Number.isNaN(customerId)) {
      return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
    }

    let { name, address, phone, email, points, grade } = req.body ?? {};
    if (name !== undefined) name = String(name).trim();
    if (address !== undefined) address = String(address).trim();
    if (phone !== undefined) phone = String(phone).trim();
    if (email !== undefined) email = String(email).trim();
    if (points !== undefined) points = String(points).trim();
    if (grade !== undefined) grade = String(grade).trim();
    

    if (email !== undefined && email.length > 0) {
      const simpleEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!simpleEmail.test(email)) {
        return res.status(400).json({ error: '유효하지 않은 이메일 형식입니다.' });
      }
    }

    const fields = { name, address, phone, email, points, grade };
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
      RETURNING name, address, phone, email, points, grade
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
 *     summary: "고객 상담 목록 조회"
 *     tags:
 *       - Customers
 *     description: |
 *       해당 고객의 상담 목록을 조회합니다.
 *       - 상담 상태, 카테고리 필터를 제공합니다.
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
 *           enum: ["대기", "상담", "종료"]
 *         description: "상담 상태 필터"
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [취소, 교환, 반품, 반품비, 회수, 취소철회, 배송일정, 배송완료미수령, 상품파손, 해외배송, 상품누락, 주소검색, 배송비, 포장, 상품문의, 상품후기, 가입, 탈퇴, 개인정보설정, 로그인, 로그아웃, 인증, 비밀번호관리, 신용카드, 결제수단, 무통장입금, 할인쿠폰, 주문, 주문확인, 포인트]
 *         description: 카테고리 필터
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
 *                       agent_id:
 *                         type: integer
 *                         description: 상담원 ID
 *                       title:
 *                         type: string
 *                         description: 상담 제목
 *                       status:
 *                         type: string
 *                         description: 상담 상태
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                         description: 상담 생성 시각
 *                       closed_at:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                         description: 상담 종료 시각
 *                       content:
 *                         type: string
 *                         description: 상담 내용
 *                       order_id:
 *                         type: integer
 *                         description: 주문 ID
 *                       category:
 *                         type: string
 *                         description: 카테고리
 *             example:
 *               agent_id: 1
 *               title: "환불하고 싶어요."
 *               status: "대기"
 *               created_at: "2025-09-01T04:08:31.231Z"
 *               closed_at: null
 *               content: "상품 품질이 정말 별로네요."
 *               order_id: 1
 *               category: "환불"
 *       400:
 *         description: "잘못된 요청"
 *       500:
 *         description: "서버 오류"
 */
router.get('/:customer_id/cases', async (req, res) => {
  try {
    const customerId = Number.parseInt(req.params.customer_id, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
    }

    const { status, category } = req.query;

    const where = ['c.customer_id = $1'];
    const params = [customerId];
    let idx = 2;

    // status: 공백 방지 (+ 선택적으로 허용값 제한)
    if (status !== undefined) {
      const st = String(status).trim();
      if (st.length === 0) {
        return res.status(400).json({ error: 'status는 빈 문자열일 수 없습니다.' });
      }
      const ALLOWED_STATUS = new Set(['대기', '상담', '종료']);
      if (!ALLOWED_STATUS.has(st)) return res.status(400).json({ error: 'status는 대기, 상담, 종료 중 하나여야 합니다.' });

      where.push(`c.status = $${idx++}`);
      params.push(st);
    }

    // category: 문자열, 공백 방지
    if (category !== undefined) {
      const cat = String(category).trim();
      if (cat.length === 0) {
        return res.status(400).json({ error: 'category는 빈 문자열일 수 없습니다.' });
      }
      where.push(`c.category = $${idx++}`);
      params.push(cat);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    const listSql = `
      SELECT c.agent_id, c.title, c.status, c.created_at, c.closed_at, c.content, c.order_id, c.category
      FROM cases c
      ${whereSql}
      ORDER BY c.created_at DESC
    `;

    const { rows } = await pool.query(listSql, params);
    return res.json({ data: rows });
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
 *     tags:
 *       - Customers
 *     description: 해당 고객의 주문 목록을 조회합니다.
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
 *           enum: ["준비", "배송", "완료"]
 *         description: "주문 상태 필터"
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
 *                       status:
 *                         type: string
 *                       ordered_at:
 *                         type: string
 *                         format: date-time
 *                       total_price:
 *                         type: integer
 *             example:
 *               order_id: 1
 *               status: "준비"
 *               ordered_at: "2025-09-01T04:08:31.231Z"
 *               total_price: 4000
 *       400:
 *         description: "잘못된 요청"
 *       500:
 *         description: "서버 오류"
 */
router.get('/:customer_id/orders', async (req, res) => {
  try {
    const customerId = Number.parseInt(req.params.customer_id, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
    }

    const { status } = req.query;

    const where = ['o.customer_id = $1'];
    const params = [customerId];
    let idx = 2;

    // status: 공백 방지 (+ 선택적으로 허용값 제한)
    if (status !== undefined) {
      const st = String(status).trim();
      if (st.length === 0) {
        return res.status(400).json({ error: 'status는 빈 문자열일 수 없습니다.' });
      }
      const ALLOWED_STATUS = new Set(['준비', '배송', '완료']);
      if (!ALLOWED_STATUS.has(st)) return res.status(400).json({ error: 'status는 준비, 배송, 완료 중 하나여야 합니다.' });

      where.push(`o.status = $${idx++}`);
      params.push(st);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    const listSql = `
      SELECT o.order_id, o.ordered_at, o.status, o.total_price
      FROM orders o
      ${whereSql}
      ORDER BY o.ordered_at DESC
    `;

    const { rows } = await pool.query(listSql, params);
    return res.json({ data: rows });
  } catch (err) {
    console.error('주문 목록 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /customers/{customer_id}/orders:
 *   post:
 *     summary: "고객 주문 추가"
 *     tags: [Customers]
 *     description: 해당 고객의 주문을 추가합니다.
 *     parameters:
 *       - in: path
 *         name: customer_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "고객 ID"
 *     responses:
 *       201:
 *         description: "주문 생성 완료"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 order_id:
 *                   type: integer
 *                   description: 주문 ID
 *                 ordered_at:
 *                   type: string
 *                   format: date-time
 *                   description: 주문 일자
 *                 status:
 *                   type: string
 *                   description: 주문 상태
 *                 total_price:
 *                   type: integer
 *                   description: 총합 가격
 *             example:
 *               order_id: 1
 *               ordered_at: "2025-09-01T04:08:31.231Z"
 *               status: "대기"
 *               total_price: 4000
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "해당 고객을 찾을 수 없음"
 *       500:
 *         description: "서버 오류"
 */

router.post('/:customer_id/orders', async (req, res) => {
  // path 파라미터만 사용
  const customerId = Number.parseInt(req.params.customer_id, 10);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ error: '유효하지 않은 고객 ID입니다.' });
  }

  try {
    // customer_id만으로 주문 생성
    const { rows } = await pool.query(
      `INSERT INTO orders (customer_id)
       VALUES ($1)
       RETURNING order_id, ordered_at, status, total_price`,
      [customerId]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: '서버 오류' });
  }
});




export default router;
