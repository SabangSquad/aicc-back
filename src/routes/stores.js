// src/routes/stores.js
import express from 'express';
import pool from '../db.js';
import { isAdmin, isStoreOwner } from '../middlewares/auth.js';
import { ALL_STATUSES } from '../constants/caseStatus.js';
import { generateEmbedding } from '../services/embeddingService.js';
import { toSql } from 'pgvector/pg';
import { parsePagination } from '../utils/pagination.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Stores
 *     description: "가게 API"
 */

/**
 * @swagger
 * /stores:
 *   post:
 *     summary: "가게 추가"
 *     tags: [Stores]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, category, phone, email, address]
 *             properties:
 *               name: { type: string }
 *               category: { type: string, enum: ["병원","식당","이커머스"] }
 *               phone: { type: string }
 *               email: { type: string }
 *               address: { type: string }
 *               business_hours: { type: object }
 *               facilities: { type: object }
 *               notice: { type: string }
 *               store_items: { type: object }
 *     responses:
 *       201: { description: "가게 생성 완료" }
 *       400: { description: "잘못된 요청" }
 */
router.post('/', isAdmin, async (req, res) => {
  const { name, category, phone, email, address, business_hours, facilities, notice, store_items } = req.body ?? {};

  if (!name || !category || !phone || !email || !address) {
    return res.status(400).json({ error: '필수 입력값(name, category, phone, email, address)이 누락되었습니다.' });
  }

  const ALLOWED_CATEGORIES = new Set(['병원', '식당', '이커머스']);
  if (!ALLOWED_CATEGORIES.has(category)) {
    return res.status(400).json({ error: "category는 '병원' | '식당' | '이커머스' 중 하나여야 합니다." });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO stores (name, category, phone, email, address, business_hours, facilities, notice, store_items)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING store_id, name, category, phone, email, address`,
      [name, category, phone, email, address,
       business_hours ?? null, facilities ?? null, notice ?? null, store_items ?? null]
    );
    return res.status(201).json({
      ...rows[0],
      _links: [
        { rel: 'self', href: '/stores', method: 'POST' },
        { rel: 'get_store', href: `/stores/${rows[0].store_id}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('가게 추가 오류:', err);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /stores/{store_id}:
 *   get:
 *     summary: "가게 정보 조회"
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: store_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "가게 정보" }
 *       404: { description: "가게 없음" }
 *   patch:
 *     summary: "가게 정보 수정"
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: store_id
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
 *               business_hours: { type: object }
 *               facilities: { type: object }
 *               notice: { type: string }
 *               store_items: { type: object }
 *     responses:
 *       200: { description: "수정된 가게 정보" }
 *       400: { description: "잘못된 요청" }
 *       404: { description: "가게 없음" }
 */
router.route('/:store_id')
  .get(async (req, res) => {
    try {
      const storeId = parseInt(req.params.store_id, 10);
      if (Number.isNaN(storeId)) {
        return res.status(400).json({ error: '유효하지 않은 가게 ID입니다.' });
      }

      const { rows } = await pool.query(
        `SELECT store_id, name, category, phone, email, address,
                business_hours, facilities, notice, store_items
         FROM stores WHERE store_id = $1`,
        [storeId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: '가게를 찾을 수 없습니다.' });
      }

      return res.json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/stores/${storeId}`, method: 'GET' },
          { rel: 'update', href: `/stores/${storeId}`, method: 'PATCH' },
          { rel: 'cases', href: `/stores/${storeId}/cases`, method: 'GET' },
          { rel: 'orders', href: `/stores/${storeId}/orders`, method: 'GET' },
          { rel: 'manuals', href: `/stores/${storeId}/manuals`, method: 'GET' },
          { rel: 'products', href: `/stores/${storeId}/products`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('가게 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .patch(isStoreOwner, async (req, res) => {
    try {
      const storeId = parseInt(req.params.store_id, 10);
      if (Number.isNaN(storeId)) {
        return res.status(400).json({ error: '유효하지 않은 가게 ID입니다.' });
      }

      const ALLOWED_FIELDS = ['name', 'phone', 'email', 'address', 'business_hours', 'facilities', 'notice', 'store_items'];
      const body = req.body ?? {};
      const updates = [];
      const values = [];
      let idx = 1;

      for (const key of ALLOWED_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
          updates.push(`${key} = $${idx++}`);
          values.push(body[key]);
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: '수정할 내용을 입력해주세요.' });
      }

      values.push(storeId);
      const { rows } = await pool.query(
        `UPDATE stores SET ${updates.join(', ')} WHERE store_id = $${idx}
         RETURNING store_id, name, category, phone, email, address`,
        values
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: '가게를 찾을 수 없습니다.' });
      }

      return res.json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/stores/${storeId}`, method: 'PATCH' },
          { rel: 'get_store', href: `/stores/${storeId}`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('가게 수정 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });


/**
 * @swagger
 * /stores/{store_id}/cases:
 *   get:
 *     summary: "가게 상담 목록 조회"
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: store_id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: ["대기","상담","종료","AI자동해결"] }
 *       - in: query
 *         name: emotion
 *         schema: { type: string, enum: ["평온","기쁨","슬픔","화남","짜증"] }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: start
 *         schema: { type: string, format: date-time }
 *         description: "조회 시작 시간"
 *       - in: query
 *         name: end
 *         schema: { type: string, format: date-time }
 *         description: "조회 종료 시간"
 *     responses:
 *       200: { description: "상담 목록" }
 */
router.get('/:store_id/cases', isStoreOwner, async (req, res) => {
  try {
    const storeId = parseInt(req.params.store_id, 10);
    if (Number.isNaN(storeId)) return res.status(400).json({ error: '유효하지 않은 가게 ID입니다.' });

    const { status, emotion, category, start, end } = req.query;
    const conditions = ['c.store_id = $1'];
    const params = [storeId];

    if (status) {
      if (!ALL_STATUSES.has(status)) {
        return res.status(400).json({ error: `유효하지 않은 status 값입니다.` });
      }
      params.push(status);
      conditions.push(`c.status = $${params.length}`);
    }
    if (emotion) {
      params.push(emotion);
      conditions.push(`c.emotion = $${params.length}`);
    }
    if (category) {
      params.push(category);
      conditions.push(`c.category = $${params.length}`);
    }
    if (start) {
      params.push(start);
      conditions.push(`c.created_at >= $${params.length}::timestamptz`);
    }
    if (end) {
      params.push(end);
      conditions.push(`c.created_at <= $${params.length}::timestamptz`);
    }

    const { page, limit, offset } = parsePagination(req.query);

    const countRes = await pool.query(
      `SELECT COUNT(*)::int FROM cases c WHERE ${conditions.join(' AND ')}`, params
    );
    const total = countRes.rows[0].count;

    const { rows } = await pool.query(
      `SELECT case_id, customer_id, store_id, order_id, reservation_id,
              category, status, emotion, created_at, closed_at
       FROM cases c WHERE ${conditions.join(' AND ')} ORDER BY c.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return res.json({
      data: rows, total, page, limit,
      _links: [{ rel: 'self', href: `/stores/${storeId}/cases`, method: 'GET' }]
    });
  } catch (err) {
    console.error('가게 상담 목록 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /stores/{store_id}/satisfactions:
 *   get:
 *     summary: "가게 만족도 조회"
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: store_id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: start
 *         schema: { type: string, format: date-time }
 *         description: "조회 시작 시간"
 *       - in: query
 *         name: end
 *         schema: { type: string, format: date-time }
 *         description: "조회 종료 시간"
 *     responses:
 *       200: { description: "만족도 목록" }
 */
router.get('/:store_id/satisfactions', isStoreOwner, async (req, res) => {
  try {
    const storeId = parseInt(req.params.store_id, 10);
    if (Number.isNaN(storeId)) return res.status(400).json({ error: '유효하지 않은 가게 ID입니다.' });

    const { start, end } = req.query;
    const { page, limit, offset } = parsePagination(req.query);

    const baseWhere = `WHERE store_id = $1
      AND ($2::timestamptz IS NULL OR collected_at >= $2)
      AND ($3::timestamptz IS NULL OR collected_at <= $3)`;
    const baseParams = [storeId, start ?? null, end ?? null];

    const countRes = await pool.query(`SELECT COUNT(*)::int FROM satisfactions ${baseWhere}`, baseParams);
    const total = countRes.rows[0].count;

    const { rows } = await pool.query(
      `SELECT satisfaction_id, case_id, store_id, score, collected_at
       FROM satisfactions ${baseWhere} ORDER BY collected_at DESC LIMIT $4 OFFSET $5`,
      [...baseParams, limit, offset]
    );

    return res.json({
      data: rows, total, page, limit,
      _links: [{ rel: 'self', href: `/stores/${storeId}/satisfactions`, method: 'GET' }]
    });
  } catch (err) {
    console.error('가게 만족도 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /stores/{store_id}/orders:
 *   get:
 *     summary: "가게 주문 목록 조회"
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: store_id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: ["준비","배송","완료","반품","취소"] }
 *       - in: query
 *         name: start
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: end
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: "주문 목록" }
 */
router.get('/:store_id/orders', isStoreOwner, async (req, res) => {
  try {
    const storeId = parseInt(req.params.store_id, 10);
    if (Number.isNaN(storeId)) return res.status(400).json({ error: '유효하지 않은 가게 ID입니다.' });

    const { status, start, end } = req.query;
    const { page, limit, offset } = parsePagination(req.query);
    const conditions = ['store_id = $1'];
    const params = [storeId];

    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (start)  { params.push(start);  conditions.push(`ordered_at >= $${params.length}::timestamptz`); }
    if (end)    { params.push(end);    conditions.push(`ordered_at <= $${params.length}::timestamptz`); }

    const where = conditions.join(' AND ');
    const countRes = await pool.query(`SELECT COUNT(*)::int FROM orders WHERE ${where}`, params);
    const total = countRes.rows[0].count;

    const { rows } = await pool.query(
      `SELECT order_id, customer_id, store_id, status, total_price, ordered_at
       FROM orders WHERE ${where} ORDER BY ordered_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return res.json({
      data: rows, total, page, limit,
      _links: [{ rel: 'self', href: `/stores/${storeId}/orders`, method: 'GET' }]
    });
  } catch (err) {
    console.error('가게 주문 목록 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /stores/{store_id}/reservations:
 *   get:
 *     summary: "가게 예약 목록 조회"
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: store_id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: ["완료","취소"] }
 *       - in: query
 *         name: start
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: end
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: "예약 목록" }
 */
router.get('/:store_id/reservations', isStoreOwner, async (req, res) => {
  try {
    const storeId = parseInt(req.params.store_id, 10);
    if (Number.isNaN(storeId)) return res.status(400).json({ error: '유효하지 않은 가게 ID입니다.' });

    const { status, start, end } = req.query;
    const { page, limit, offset } = parsePagination(req.query);
    const conditions = ['store_id = $1'];
    const params = [storeId];

    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (start)  { params.push(start);  conditions.push(`reserved_at >= $${params.length}::timestamptz`); }
    if (end)    { params.push(end);    conditions.push(`reserved_at <= $${params.length}::timestamptz`); }

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
      _links: [{ rel: 'self', href: `/stores/${storeId}/reservations`, method: 'GET' }]
    });
  } catch (err) {
    console.error('가게 예약 목록 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /stores/{store_id}/manuals:
 *   get:
 *     summary: "가게 매뉴얼 목록 조회"
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: store_id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: "카테고리 필터"
 *     responses:
 *       200: { description: "매뉴얼 목록" }
 *   post:
 *     summary: "매뉴얼 추가"
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: store_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, category, content]
 *             properties:
 *               title: { type: string }
 *               category: { type: string }
 *               content: { type: string, description: "마크다운 본문" }
 *     responses:
 *       201: { description: "매뉴얼 추가 완료" }
 *       400: { description: "잘못된 요청" }
 */
router.route('/:store_id/manuals')
  .get(async (req, res) => {
    try {
      const storeId = parseInt(req.params.store_id, 10);
      if (Number.isNaN(storeId)) return res.status(400).json({ error: '유효하지 않은 가게 ID입니다.' });

      const { category } = req.query;
      const conditions = ['store_id = $1'];
      const params = [storeId];

      if (category) {
        const cat = String(category).trim();
        if (!cat) return res.status(400).json({ error: 'category는 빈 문자열일 수 없습니다.' });
        params.push(cat);
        conditions.push(`category = $${params.length}`);
      }

      const { page, limit, offset } = parsePagination(req.query);

      const countRes = await pool.query(
        `SELECT COUNT(*)::int FROM manuals WHERE ${conditions.join(' AND ')}`, params
      );
      const total = countRes.rows[0].count;

      const { rows } = await pool.query(
        `SELECT manual_id, store_id, title, category, content, edited_at
         FROM manuals WHERE ${conditions.join(' AND ')} ORDER BY category DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      return res.json({
        data: rows, total, page, limit,
        _links: [
          { rel: 'self', href: `/stores/${storeId}/manuals`, method: 'GET' },
          { rel: 'create', href: `/stores/${storeId}/manuals`, method: 'POST' }
        ]
      });
    } catch (err) {
      console.error('매뉴얼 목록 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .post(isStoreOwner, async (req, res) => {
    try {
      const storeId = parseInt(req.params.store_id, 10);
      if (Number.isNaN(storeId)) return res.status(400).json({ error: '유효하지 않은 가게 ID입니다.' });

      const { title, category, content } = req.body ?? {};
      if (!title || !category || !content) {
        return res.status(400).json({ error: '필수 입력값(title, category, content)이 누락되었습니다.' });
      }

      // 임베딩 생성
      const embedding = await generateEmbedding(content);

      const { rows } = await pool.query(
        `INSERT INTO manuals (store_id, title, category, content, embedding, edited_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING manual_id, store_id, title, category, content, edited_at`,
        [storeId, title, category, content, toSql(embedding)]
      );

      return res.status(201).json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/stores/${storeId}/manuals`, method: 'POST' },
          { rel: 'update', href: `/stores/${storeId}/manuals/${rows[0].manual_id}`, method: 'PATCH' }
        ]
      });
    } catch (err) {
      console.error('매뉴얼 추가 오류:', err);
      return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
    }
  });


/**
 * @swagger
 * /stores/{store_id}/manuals/{manual_id}:
 *   patch:
 *     summary: "매뉴얼 수정"
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: store_id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: manual_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               category: { type: string }
 *               content: { type: string }
 *     responses:
 *       200: { description: "수정된 매뉴얼" }
 *       400: { description: "잘못된 요청" }
 *       404: { description: "매뉴얼 없음" }
 */
router.patch('/:store_id/manuals/:manual_id', isStoreOwner, async (req, res) => {
  try {
    const storeId  = parseInt(req.params.store_id, 10);
    const manualId = parseInt(req.params.manual_id, 10);
    if (Number.isNaN(storeId) || Number.isNaN(manualId)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }

    let { title, category, content } = req.body ?? {};
    if (title !== undefined) title = String(title).trim();
    if (category !== undefined) category = String(category).trim();
    if (content !== undefined) content = String(content).trim();

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (title !== undefined)    { updates.push(`title = $${paramIndex++}`);    values.push(title);    }
    if (category !== undefined) { updates.push(`category = $${paramIndex++}`); values.push(category); }
    if (content !== undefined)  {
      updates.push(`content = $${paramIndex++}`);
      values.push(content);
      // content 변경 시 임베딩 재생성
      const embedding = await generateEmbedding(content);
      updates.push(`embedding = $${paramIndex++}`);
      values.push(toSql(embedding));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '수정할 내용을 입력해주세요.' });
    }

    updates.push('edited_at = NOW()');
    values.push(storeId, manualId);

    const { rows } = await pool.query(
      `UPDATE manuals SET ${updates.join(', ')}
       WHERE store_id = $${paramIndex} AND manual_id = $${paramIndex + 1}
       RETURNING manual_id, store_id, title, category, content, edited_at`,
      values
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: '매뉴얼을 찾을 수 없습니다.' });
    }

    return res.json({
      ...rows[0],
      _links: [
        { rel: 'self', href: `/stores/${storeId}/manuals/${manualId}`, method: 'PATCH' },
        { rel: 'list', href: `/stores/${storeId}/manuals`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('매뉴얼 수정 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /stores/{store_id}/products:
 *   get:
 *     summary: "가게 상품 목록 조회"
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: store_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "상품 목록" }
 *   post:
 *     summary: "상품 추가"
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: store_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, price]
 *             properties:
 *               name: { type: string }
 *               price: { type: integer }
 *     responses:
 *       201: { description: "상품 추가 완료" }
 *       400: { description: "잘못된 요청" }
 */
router.route('/:store_id/products')
  .get(async (req, res) => {
    try {
      const storeId = parseInt(req.params.store_id, 10);
      if (Number.isNaN(storeId)) return res.status(400).json({ error: '유효하지 않은 가게 ID입니다.' });

      const { page, limit, offset } = parsePagination(req.query);

      const countRes = await pool.query('SELECT COUNT(*)::int FROM products WHERE store_id = $1', [storeId]);
      const total = countRes.rows[0].count;

      const { rows } = await pool.query(
        'SELECT product_id, store_id, name, price FROM products WHERE store_id = $1 LIMIT $2 OFFSET $3',
        [storeId, limit, offset]
      );

      return res.json({
        data: rows, total, page, limit,
        _links: [
          { rel: 'self', href: `/stores/${storeId}/products`, method: 'GET' },
          { rel: 'create', href: `/stores/${storeId}/products`, method: 'POST' }
        ]
      });
    } catch (err) {
      console.error('가게 상품 목록 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .post(isStoreOwner, async (req, res) => {
    try {
      const storeId = parseInt(req.params.store_id, 10);
      if (Number.isNaN(storeId)) return res.status(400).json({ error: '유효하지 않은 가게 ID입니다.' });

      const { name, price } = req.body ?? {};
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'name은 비어 있을 수 없습니다.' });
      }
      if (!Number.isInteger(price)) {
        return res.status(400).json({ error: 'price의 형식은 integer이어야 합니다.' });
      }

      const { rows } = await pool.query(
        `INSERT INTO products (store_id, name, price) VALUES ($1, $2, $3)
         RETURNING product_id, store_id, name, price`,
        [storeId, name.trim(), price]
      );

      return res.status(201).json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/stores/${storeId}/products`, method: 'POST' },
          { rel: 'update', href: `/products/${rows[0].product_id}`, method: 'PATCH' }
        ]
      });
    } catch (err) {
      console.error('상품 추가 오류:', err);
      return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
    }
  });

/**
 * @swagger
 * /stores/{store_id}/solutions:
 *   get:
 *     summary: "상담 솔루션 분석"
 *     description: "최근 N시간(최대 24) 동안의 상담 요약을 AI가 분석하여 트렌드/솔루션을 제공합니다."
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: store_id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: hours
 *         schema: { type: integer, default: 24, minimum: 1, maximum: 24 }
 *         description: "분석 범위 (시간, 기본 24, 최대 24)"
 *     responses:
 *       200: { description: "솔루션 분석 결과" }
 *       404: { description: "분석할 상담이 없음" }
 */
router.get('/:store_id/solutions', isStoreOwner, async (req, res) => {
  try {
    const storeId = parseInt(req.params.store_id, 10);
    if (Number.isNaN(storeId)) return res.status(400).json({ error: '유효하지 않은 가게 ID입니다.' });

    let hours = parseInt(req.query.hours, 10);
    if (Number.isNaN(hours) || hours < 1) hours = 24;
    if (hours > 24) hours = 24;

    // 1. 최근 N시간 상담 조회 (summary 있는 것만)
    const { rows: cases } = await pool.query(
      `SELECT case_id, category, emotion, summary, created_at
       FROM cases
       WHERE store_id = $1
         AND created_at >= NOW() - INTERVAL '1 hour' * $2
         AND summary IS NOT NULL
       ORDER BY created_at DESC`,
      [storeId, hours]
    );

    if (cases.length === 0) {
      return res.status(404).json({ error: `최근 ${hours}시간 동안 분석할 상담이 없습니다.` });
    }

    // 2. 코드로 통계 계산 (정확한 숫자)
    const { rows: byCategory } = await pool.query(
      `SELECT category, COUNT(*)::int AS count FROM cases
       WHERE store_id = $1 AND created_at >= NOW() - INTERVAL '1 hour' * $2 AND summary IS NOT NULL
       GROUP BY category ORDER BY count DESC`,
      [storeId, hours]
    );
    const { rows: byEmotion } = await pool.query(
      `SELECT emotion, COUNT(*)::int AS count FROM cases
       WHERE store_id = $1 AND created_at >= NOW() - INTERVAL '1 hour' * $2 AND summary IS NOT NULL AND emotion IS NOT NULL
       GROUP BY emotion ORDER BY count DESC`,
      [storeId, hours]
    );

    const stats = {
      by_category: byCategory.map(r => ({ category: r.category || '미분류', count: r.count })),
      by_emotion: byEmotion.map(r => ({ emotion: r.emotion, count: r.count })),
    };

    // 3. AI에 넘길 텍스트 구성 (통계 + summary)
    const statsText = [
      `총 상담: ${cases.length}건 / 기간: 최근 ${hours}시간`,
      `카테고리별: ${stats.by_category.map(r => `${r.category} ${r.count}건`).join(', ')}`,
      `감정별: ${stats.by_emotion.map(r => `${r.emotion} ${r.count}건`).join(', ')}`,
    ].join('\n');

    const summaryText = cases
      .map(r => `카테고리: ${r.category || '미분류'} | 감정: ${r.emotion || '없음'} | 요약: ${r.summary}`)
      .join('\n');

    // 4. AI 분석 (해석 + 솔루션만)
    const { analyzeSolutions } = await import('../bedrock.js');
    const aiAnalysis = await analyzeSolutions(statsText, summaryText);

    return res.json({
      store_id: storeId,
      hours,
      total_cases: cases.length,
      stats,
      ai_analysis: aiAnalysis,
      _links: [{ rel: 'self', href: `/stores/${storeId}/solutions?hours=${hours}`, method: 'GET' }]
    });
  } catch (err) {
    console.error('솔루션 분석 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
