// src/routes/agents.js
import express from 'express';
import pool from '../db.js';
const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Agents
 *     description: 상담원 API
 */

/**
 * @swagger
 * /agents/{id}:
 *   get:
 *     summary: 상담원 상세 조회
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 상담원 ID
 *     responses:
 *       200:
 *         description: 상담원 정보
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 agent_id:
 *                   type: integer
 *                   description: 상담원 ID
 *                 name:
 *                   type: string
 *                   description: 상담원 이름
 *                 is_online:
 *                   type: boolean
 *                   description: 온라인 여부
 *                 phone:
 *                   type: string
 *                   description: 연락처
 *                 email:
 *                   type: string
 *                   format: email
 *                   description: 이메일
 *             example:
 *               agent_id: 1
 *               name: "김상담"
 *               is_online: true
 *               phone: "010-1111-2222"
 *               email: "agent@test.com"
 *       400:
 *         description: 잘못된 요청
 *       404:
 *         description: 상담원 없음
 *       500:
 *         description: 서버 오류
 *   patch:
 *     summary: 상담원 상세 수정
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 상담원 ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               is_online:
 *                 type: boolean
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *           example:
 *             name: "김상담"
 *             is_online: true
 *             phone: "010-1111-2222"
 *             email: "agent@test.com"
 *     responses:
 *       200:
 *         description: 수정된 상담원 정보
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 agent_id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 is_online:
 *                   type: boolean
 *                 phone:
 *                   type: string
 *                 email:
 *                   type: string
 *                   format: email
 *             example:
 *               agent_id: 1
 *               name: "김상담"
 *               is_online: true
 *               phone: "010-1111-2222"
 *               email: "agent@test.com"
 *       400:
 *         description: 잘못된 요청
 *       404:
 *         description: 상담원 없음
 *       500:
 *         description: 서버 오류
 */

/**
 * @swagger
 * /agents/{id}/is_online:
 *   patch:
 *     summary: 상담원 온라인 상태 변경
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 상담원 ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - is_online
 *             properties:
 *               is_online:
 *                 type: boolean
 *                 description: 온라인 여부
 *           example:
 *             is_online: false
 *     responses:
 *       200:
 *         description: 변경된 온라인 상태와 상담원 정보
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 agent_id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 is_online:
 *                   type: boolean
 *                 phone:
 *                   type: string
 *                 email:
 *                   type: string
 *                   format: email
 *       400:
 *         description: 잘못된 요청
 *       404:
 *         description: 상담원 없음
 *       500:
 *         description: 서버 오류
 */

/**
 * @swagger
 * /agents/{id}/cases:
 *   get:
 *     summary: 상담원이 맡은 상담 목록
 *     description: 필터로 상담 상태/감정/카테고리, 페이지네이션 지원
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 상담원 ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [waiting, chatting, closed]
 *         description: 상담 상태 필터
 *       - in: query
 *         name: emotion_id
 *         schema:
 *           type: integer
 *         description: 감정 상태 필터
 *       - in: query
 *         name: category_id
 *         schema:
 *           type: integer
 *         description: 카테고리 필터
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
 *         description: 최대 100까지 허용
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
 *                       case_id:
 *                         type: integer
 *                       title:
 *                         type: string
 *                       status:
 *                         type: string
 *                         enum: [waiting, chatting, closed]
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
 *         description: 잘못된 요청
 *       500:
 *         description: 서버 오류
 */

/**
 * @swagger
 * /agents/{id}/satisfactions:
 *   get:
 *     summary: 상담원의 상담 만족도 조회
 *     description: 기간 필터 지원 (created_at 기준)
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 상담원 ID
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: 시작 시각(포함)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: 종료 시각(포함)
 *     responses:
 *       200:
 *         description: 만족도 이력
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
 *                       score:
 *                         type: integer
 *                         description: "만족도"
 *                       comment:
 *                         type: string
 *                         nullable: true
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                 meta:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: integer
 *                     avg_score:
 *                       type: number
 *                       format: float
 *       400:
 *         description: 잘못된 요청
 *       500:
 *         description: 서버 오류
 */


router.route('/:id')
  .get(async (req, res) => {
    try {
      const agentId = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(agentId)) {
        return res.status(400).json({ error: '유효하지 않은 상담원 ID입니다.' });
      }

      const result = await pool.query(
        'SELECT agent_id, name, is_online, phone, email FROM agents WHERE agent_id = $1',
        [agentId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '상담원을 찾을 수 없습니다.' });
      }

      return res.json(result.rows[0]);
    } catch (err) {
      console.error('상담원 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .patch(async (req, res) => {
    try {
      const agentId = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(agentId)) {
        return res.status(400).json({ error: '유효하지 않은 상담원 ID입니다.' });
      }

      let { name, is_online, phone, email } = req.body ?? {};
      if (name !== undefined) name = String(name).trim();
      if (phone !== undefined) phone = String(phone).trim();
      if (email !== undefined) email = String(email).trim();

      if (is_online !== undefined && typeof is_online !== 'boolean') {
        return res.status(400).json({ error: 'is_online 필드는 boolean 값이어야 합니다.' });
      }

      if (email !== undefined && email.length > 0) {
        const simpleEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!simpleEmail.test(email)) {
          return res.status(400).json({ error: '유효하지 않은 이메일 형식입니다.' });
        }
      }

      const fields = { name, is_online, phone, email };
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

      values.push(agentId);

      const updateQuery = `
        UPDATE agents
        SET ${updates.join(', ')}
        WHERE agent_id = $${paramIndex}
        RETURNING agent_id, name, is_online, phone, email
      `;
      const result = await pool.query(updateQuery, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '수정할 상담원을 찾을 수 없습니다.' });
      }

      return res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error('상담원 수정 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });


router.patch('/:id/is_online', async (req, res) => {
  try {
    const agentId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(agentId)) {
      return res.status(400).json({ error: '유효하지 않은 상담원 ID입니다.' });
    }
    const { is_online } = req.body ?? {};
    if (typeof is_online !== 'boolean') {
      return res.status(400).json({ error: 'is_online 필드는 boolean 값이어야 합니다.' });
    }

    const result = await pool.query(
      `UPDATE agents
       SET is_online = $1
       WHERE agent_id = $2
       RETURNING agent_id, name, is_online, phone, email`,
      [is_online, agentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '상담원을 찾을 수 없습니다.' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('온라인 상태 변경 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});


router.get('/:id/cases', async (req, res) => {
  try {
    const agentId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(agentId)) {
      return res.status(400).json({ error: '유효하지 않은 상담원 ID입니다.' });
    }

    const { status, emotion_id, category_id } = req.query;

    const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
    const offset = (page - 1) * limit;

    const where = ['c.agent_id = $1'];
    const params = [agentId];
    let idx = 2;

    if (status !== undefined) {
      where.push(`c.status = $${idx++}`);
      params.push(String(status));
    }
    if (emotion_id !== undefined) {
      where.push(`c.emotion_id = $${idx++}`);
      params.push(parseInt(emotion_id, 10));
    }
    if (category_id !== undefined) {
      where.push(`c.category_id = $${idx++}`);
      params.push(parseInt(category_id, 10));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

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
    console.error('상담 목록 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});


router.get('/:id/satisfactions', async (req, res) => {
  try {
    const agentId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(agentId)) {
      return res.status(400).json({ error: '유효하지 않은 상담원 ID입니다.' });
    }

    const { from, to } = req.query;
    const where = ['c.agent_id = $1'];
    const params = [agentId];
    let idx = 2;

    if (from) {
      where.push(`s.collected_at >= $${idx++}`);
      params.push(new Date(from));
    }
    if (to) {
      where.push(`s.collected_at <= $${idx++}`);
      params.push(new Date(to));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const listSql = `
      SELECT s.case_id, s.score, s.comment, s.collected_at
      FROM satisfactions s
      JOIN cases c ON c.case_id = s.case_id
      ${whereSql}
      ORDER BY s.collected_at DESC
    `;
    const aggSql = `
      SELECT COUNT(*)::int AS count, AVG(s.score)::float AS avg_score
      FROM satisfactions s
      JOIN cases c ON c.case_id = s.case_id
      ${whereSql}
    `;

    const [listRes, aggRes] = await Promise.all([
      pool.query(listSql, params),
      pool.query(aggSql, params),
    ]);

    return res.json({
      data: listRes.rows,
      meta: {
        count: aggRes.rows[0]?.count ?? 0,
        avg_score: aggRes.rows[0]?.avg_score ?? null,
      },
    });
  } catch (err) {
    console.error('만족도 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
