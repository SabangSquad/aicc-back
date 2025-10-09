// src/routes/cases.js
import express from 'express';
import pool from '../db.js';
import { assignAgentByLeastConnections } from '../utils/assignAgent.js';

const router = express.Router();


const STATUS_COL = 'status';

/**
 * @swagger
 * tags:
 *   - name: Cases
 *     description: "상담 케이스 관리 API"
 */

/** 정렬 함수 */
const getOrderByClause = (sortBy, order) => {
  const validOrder = (order && String(order).toLowerCase() === 'asc') ? 'ASC' : 'DESC';
  switch (sortBy) {
    case 'category':
      return `ORDER BY category_id ${validOrder}`;
    case 'satisfaction':
      return `ORDER BY emotion_id ${validOrder}`;
    case 'status':
      // waiting < chatting < closed
      return `
        ORDER BY CASE ${STATUS_COL}
          WHEN 'waiting' THEN 1
          WHEN 'chatting' THEN 2
          WHEN 'closed' THEN 3
          ELSE 4
        END ${validOrder},
        created_at DESC
      `;
    case 'createdAt':
    default:
      return `ORDER BY created_at ${validOrder}`;
  }
};

/**
 * @swagger
 * /cases/by-agent/{agent_id}:
 *   get:
 *     summary: "특정 상담원의 상담 목록 조회"
 *     tags:
 *       - Cases
 *     parameters:
 *       - in: path
 *         name: agent_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "상담원 ID"
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [category, createdAt, status, satisfaction]
 *         description: "정렬 기준"
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: "정렬 순서"
 *     responses:
 *       200:
 *         description: "상담원 별 상담 기록 조회에 성공했습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   case_id:
 *                     type: integer
 *                     description: "상담 고유 ID"
 *                   customer_id:
 *                     type: integer
 *                     description: "고객 ID"
 *                   agent_id:
 *                     type: integer
 *                     description: "상담원 ID"
 *                   title:
 *                     type: string
 *                     description: "상담 제목"
 *                   category_id:
 *                     type: integer
 *                     description: "카테고리 ID"
 *                   status:
 *                     type: string
 *                     description: "상담 상태 코드 (waiting, chatting, closed)"
 *                     example: "waiting"
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *                     description: "생성 일시"
 *                   closed_at:
 *                     type: string
 *                     format: date-time
 *                     description: "종료 일시"
 *                     nullable: true
 *                   memo:
 *                     type: string
 *                     description: "상담 메모"
 *                     nullable: true
 *                   emotion_id:
 *                     type: integer
 *                     description: "고객 만족도 점수 (예 1~5)"
 *                     nullable: true
 *                   content:
 *                     type: string
 *                     description: "상담 내용"
 *                   order_id:
 *                     type: integer
 *                     description: "관련 주문 ID"
 *                     nullable: true
 *       500:
 *         description: "서버 오류"
 */
router.get('/by-agent/:agent_id', async (req, res) => {
  try {
    const { agent_id } = req.params;
    const { sortBy, order } = req.query;

    const query = `SELECT * FROM cases WHERE agent_id = $1 ${getOrderByClause(sortBy, order)}`;
    const { rows } = await pool.query(query, [agent_id]);
    res.status(200).json(rows);
  } catch (err) {
    console.error('상담원별 상담 목록 조회 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /cases/by-customer/{customer_id}:
 *   get:
 *     summary: "특정 고객의 상담 목록 조회"
 *     tags:
 *       - Cases
 *     parameters:
 *       - in: path
 *         name: customer_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "고객 ID"
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [category, createdAt, status, satisfaction]
 *         description: "정렬 기준"
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: "정렬 순서"
 *     responses:
 *       200:
 *         description: "특정 고객의 상담 목록 조회에 성공했습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   case_id:
 *                     type: integer
 *                     description: "상담 고유 ID"
 *                   customer_id:
 *                     type: integer
 *                     description: "고객 ID"
 *                   agent_id:
 *                     type: integer
 *                     description: "상담원 ID"
 *                   title:
 *                     type: string
 *                     description: "상담 제목"
 *                   category_id:
 *                     type: integer
 *                     description: "카테고리 ID"
 *                   status:
 *                     type: string
 *                     description: "상담 상태 코드 (waiting, chatting, closed)"
 *                     example: "chatting"
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *                     description: "생성 일시"
 *                   closed_at:
 *                     type: string
 *                     format: date-time
 *                     description: "종료 일시"
 *                     nullable: true
 *                   memo:
 *                     type: string
 *                     description: "상담 메모"
 *                     nullable: true
 *                   emotion_id:
 *                     type: integer
 *                     description: "고객 만족도 점수 (예 1~5)"
 *                     nullable: true
 *                   content:
 *                     type: string
 *                     description: "상담 내용"
 *                   order_id:
 *                     type: integer
 *                     description: "관련 주문 ID"
 *                     nullable: true
 *       500:
 *         description: "서버 오류"
 */
router.get('/by-customer/:customer_id', async (req, res) => {
  try {
    const { customer_id } = req.params;
    const { sortBy, order } = req.query;

    const query = `SELECT * FROM cases WHERE customer_id = $1 ${getOrderByClause(sortBy, order)}`;
    const { rows } = await pool.query(query, [customer_id]);
    res.status(200).json(rows);
  } catch (err) {
    console.error('고객별 상담 목록 조회 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /cases:
 *   post:
 *     summary: "신규 상담 생성 (상담원 자동 배정)"
 *     tags:
 *       - Cases
 *     description: "상담 신청 시 맡고 있는 상담 건수가 가장 적은 상담원에게 자동으로 배정합니다."
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - customer_id
 *               - title
 *               - category_id
 *               - content
 *             properties:
 *               customer_id:
 *                 type: integer
 *               title:
 *                 type: string
 *               category_id:
 *                 type: integer
 *               content:
 *                 type: string
 *               order_id:
 *                 type: integer
 *           example:
 *             customer_id: 1
 *             title: "환불 문의"
 *             category_id: 3
 *             content: "제품이 마음에 들지 않습니다."
 *             order_id: 10
 *     responses:
 *       201:
 *         description: "상담 문의에 성공했습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 case_id:
 *                   type: integer
 *                   description: "상담 고유 ID"
 *                 customer_id:
 *                   type: integer
 *                   description: "고객 ID"
 *                 agent_id:
 *                   type: integer
 *                   description: "상담원 ID"
 *                 title:
 *                   type: string
 *                   description: "상담 제목"
 *                 category_id:
 *                   type: integer
 *                   description: "카테고리 ID"
 *                 status:
 *                   type: string
 *                   description: "상담 상태 코드 (waiting, chatting, closed)"
 *                   example: "waiting"
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *                   description: "생성 일시"
 *                 closed_at:
 *                   type: string
 *                   format: date-time
 *                   description: "종료 일시"
 *                   nullable: true
 *                 memo:
 *                   type: string
 *                   description: "상담 메모"
 *                   nullable: true
 *                 emotion_id:
 *                   type: integer
 *                   description: "고객 만족도 점수 (예 1~5)"
 *                   nullable: true
 *                 content:
 *                   type: string
 *                   description: "상담 내용"
 *                 order_id:
 *                   type: integer
 *                   description: "관련 주문 ID"
 *                   nullable: true
 *       400:
 *         description: "필수 입력값이 누락되었습니다."
 *       503:
 *         description: "현재 배정 가능한 상담원이 없습니다."
 *       500:
 *         description: "서버 오류"
 */
router.post('/', async (req, res) => {
  const { customer_id, title, category_id, content, order_id } = req.body;

  if (!customer_id || !title || !category_id || !content) {
    return res
      .status(400)
      .json({ error: '필수 입력값(customer_id, title, category_id, content)이 누락되었습니다.' });
  }

  try {
    const agentIdToAssign = await assignAgentByLeastConnections();
    if (!agentIdToAssign) {
      return res.status(503).json({
        error: '현재 모든 상담원이 통화 중이거나 오프라인 상태입니다.',
      });
    }

    const insertQuery = `
      INSERT INTO cases (customer_id, agent_id, title, category_id, content, order_id, ${STATUS_COL}, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'waiting', NOW())
      RETURNING *;
    `;
    const values = [customer_id, agentIdToAssign, title, category_id, content, order_id];

    const { rows } = await pool.query(insertQuery, values);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('상담 생성 및 배정 중 오류가 발생했습니다:', err);
    res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /cases/{case_id}/memo:
 *   patch:
 *     summary: "상담 메모 추가"
 *     tags:
 *       - Cases
 *     parameters:
 *       - in: path
 *         name: case_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "상담 ID"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - memo
 *             properties:
 *               memo:
 *                 type: string
 *                 description: "상담 메모 내용"
 *           example:
 *             memo: "야간에 재통화 요청"
 *     responses:
 *       200:
 *         description: "메모가 추가되었습니다."
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "상담을 찾을 수 없습니다."
 *       500:
 *         description: "서버 오류"
 */
router.patch('/:case_id/memo', async (req, res) => {
  try {
    const caseId = Number.parseInt(req.params.case_id, 10);
    if (Number.isNaN(caseId)) {
      return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
    }
    let { memo } = req.body ?? {};
    if (typeof memo !== 'string' || memo.trim().length === 0) {
      return res.status(400).json({ error: 'memo 필드는 비어있지 않은 문자열이어야 합니다.' });
    }
    memo = memo.trim();

    const result = await pool.query(
      `UPDATE cases
       SET memo = $1
       WHERE case_id = $2
       RETURNING case_id, memo`,
      [memo, caseId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '상담을 찾을 수 없습니다.' });
    }
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('상담 메모 추가 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /cases/{case_id}/status:
 *   patch:
 *     summary: "상담 상태 수정"
 *     description: "상태 값은 waiting, chatting, closed 중 하나여야 합니다."
 *     tags:
 *       - Cases
 *     parameters:
 *       - in: path
 *         name: case_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "상담 ID"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum:
 *                   - waiting
 *                   - chatting
 *                   - closed
 *                 description: "상담 상태 코드"
 *           example:
 *             status: "chatting"
 *     responses:
 *       200:
 *         description: "상태가 수정되었습니다."
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "상담을 찾을 수 없습니다."
 *       500:
 *         description: "서버 오류"
 */

router.patch('/:case_id/status', async (req, res) => {
  try {
    const caseId = Number.parseInt(req.params.case_id, 10);
    if (Number.isNaN(caseId)) {
      return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
    }

    const { status } = req.body ?? {};
    const allowed = ['waiting', 'chatting', 'closed'];
    const s = typeof status === 'string' ? status.trim().toLowerCase() : '';
    if (!allowed.includes(s)) {
      return res.status(400).json({ error: 'status는 waiting | chatting | closed 중 하나여야 합니다.' });
    }

    const setClosed = (s === 'closed'); // ← boolean으로 분리

    const sql = `
      UPDATE cases
      SET ${STATUS_COL} = $1,
          closed_at = CASE WHEN $2 THEN NOW() ELSE closed_at END
      WHERE case_id = $3
      RETURNING case_id, ${STATUS_COL} AS status
    `;
    const { rows } = await pool.query(sql, [s, setClosed, caseId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: '상담을 찾을 수 없습니다.' });
    }
    return res.status(200).json(rows[0]);
  } catch (err) {
    console.error('상담 상태 수정 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /cases/{case_id}/satisfaction:
 *   post:
 *     summary: "상담 만족도 추가"
 *     tags:
 *       - Cases
 *     parameters:
 *       - in: path
 *         name: case_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "상담 ID"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - score
 *             properties:
 *               score:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 description: "만족도 점수 (예 1~5)"
 *               comment:
 *                 type: string
 *                 description: "코멘트"
 *           example:
 *             score: 4
 *             comment: "친절하게 안내해주셨어요."
 *     responses:
 *       201:
 *         description: "만족도가 등록되었습니다."
 *       400:
 *         description: "잘못된 요청"
 *       404:
 *         description: "상담을 찾을 수 없습니다."
 *       500:
 *         description: "서버 오류"
 */
router.post('/:case_id/satisfaction', async (req, res) => {
  const client = await pool.connect();
  try {
    const caseId = Number.parseInt(req.params.case_id, 10);
    if (Number.isNaN(caseId)) {
      client.release();
      return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
    }

    const { score, comment } = req.body ?? {};
    const nScore = Number.parseInt(score, 10);
    if (!Number.isInteger(nScore) || nScore < 1 || nScore > 5) {
      client.release();
      return res.status(400).json({ error: 'score는 1~5 범위의 정수여야 합니다.' });
    }
    const commentStr = comment === undefined ? null : String(comment).trim();

    await client.query('BEGIN');

    const exist = await client.query('SELECT 1 FROM cases WHERE case_id = $1', [caseId]);
    if (exist.rowCount === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: '상담을 찾을 수 없습니다.' });
    }

    const insert = await client.query(
      `INSERT INTO satisfactions (case_id, score, comment, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING case_id, score, comment, created_at`,
      [caseId, nScore, commentStr]
    );

    await client.query(
      `UPDATE cases SET emotion_id = $1 WHERE case_id = $2`,
      [nScore, caseId]
    );

    await client.query('COMMIT');

    return res.status(201).json(insert.rows[0]);
  } catch (err) {
    try { await pool.query('ROLLBACK'); } catch (e) { /* ignore */ }
    console.error('만족도 등록 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  } finally {
    try { client.release(); } catch (e) { /* ignore */ }
  }
});

export default router;
