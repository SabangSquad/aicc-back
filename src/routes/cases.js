// src/routes/cases.js
import express from 'express';
import pool from '../db.js';
import { ALL_STATUSES, MUTABLE_STATUSES, CASE_STATUS } from '../constants/caseStatus.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Cases
 *     description: "상담 API"
 */

/**
 * @swagger
 * /cases:
 *   post:
 *     summary: "신규 상담 생성"
 *     tags: [Cases]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer_id, store_id]
 *             properties:
 *               customer_id: { type: integer }
 *               store_id: { type: integer }
 *               order_id: { type: integer }
 *               reservation_id: { type: integer }
 *               category: { type: string }
 *     responses:
 *       201: { description: "상담 생성 완료" }
 *       400: { description: "잘못된 요청" }
 *       500: { description: "서버 오류" }
 */
router.post('/', async (req, res) => {
  const { customer_id, store_id, order_id, reservation_id, category } = req.body ?? {};

  if (!customer_id || !store_id) {
    return res.status(400).json({ error: '필수 입력값(customer_id, store_id)이 누락되었습니다.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO cases (customer_id, store_id, order_id, reservation_id, category, status, created_at)
       VALUES ($1, $2, $3, $4, $5, '대기', NOW())
       RETURNING case_id, customer_id, store_id, order_id, reservation_id, category, status, created_at`,
      [customer_id, store_id, order_id ?? null, reservation_id ?? null, category ?? null]
    );
    const newCase = rows[0];
    return res.status(201).json({
      ...newCase,
      _links: [
        { rel: 'self', href: '/cases', method: 'POST' },
        { rel: 'get_case', href: `/cases/${newCase.case_id}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('상담 생성 오류:', err);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /cases/{case_id}:
 *   get:
 *     summary: "상담 정보 조회"
 *     tags: [Cases]
 *     parameters:
 *       - in: path
 *         name: case_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "상담 정보" }
 *       404: { description: "상담 없음" }
 *   patch:
 *     summary: "상담 정보 수정"
 *     tags: [Cases]
 *     parameters:
 *       - in: path
 *         name: case_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: ["대기","상담","종료"] }
 *               summary: { type: string }
 *               emotion: { type: string, enum: ["평온","기쁨","슬픔","화남","짜증"] }
 *               category: { type: string }
 *     responses:
 *       200: { description: "수정된 상담" }
 *       400: { description: "잘못된 요청" }
 *       404: { description: "상담 없음" }
 */
router.route('/:case_id')
  .get(async (req, res) => {
    try {
      const caseId = Number.parseInt(req.params.case_id, 10);
      if (Number.isNaN(caseId)) {
        return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
      }

      const { rows } = await pool.query(
        `SELECT case_id, customer_id, store_id, order_id, reservation_id,
                category, status, summary, emotion,
                created_at, closed_at
         FROM cases WHERE case_id = $1`,
        [caseId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: '상담을 찾을 수 없습니다.' });
      }

      return res.json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/cases/${caseId}`, method: 'GET' },
          { rel: 'update_case', href: `/cases/${caseId}`, method: 'PATCH' },
          { rel: 'add_satisfaction', href: `/cases/${caseId}/satisfactions`, method: 'POST' },
          { rel: 'get_satisfactions', href: `/cases/${caseId}/satisfactions`, method: 'GET' },
          { rel: 'get_messages', href: `/cases/${caseId}/messages`, method: 'GET' },
          { rel: 'add_message', href: `/cases/${caseId}/messages`, method: 'POST' }
        ]
      });
    } catch (err) {
      console.error('상담 정보 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .patch(async (req, res) => {
    try {
      const caseId = Number.parseInt(req.params.case_id, 10);
      if (Number.isNaN(caseId)) {
        return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
      }

      const body = req.body ?? {};
      const allowedKeys = new Set(['status', 'summary', 'emotion', 'category']);
      const extras = Object.keys(body).filter(k => !allowedKeys.has(k));
      if (extras.length) {
        return res.status(400).json({ error: `지원하지 않는 필드: ${extras.join(', ')}` });
      }

      const hasStatus   = Object.prototype.hasOwnProperty.call(body, 'status');
      const hasSummary  = Object.prototype.hasOwnProperty.call(body, 'summary');
      const hasEmotion  = Object.prototype.hasOwnProperty.call(body, 'emotion');
      const hasCategory = Object.prototype.hasOwnProperty.call(body, 'category');

      if (!hasStatus && !hasSummary && !hasEmotion && !hasCategory) {
        return res.status(400).json({
          error: '수정할 필드를 본문에 포함하세요. (status, summary, emotion, category 중 최소 1개)'
        });
      }

      const sets = [];
      const params = [];

      if (hasStatus) {
        if (typeof body.status !== 'string') {
          return res.status(400).json({ error: 'status는 문자열이어야 합니다.' });
        }
        const s = body.status.trim();
        if (!MUTABLE_STATUSES.has(s)) {
          return res.status(400).json({ error: `status는 ${[...MUTABLE_STATUSES].join(' | ')} 중 하나여야 합니다.` });
        }

        params.push(s);
        sets.push(`status = $${params.length}`);
        params.push(s);
        const cmpIdx = params.length;
        sets.push(`
          closed_at = CASE
            WHEN $${cmpIdx}::text = '종료' AND status <> '종료' THEN NOW()
            WHEN $${cmpIdx}::text IN ('대기','상담') THEN NULL
            ELSE closed_at
          END
        `);
      }

      if (hasSummary) {
        if (body.summary === null) {
          sets.push(`summary = NULL`);
        } else if (typeof body.summary === 'string' && body.summary.trim().length > 0) {
          params.push(body.summary.trim());
          sets.push(`summary = $${params.length}`);
        } else {
          return res.status(400).json({ error: 'summary는 비어있지 않은 문자열이거나 null이어야 합니다.' });
        }
      }

      if (hasEmotion) {
        const ALLOWED_EMOTIONS = new Set(['평온', '기쁨', '슬픔', '화남', '짜증']);
        if (body.emotion === null) {
          sets.push(`emotion = NULL`);
        } else if (typeof body.emotion === 'string' && ALLOWED_EMOTIONS.has(body.emotion.trim())) {
          params.push(body.emotion.trim());
          sets.push(`emotion = $${params.length}`);
        } else {
          return res.status(400).json({ error: `emotion은 ${[...ALLOWED_EMOTIONS].join(' | ')} 중 하나이거나 null이어야 합니다.` });
        }
      }

      if (hasCategory) {
        if (body.category === null) {
          sets.push(`category = NULL`);
        } else if (typeof body.category === 'string' && body.category.trim().length > 0) {
          params.push(body.category.trim());
          sets.push(`category = $${params.length}`);
        } else {
          return res.status(400).json({ error: 'category는 비어있지 않은 문자열이거나 null이어야 합니다.' });
        }
      }

      params.push(caseId);
      const sql = `
        UPDATE cases
        SET ${sets.join(', ')}
        WHERE case_id = $${params.length}
        RETURNING case_id, store_id, order_id, reservation_id, status, summary, emotion, category, closed_at
      `;

      const { rows, rowCount } = await pool.query(sql, params);
      if (!rowCount) {
        return res.status(404).json({ error: '상담을 찾을 수 없습니다.' });
      }

      // status → '종료' 시 비동기 분석 (섹션 7)
      if (hasStatus && body.status.trim() === CASE_STATUS.CLOSED) {
        setImmediate(async () => {
          try {
            const { analyzeCaseConversation } = await import('../bedrock.js');
            const { rows: msgs } = await pool.query(
              `SELECT speaker, content FROM messages WHERE case_id = $1 ORDER BY occurred_at ASC`,
              [caseId]
            );
            if (!msgs.length) return;
            const { rows: storeRows } = await pool.query(
              'SELECT s.category FROM cases c LEFT JOIN stores s ON c.store_id = s.store_id WHERE c.case_id = $1',
              [caseId]
            );
            const storeCategory = storeRows[0]?.category || null;
            const conversationText = msgs.map(m => `${m.speaker}: ${m.content}`).join('\n');
            const analysis = await analyzeCaseConversation(conversationText, storeCategory);
            await pool.query(
              `UPDATE cases SET emotion = $1, summary = $2, category = COALESCE($3, category) WHERE case_id = $4`,
              [analysis.json?.emotion ?? null, analysis.json?.summary ?? null, analysis.json?.category ?? null, caseId]
            );
          } catch (err) {
            console.error(`[종료 에이전트] 케이스 ${caseId} 분석 실패:`, err.message);
          }
        });
      }

      return res.status(200).json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/cases/${caseId}`, method: 'PATCH' },
          { rel: 'get_case', href: `/cases/${caseId}`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('상담 수정 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });


/**
 * @swagger
 * /cases/{case_id}/satisfactions:
 *   post:
 *     summary: "상담 만족도 추가"
 *     tags: [Cases]
 *     parameters:
 *       - in: path
 *         name: case_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [store_id, score]
 *             properties:
 *               store_id: { type: integer }
 *               score: { type: number, example: 4.5, description: "0.5~5 (0.5 간격)" }
 *     responses:
 *       201: { description: "만족도 추가 완료" }
 *       400: { description: "잘못된 요청" }
 *       404: { description: "상담 없음" }
 *   get:
 *     summary: "상담 만족도 조회"
 *     tags: [Cases]
 *     parameters:
 *       - in: path
 *         name: case_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "만족도 목록" }
 */
router.route('/:case_id/satisfactions')
  .post(async (req, res) => {
    try {
      const caseId = Number.parseInt(req.params.case_id, 10);
      if (Number.isNaN(caseId)) {
        return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
      }

      const { store_id, score } = req.body ?? {};
      const nScore = Number.parseFloat(score);
      if (Number.isNaN(nScore) || nScore < 0.5 || nScore > 5 || (nScore * 2) % 1 !== 0) {
        return res.status(400).json({ error: 'score는 0.5~5 범위의 0.5 간격이어야 합니다. (0.5, 1, 1.5, ... 5)' });
      }
      if (!store_id) {
        return res.status(400).json({ error: 'store_id가 필요합니다.' });
      }

      const sql = `
        INSERT INTO satisfactions (case_id, store_id, score)
        SELECT $1, $2, $3
        WHERE EXISTS (SELECT 1 FROM cases WHERE case_id = $1)
        RETURNING satisfaction_id, case_id, store_id, score, collected_at
      `;
      const { rows } = await pool.query(sql, [caseId, store_id, nScore]);

      if (rows.length === 0) {
        return res.status(404).json({ error: '상담을 찾을 수 없습니다.' });
      }

      return res.status(201).json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/cases/${caseId}/satisfactions`, method: 'POST' },
          { rel: 'case', href: `/cases/${caseId}`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('만족도 등록 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .get(async (req, res) => {
    try {
      const caseId = Number.parseInt(req.params.case_id, 10);
      if (Number.isNaN(caseId)) {
        return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
      }

      const { rows } = await pool.query(
        'SELECT satisfaction_id, case_id, store_id, score, collected_at FROM satisfactions WHERE case_id = $1',
        [caseId]
      );

      return res.json({
        data: rows,
        _links: [
          { rel: 'self', href: `/cases/${caseId}/satisfactions`, method: 'GET' },
          { rel: 'case', href: `/cases/${caseId}`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('만족도 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });


/**
 * @swagger
 * /cases/{case_id}/messages:
 *   get:
 *     summary: "상담 메시지 조회"
 *     description: "상담의 메시지 목록을 반환합니다. 메시지가 없는 경우 빈 배열로 200 응답."
 *     tags: [Cases]
 *     parameters:
 *       - in: path
 *         name: case_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "메시지 목록 (없으면 빈 배열)" }
 *   post:
 *     summary: "상담 메시지 추가"
 *     tags: [Cases]
 *     parameters:
 *       - in: path
 *         name: case_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content, speaker]
 *             properties:
 *               content: { type: string }
 *               speaker: { type: string, enum: ["챗봇","상담사","고객"] }
 *     responses:
 *       201: { description: "메시지 추가 완료" }
 *       400: { description: "잘못된 요청" }
 */
router.route('/:case_id/messages')
  .get(async (req, res) => {
    try {
      const caseId = Number.parseInt(req.params.case_id, 10);
      if (Number.isNaN(caseId)) {
        return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
      }

      const { rows } = await pool.query(
        'SELECT message_id, case_id, occurred_at, content, speaker FROM messages WHERE case_id = $1 ORDER BY occurred_at ASC',
        [caseId]
      );

      return res.json({
        data: rows,
        _links: [
          { rel: 'self', href: `/cases/${caseId}/messages`, method: 'GET' },
          { rel: 'case', href: `/cases/${caseId}`, method: 'GET' },
          { rel: 'add_message', href: `/cases/${caseId}/messages`, method: 'POST' }
        ]
      });
    } catch (err) {
      console.error('메시지 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .post(async (req, res) => {
    const caseId = Number.parseInt(req.params.case_id, 10);
    if (Number.isNaN(caseId)) {
      return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
    }

    const { content, speaker } = req.body ?? {};

    if (typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'content는 비어 있을 수 없습니다.' });
    }

    const ALLOWED_SPEAKERS = new Set(['챗봇', '상담사', '고객']);
    if (typeof speaker !== 'string' || !ALLOWED_SPEAKERS.has(speaker)) {
      return res.status(400).json({ error: "speaker는 '챗봇' | '상담사' | '고객' 중 하나여야 합니다." });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO messages (case_id, content, speaker, occurred_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING message_id, occurred_at, content, speaker`,
        [caseId, content, speaker]
      );

      return res.status(201).json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/cases/${caseId}/messages`, method: 'POST' },
          { rel: 'case', href: `/cases/${caseId}`, method: 'GET' },
          { rel: 'get_messages', href: `/cases/${caseId}/messages`, method: 'GET' }
        ]
      });
    } catch (err) {
      return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
    }
  });

export default router;
