// src/routes/cases.js
import express from 'express';
import pool from '../db.js';
import { assignAgentByLeastConnections } from '../utils/assignAgent.js';

const router = express.Router();


const STATUS_COL = 'status';

/**
 * @swagger
 * tags:
 *  - name: Cases
 *    description: "상담 케이스 관리 API"
 */


/**
 * @swagger
 * /cases:
 *  post:
 *    summary: "신규 상담 생성"
 *    tags:
 *      - Cases
 *    description: "신규 상담을 생성합니다. 맡고 있는 상담 건수가 가장 적은 상담원에게 자동으로 배정됩니다."
 *    requestBody:
 *      required: true
 *      content:
 *        application/json:
 *          schema:
 *            type: object
 *            required:
 *              - customer_id
 *              - title
 *              - category
 *              - content
 *            properties:
 *              customer_id:
 *                type: integer
 *              title:
 *                type: string
 *              category:
 *                type: string
 *              content:
 *                type: string
 *              order_id:
 *                type: integer
 *          example:
 *            customer_id: 1
 *            title: "환불 문의"
 *            category: "환불"
 *            content: "제품이 마음에 들지 않습니다."
 *            order_id: 10
 *    responses:
 *      201:
 *        description: "상담 문의에 성공했습니다."
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                case_id:
 *                  type: integer
 *                  description: "상담 고유 ID"
 *                customer_id:
 *                  type: integer
 *                  description: "고객 ID"
 *                agent_id:
 *                  type: integer
 *                  description: "상담원 ID"
 *                title:
 *                  type: string
 *                  description: "상담 제목"
 *                category:
 *                  type: string
 *                  description: "카테고리"
 *                status:
 *                  type: string
 *                  enum: [대기, 상담, 종료]
 *                  description: "상담 상태"
 *                  example: "대기"
 *                created_at:
 *                  type: string
 *                  format: date-time
 *                  description: "생성 일시"
 *                closed_at:
 *                  type: string
 *                  format: date-time
 *                  description: "종료 일시"
 *                  nullable: true
 *                memo:
 *                  type: string
 *                  description: "상담 메모"
 *                  nullable: true
 *                emotion:
 *                  type: string
 *                  description: "고객 감정"
 *                  nullable: true
 *                content:
 *                  type: string
 *                  description: "상담 내용"
 *                order_id:
 *                  type: integer
 *                  description: "관련 주문 ID"
 *                  nullable: true
 *                _links:
 *                  type: array
 *            example:
 *              case_id: 1
 *              customer_id: 1
 *              agent_id: 1
 *              title: "환불 문의"
 *              category: "환불"
 *              status: "대기"
 *              created_at: "2025-09-01T04:08:31.231Z"
 *              closed_at: null
 *              _links:
 *                - rel: "self"
 *                  href: "/cases"
 *                  method: "POST"
 *                - rel: "get_case"
 *                  href: "/cases/1"
 *                  method: "GET"
 *      400:
 *        description: "필수 입력값이 누락되었습니다."
 *      53:
 *        description: "현재 배정 가능한 상담원이 없습니다."
 *      500:
 *        description: "서버 오류"
 */
router.post('/', async (req, res) => {
  const { customer_id, title, category, content, order_id } = req.body;

  if (!customer_id || !title || !category || !content) {
    return res
      .status(400)
      .json({ error: '필수 입력값(customer_id, title, category, content)이 누락되었습니다.' });
  }

  try {
    const agentIdToAssign = await assignAgentByLeastConnections();
    if (!agentIdToAssign) {
      return res.status(503).json({
        error: '현재 모든 상담원이 통화 중이거나 오프라인 상태입니다.',
      });
    }

    const insertQuery = `
      INSERT INTO cases (customer_id, agent_id, title, category, content, order_id, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, '대기', NOW())
      RETURNING *;
    `;
    const values = [customer_id, agentIdToAssign, title, category, content, order_id];

    const { rows } = await pool.query(insertQuery, values);
    const newCase = rows[0];

    return res.status(201).json({
      ...newCase,
      _links: [
        { rel: 'self', href: '/cases', method: 'POST' },
        { rel: 'get_case', href: `/cases/${newCase.case_id}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('상담 생성 및 배정 중 오류가 발생했습니다:', err);
    res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /cases/{case_id}:
 *  get:
 *    summary: "상담 정보 조회"
 *    description: "해당 상담의 정보를 조회합니다."
 *    tags:
 *      - Cases
 *    parameters:
 *      - in: path
 *        name: case_id
 *        required: true
 *        schema:
 *          type: integer
 *        description: "상담 ID"
 *    responses:
 *      200:
 *        description: "상담 정보"
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                agent_id: 
 *                  type: integer 
 *                  description: 상담원 ID
 *                case_id: 
 *                  type: integer 
 *                  description: 상담 ID
 *                customer_id:
 *                  type: integer
 *                  description: 고객 ID
 *                title:
 *                  type: string
 *                  description: 상담 제목
 *                status:  
 *                  type: string
 *                  description: 상담 상태
 *                created_at:
 *                  type: string
 *                  format: date-time
 *                  description: 상담 생성 시각
 *                closed_at:
 *                  type: string
 *                  format: date-time
 *                  nullable: true
 *                  description: 상담 종료 시각
 *                memo:
 *                  type: string
 *                  description: 메모
 *                content:
 *                  type: string
 *                  description: 상담 내용
 *                order_id:
 *                  type: integer
 *                  description: 주문 ID
 *                category:
 *                  type: string
 *                  description: 카테고리
 *                emotion:
 *                  type: string
 *                  description: 고객 감정
 *                _links:
 *                  type: array
 *            example:
 *              agent_id: 1
 *              case_id: 1
 *              customer_id: 1
 *              title: "환불하고 싶어요."
 *              status: "대기"
 *              created_at: "2025-09-01T04:08:31.231Z"
 *              closed_at: null
 *              _links:
 *                - rel: "self"
 *                  href: "/cases/1"
 *                  method: "GET"
 *                - rel: "update_case"
 *                  href: "/cases/1"
 *                  method: "PATCH"
 *                - rel: "add_satisfaction"
 *                  href: "/cases/1/satisfactions"
 *                  method: "POST"
 *                - rel: "get_messages"
 *                  href: "/cases/1/messages"
 *                  method: "GET"
 *                - rel: "get_recordings"
 *                  href: "/cases/1/recordings"
 *                  method: "GET"
 *      400:
 *        description: "잘못된 요청"
 *      404:
 *        description: "상담을 찾을 수 없습니다."
 *      500:
 *        description: "서버 오류"
 *  patch:
 *    summary: "상담 정보 수정"
 *    description: |
 *      해당 상담을 수정합니다.
 *      - 요청 바디의 `closed_at`은 **무시**됩니다.
 *      - `status`가 "종료"로 바뀌면 서버가 `closed_at = NOW()`로 자동 설정합니다.
 *      - "대기" 또는 "상담"으로 바뀌면 `closed_at = NULL`(재오픈)로 처리합니다.
 *    tags:
 *      - Cases
 *    parameters:
 *      - in: path
 *        name: case_id
 *        required: true
 *        schema:
 *          type: integer
 *        description: "상담 ID"
 *    requestBody:
 *      required: true
 *      content:
 *        application/json:
 *          schema:
 *            type: object
 *            properties:
 *              status:
 *                type: string
 *                description: '상담 상태: "대기" | "상담" | "종료"'
 *                example: "종료"
 *              memo:
 *                type: string
 *                description: "메모 (비어있지 않은 문자열)"
 *                example: "11/6 15시에 재통화 약속"
 *              emotion:
 *                type: string
 *                description: "고객 감정 (비어있지 않은 문자열)"
 *                example: "평온"
 *    responses:
 *      200:
 *        description: "수정된 상담 정보"
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                case_id:
 *                  type: integer
 *                status:
 *                  type: string
 *                memo:
 *                  type: string 
 *                  nullable: true
 *                emotion:
 *                  type: string
 *                  nullable: true
 *                closed_at:
 *                  type: string
 *                  format: date-time
 *                  nullable: true
 *                _links:
 *                  type: array
 *            example:
 *              case_id: 1 
 *              status: "상담"
 *              memo: "괜찮으심"
 *              emotion: "평온"
 *              closed_at: "2025-09-01T04:08:31.231Z"
 *              _links:
 *                - rel: "self"
 *                  href: "/cases/1"
 *                  method: "PATCH"
 *                - rel: "get_case"
 *                  href: "/cases/1"
 *                  method: "GET"
 *      400:
 *        description: "잘못된 요청"
 *      404:
 *        description: "상담을 찾을 수 없습니다."
 *      500:
 *        description: "서버 오류"
 */
router.route('/:case_id')
  .get(async (req, res) => {
    try {
      const caseId = Number.parseInt(req.params.case_id, 10);
      if (Number.isNaN(caseId)) {
        return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
      }

      const result = await pool.query(
        'SELECT c.agent_id, c.case_id, c.customer_id, c.title, c.status, c.created_at, c.closed_at, c.memo, c.content, c.order_id, c.category, c.emotion FROM cases c WHERE case_id = $1',
        [caseId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '상담을 찾을 수 없습니다.' });
      }

      return res.json({
        ...result.rows[0],
        _links: [
          { rel: 'self', href: `/cases/${caseId}`, method: 'GET' },
          { rel: 'update_case', href: `/cases/${caseId}`, method: 'PATCH' },
          { rel: 'add_satisfaction', href: `/cases/${caseId}/satisfactions`, method: 'POST' },
          { rel: 'get_messages', href: `/cases/${caseId}/messages`, method: 'GET' },
          { rel: 'add_message', href: `/cases/${caseId}/messages`, method: 'POST' },
          { rel: 'get_recordings', href: `/cases/${caseId}/recordings`, method: 'GET' },
          { rel: 'add_recording', href: `/cases/${caseId}/recordings`, method: 'POST' }
        ]
      });
    } catch (err) {
      console.error('상담 정보 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .patch( async (req, res) => {
  try {
    const caseId = Number.parseInt(req.params.case_id, 10);
    if (Number.isNaN(caseId)) {
      return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
    }

    const body = req.body || {};
    const hasStatus  = Object.prototype.hasOwnProperty.call(body, 'status');
    const hasMemo    = Object.prototype.hasOwnProperty.call(body, 'memo');
    const hasEmotion = Object.prototype.hasOwnProperty.call(body, 'emotion');

    if (!hasStatus && !hasMemo && !hasEmotion) {
      return res.status(400).json({
        error: '수정할 필드를 본문에 포함하세요. (status, memo, emotion 중 최소 1개)'
      });
    }

    const allowedKeys = new Set(['status', 'memo', 'emotion']);
    const extras = Object.keys(body).filter(k => !allowedKeys.has(k));
    if (extras.length) {
      return res.status(400).json({ error: `지원하지 않는 필드: ${extras.join(', ')}` });
    }

    const sets = [];
    const params = [];

    if (hasStatus) {
      if (typeof body.status !== 'string') {
        return res.status(400).json({ error: 'status는 문자열이어야 합니다.' });
      }
      const s = body.status.trim();
      const allowed = ['대기', '상담', '종료'];
      if (!allowed.includes(s)) {
        return res.status(400).json({ error: 'status는 대기 | 상담 | 종료 중 하나여야 합니다.' });
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

    if (hasMemo) {
      if (body.memo === null) {
        sets.push(`memo = NULL`);
      } else if (typeof body.memo === 'string' && body.memo.trim().length > 0) {
        params.push(body.memo.trim());
        sets.push(`memo = $${params.length}`);
      } else {
        return res.status(400).json({ error: 'memo는 비어있지 않은 문자열이거나 null이어야 합니다.' });
      }
    }

    if (hasEmotion) {
      if (body.emotion === null) {
        sets.push(`emotion = NULL`);
      } else if (typeof body.emotion === 'string' && body.emotion.trim().length > 0) {
        params.push(body.emotion.trim());
        sets.push(`emotion = $${params.length}`);
      } else {
        return res.status(400).json({ error: 'emotion은 비어있지 않은 문자열이거나 null이어야 합니다.' });
      }
    }

    const sql = `
      UPDATE cases
      SET ${sets.join(', ')}
      WHERE case_id = $${params.length + 1}
      RETURNING case_id, status, memo, emotion, closed_at
    `;
    params.push(caseId);

    const { rows, rowCount } = await pool.query(sql, params);
    if (!rowCount) {
      return res.status(404).json({ error: '상담을 찾을 수 없습니다.' });
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
 *  post:
 *    summary: "상담 만족도 추가"
 *    tags: [Cases]
 *    description: 해당 상담에 만족도를 추가합니다.
 *    parameters:
 *      - in: path
 *        name: case_id
 *        required: true
 *        schema: 
 *          type: integer
 *        description: "상담 ID"
 *    requestBody:
 *      required: true
 *      content:
 *        application/json:
 *          schema:
 *            type: object
 *            required: [score]
 *            properties:
 *              score:
 *                type: integer
 *                minimum: 1
 *                maximum: 5
 *              comment:
 *                type: string
 *          example:
 *            score: 4
 *            comment: "친절하게 안내해주셨어요."
 *    responses:
 *      201:
 *        description: "만족도가 등록되었습니다."
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                satisfaction_id: { type: integer }
 *                case_id: { type: integer }
 *                _links: { type: array }
 *            example:
 *              satisfaction_id: 10
 *              case_id: 1
 *              _links:
 *                - rel: "self"
 *                  href: "/cases/1/satisfactions"
 *                  method: "POST"
 *                - rel: "case"
 *                  href: "/cases/1"
 *                  method: "GET"
 *      400: 
 *        description: "잘못된 요청"
 *      404: 
 *        description: "상담을 찾을 수 없습니다."
 *      500:   
 *        description: "서버 오류"
 */

router.post('/:case_id/satisfactions', async (req, res) => {
  try {
    const caseId = Number.parseInt(req.params.case_id, 10);
    if (Number.isNaN(caseId)) {
      return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
    }

    const { score, comment } = req.body ?? {};
    const nScore = Number.parseInt(score, 10);
    if (!Number.isInteger(nScore) || nScore < 1 || nScore > 5) {
      return res.status(400).json({ error: 'score는 1~5 범위의 정수여야 합니다.' });
    }

    const normalizedComment =
      comment === undefined || comment === null
        ? null
        : String(comment).trim() || null;

    const sql = `
      INSERT INTO satisfactions (case_id, score, comment, created_at)
      SELECT $1, $2, $3, NOW()
      WHERE EXISTS (SELECT 1 FROM cases WHERE case_id = $1)
      RETURNING satisfaction_id, case_id, score, comment, created_at
    `;
    const { rows } = await pool.query(sql, [caseId, nScore, normalizedComment]);

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
});

/**
 * @swagger
 * /cases/{case_id}/messages:
 *  get:
 *    summary: "상담 메시지 조회"
 *    description:
 *      해당 상담의 메시지를 조회합니다.
 *    tags:
 *      - Cases
 *    parameters:
 *      - in: path
 *        name: case_id
 *        required: true
 *        schema:
 *          type: integer
 *        description: "상담 ID"
 *    responses:
 *      200:
 *        description: "상담 메시지 리스트"
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                data: { type: array }
 *                _links: { type: array }
 *            example:
 *              data:
 *                - message_id: 1
 *                  content: "상품이 마음에 들지 않아요."
 *                  speaker: "고객"
 *              _links:
 *                - rel: "self"
 *                  href: "/cases/1/messages"
 *                  method: "GET"
 *                - rel: "case"
 *                  href: "/cases/1"
 *                  method: "GET"
 *                - rel: "add_message"
 *                  href: "/cases/1/messages"
 *                  method: "POST"
 *      400:
 *        description: "잘못된 요청"
 *      404:
 *        description: "메시지 없음"
 *      500:
 *        description: "서버 오류"
 */

router.route('/:case_id/messages')
  .get(async (req, res) => {
    try {
      const caseId = Number.parseInt(req.params.case_id, 10);
      if (Number.isNaN(caseId)) {
        return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
      }

      const result = await pool.query(
        'SELECT message_id, case_id, occurred_at, content, speaker FROM messages WHERE case_id = $1',
        [caseId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });
      }

      return res.json({
        data: result.rows,
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


/**
 * @swagger
 * /cases/{case_id}/messages:
 *  post:
 *    summary: "상담 메시지 추가"
 *    tags: [Cases]
 *    description: 해당 상담에 메시지를 추가합니다.
 *    parameters:
 *      - in: path
 *        name: case_id
 *        required: true
 *        schema: 
 *          type: integer
 *        description: "상담 ID"
 *    requestBody:
 *      required: true
 *      content:
 *        application/json:
 *          schema:
 *            type: object
 *            required: [content, speaker]
 *            properties:
 *              content:
 *                type: string
 *              speaker:
 *                type: string
 *          example:
 *            content: "문의가 접수되었습니다."
 *            speaker: "챗봇"
 *    responses:
 *      21:
 *        description: "메시지 발송 완료"
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                content: { type: string }
 *                speaker: { type: string }
 *                _links: { type: array }
 *            example:
 *              content: "문의가 접수되었습니다."
 *              speaker: "챗봇"
 *              _links:
 *                - rel: "self"
 *                  href: "/cases/1/messages"
 *                  method: "POST"
 *                - rel: "get_messages"
 *                  href: "/cases/1/messages"
 *                  method: "GET"
 *      400: 
 *        description: "잘못된 요청"
 *      404: 
 *        description: "해당 상담을 찾을 수 없음"
 *      500:   
 *        description: "서버 오류"
 */

router.post('/:case_id/messages', async (req, res) => {

  const caseId = Number.parseInt(req.params.case_id, 10);
  if (Number.isNaN(caseId)) {
    return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
  }

  const { content, speaker } = req.body;

  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: 'content는 비어 있을 수 없습니다.' });
  }
  if (typeof speaker !== 'string' || speaker.trim().length === 0) {
    return res.status(400).json({ error: 'speaker는 비어 있을 수 없습니다.' });
  }

  try {

    const { rows } = await pool.query(
      `INSERT INTO messages (case_id, content, speaker)
       VALUES ($1, $2, $3)
       RETURNING occurred_at, content, speaker`,
      [caseId, content, speaker]
    );

    res.status(201).json({
      ...rows[0],
      _links: [
        { rel: 'self', href: `/cases/${caseId}/messages`, method: 'POST' },
        { rel: 'case', href: `/cases/${caseId}`, method: 'GET' },
        { rel: 'get_messages', href: `/cases/${caseId}/messages`, method: 'GET' }
      ]
    });
  } catch (err) {
    res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /cases/{case_id}/recordings:
 *  get:
 *    summary: "상담 녹취 조회"
 *    description:
 *      해당 상담의 녹취를 조회합니다.
 *    tags:
 *      - Cases
 *    parameters:
 *      - in: path
 *        name: case_id
 *        required: true
 *        schema:
 *          type: integer
 *        description: "상담 ID"
 *    responses:
 *      200:
 *        description: "상담 녹취 리스트"
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                data: { type: array }
 *                _links: { type: array }
 *            example:
 *              data:
 *                - file_url: "http://dummyimage.com/243x100.png"
 *              _links:
 *                - rel: "self"
 *                  href: "/cases/1/recordings"
 *                  method: "GET"
 *                - rel: "case"
 *                  href: "/cases/1"
 *                  method: "GET"
 *      400:
 *        description: "잘못된 요청"
 *      404:
 *        description: "녹취 없음"
 *      500:
 *        description: "서버 오류"
 */

router.route('/:case_id/recordings')
  .get(async (req, res) => {
    try {
      const caseId = Number.parseInt(req.params.case_id, 10);
      if (Number.isNaN(caseId)) {
        return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
      }

      const result = await pool.query(
        'SELECT file_url FROM recordings WHERE case_id = $1',
        [caseId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });
      }

      return res.json({
        data: result.rows,
        _links: [
          { rel: 'self', href: `/cases/${caseId}/recordings`, method: 'GET' },
          { rel: 'case', href: `/cases/${caseId}`, method: 'GET' },
          { rel: 'add_recording', href: `/cases/${caseId}/recordings`, method: 'POST' }
        ]
      });
    } catch (err) {
      console.error('메시지 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })


/**
 * @swagger
 * /cases/{case_id}/recordings:
 *  post:
 *    summary: "상담 녹취 추가"
 *    tags: [Cases]
 *    description: 해당 상담에 녹취를 추가합니다.
 *    parameters:
 *      - in: path
 *        name: case_id
 *        required: true
 *        schema: 
 *          type: integer
 *        description: "상담 ID"
 *    requestBody:
 *      required: true
 *      content:
 *        application/json:
 *          schema:
 *            type: object
 *            required: [file_url]
 *            properties:
 *              file_url:
 *                type: string
 *          example:
 *            file_url: "http://dummyimage.com/243x100.png"
 *    responses:
 *      201:
 *        description: "녹취 저장 완료"
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                file_url: { type: string }
 *                _links: { type: array }
 *            example:
 *              file_url: "http://dummyimage.com/243x100.png"
 *              _links:
 *                - rel: "self"
 *                  href: "/cases/1/recordings"
 *                  method: "POST"
 *                - rel: "get_recordings"
 *                  href: "/cases/1/recordings"
 *                  method: "GET"
 *      400: 
 *        description: "잘못된 요청"
 *      404: 
 *        description: "해당 상담을 찾을 수 없음"
 *      500:   
 *        description: "서버 오류"
 */

router.post('/:case_id/recordings', async (req, res) => {

  const caseId = Number.parseInt(req.params.case_id, 10);
  if (Number.isNaN(caseId)) {
    return res.status(400).json({ error: '유효하지 않은 상담 ID입니다.' });
  }

  const { file_url } = req.body;

  if (typeof file_url !== 'string' || file_url.trim().length === 0) {
    return res.status(400).json({ error: 'file_url는 비어 있을 수 없습니다.' });
  }

  try {

    const { rows } = await pool.query(
      `INSERT INTO recordings (case_id, file_url)
       VALUES ($1, $2)
       RETURNING file_url`,
      [caseId, file_url]
    );

    res.status(201).json({
      ...rows[0],
      _links: [
        { rel: 'self', href: `/cases/${caseId}/recordings`, method: 'POST' },
        { rel: 'case', href: `/cases/${caseId}`, method: 'GET' },
        { rel: 'get_recordings', href: `/cases/${caseId}/recordings`, method: 'GET' }
      ]
    });
  } catch (err) {
    res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});

export default router;