// src/routes/agents.js
import express from 'express';
import pool from '../db.js';
const router = express.Router();

/**
 * @swagger
 * tags:
 *  - name: Agents
 *    description: 상담원 API
 */

/**
 * @swagger
 * /agents/{agent_id}:
 *  get:
 *    summary: 상담원 정보 조회
 *    description: 해당 상담원의 정보를 조회합니다.
 *    tags: [Agents]
 *    parameters:
 *      - in: path
 *        name: agent_id
 *        required: true
 *        schema:
 *          type: integer
 *        description: 상담원 ID
 *    responses:
 *      200:
 *        description: 상담원 정보
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                agent_id:
 *                  type: integer
 *                  description: 상담원 ID
 *                name:
 *                  type: string
 *                  description: 상담원 이름
 *                is_online:
 *                  type: boolean
 *                  description: 온라인 여부
 *                phone:
 *                  type: string
 *                  description: 연락처
 *                email:
 *                  type: string
 *                  format: email
 *                  description: 이메일
 *                _links:
 *                  type: array
 *                  items:
 *                    type: object
 *            example:
 *              agent_id: 1
 *              name: "김상담"
 *              is_online: true
 *              phone: "010-1111-2222"
 *              email: "agent@test.com"
 *              _links:
 *                - rel: "self"
 *                  href: "/agents/1"
 *                  method: "GET"
 *                - rel: "update"
 *                  href: "/agents/1"
 *                  method: "PATCH"
 *                - rel: "cases"
 *                  href: "/agents/1/cases"
 *                  method: "GET"
 *                - rel: "satisfactions"
 *                  href: "/agents/1/satisfactions"
 *                  method: "GET"
 *      400:
 *        description: 잘못된 요청
 *      404:
 *        description: 상담원 없음
 *      500:
 *        description: 서버 오류
 *  patch:
 *    summary: 상담원 정보 수정
 *    description: 해당 상담원의 정보를 수정합니다. 
 *    tags: [Agents]
 *    parameters:
 *      - in: path
 *        name: agent_id
 *        required: true
 *        schema:
 *          type: integer
 *        description: 상담원 ID
 *    requestBody:
 *      required: true
 *      content:
 *        application/json:
 *          schema:
 *            type: object
 *            properties:
 *              name:
 *                type: string
 *              is_online:
 *                type: boolean
 *              phone:
 *                type: string
 *              email:
 *                type: string
 *                format: email
 *          example:
 *            name: "김상담"
 *            is_online: true
 *            phone: "010-1111-2222"
 *            email: "agent@test.com"
 *    responses:
 *      200:
 *        description: 수정된 상담원 정보
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                agent_id:
 *                  type: integer
 *                name:
 *                  type: string
 *                is_online:
 *                  type: boolean
 *                phone:
 *                  type: string
 *                email:
 *                  type: string
 *                  format: email
 *                _links:
 *                  type: array
 *            example:
 *              agent_id: 1
 *              name: "김상담"
 *              is_online: true
 *              phone: "010-1111-2222"
 *              email: "agent@test.com"
 *              _links:
 *                - rel: "self"
 *                  href: "/agents/1"
 *                  method: "GET"
 *                - rel: "cases"
 *                  href: "/agents/1/cases"
 *                  method: "GET"
 *      400:
 *        description: 잘못된 요청
 *      404:
 *        description: 상담원 없음
 *      500:
 *        description: 서버 오류
 */

router.route('/:agent_id')
  .get(async (req, res) => {
    try {
      const agentId = Number.parseInt(req.params.agent_id, 10);
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

      return res.json({
        ...result.rows[0],
        _links: [
          { rel: 'self', href: `/agents/${agentId}`, method: 'GET' },
          { rel: 'update', href: `/agents/${agentId}`, method: 'PATCH' },
          { rel: 'cases', href: `/agents/${agentId}/cases`, method: 'GET' },
          { rel: 'satisfactions', href: `/agents/${agentId}/satisfactions`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('상담원 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .patch(async (req, res) => {
    try {
      const agentId = Number.parseInt(req.params.agent_id, 10);
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

      return res.status(200).json({
        ...result.rows[0],
        _links: [
          { rel: 'self', href: `/agents/${agentId}`, method: 'GET' },
          { rel: 'cases', href: `/agents/${agentId}/cases`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('상담원 수정 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });

/**
 * @swagger
 * /agents/{agent_id}/cases:
 *  get:
 *    summary: 상담원이 맡은 상담 목록 조회
 *    description: | 
 *      해당 상담원이 맡은 상담 목록을 조회합니다.    
 *      - 상담 상태/감정/카테고리 필터가 존재합니다.
 *    tags: [Agents]
 *    parameters:
 *      - in: path
 *        name: agent_id
 *        required: true
 *        schema:
 *          type: integer
 *        description: 상담원 ID
 *      - in: query
 *        name: status
 *        schema:
 *          type: string
 *          enum: [대기, 상담, 종료, AI자동해결]
 *        description: 상담 상태 필터
 *      - in: query
 *        name: emotion
 *        schema:
 *          type: string
 *          enum: [평온, 기쁨, 슬픔, 화남, 짜증]
 *        description: 감정 상태 필터
 *      - in: query
 *        name: category
 *        schema:
 *          type: string
 *          enum: [취소, 교환, 반품, 반품비, 회수, 취소철회, 배송일정, 배송완료미수령, 상품파손, 해외배송, 상품누락, 주소검색, 배송비, 포장, 상품문의, 
 *                 상품후기, 가입, 탈퇴, 개인정보설정, 로그인, 로그아웃, 인증, 비밀번호관리, 신용카드, 결제수단, 무통장입금, 할인쿠폰, 주문, 주문확인, 포인트]
 *        description: 카테고리 필터
 *    responses:
 *      200:
 *        description: 상담 목록
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                data:
 *                  type: array
 *                  items:
 *                    type: object
 *                    properties:
 *                      agent_id: 
 *                        type: integer 
 *                        description: 상담원 ID
 *                      case_id: 
 *                        type: integer 
 *                        description: 상담 ID
 *                      customer_id:
 *                        type: integer
 *                        description: 고객 ID
 *                      title:
 *                        type: string
 *                        description: 상담 제목
 *                      status:  
 *                        type: string
 *                        description: 상담 상태
 *                      created_at:
 *                        type: string
 *                        format: date-time
 *                        description: 상담 생성 시각
 *                      closed_at:
 *                        type: string
 *                        format: date-time
 *                        nullable: true
 *                        description: 상담 종료 시각
 *                      memo:
 *                        type: string
 *                        description: 메모
 *                      content:
 *                        type: string
 *                        description: 상담 내용
 *                      order_id:
 *                        type: integer
 *                        description: 주문 ID
 *                      category:
 *                        type: string
 *                        description: 카테고리
 *                      emotion:
 *                        type: string
 *                        description: 고객 감정
 *                _links:
 *                  type: array
 *            example:
 *              data:
 *                - agent_id: 1
 *                  case_id: 1
 *                  customer_id: 1
 *                  title: "환불하고 싶어요."
 *                  status: "대기"
 *                  created_at: "2025-09-01T04:08:31.231Z"
 *                  closed_at: null
 *                  memo: "화가 많이 남"
 *                  content: "상품 품질이 정말 별로네요."
 *                  order_id: 1
 *                  category: "환불"
 *                  emotion: "화남"
 *              _links:
 *                - rel: "self"
 *                  href: "/agents/1/cases"
 *                  method: "GET"
 *                - rel: "agent"
 *                  href: "/agents/1"
 *                  method: "GET"
 *      400:
 *        description: 잘못된 요청
 *      500:
 *        description: 서버 오류
 */

router.get('/:agent_id/cases', async (req, res) => {
  try {
    const agentId = Number.parseInt(req.params.agent_id, 10);
    if (!Number.isInteger(agentId) || agentId <= 0) {
      return res.status(400).json({ error: '유효하지 않은 상담원 ID입니다.' });
    }

    const { status, emotion, category } = req.query;

    const where = ['c.agent_id = $1'];
    const params = [agentId];
    let idx = 2;

    if (status !== undefined) {
      const st = String(status).trim();
      if (st.length === 0) {
        return res.status(400).json({ error: 'status는 빈 문자열일 수 없습니다.' });
      }
      const ALLOWED_STATUS = new Set(['대기', '상담', '종료', 'AI자동해결']);
      if (!ALLOWED_STATUS.has(st)) return res.status(400).json({ error: 'status는 대기, 상담, 종료, AI자동해결 중 하나여야 합니다.' });

      where.push(`c.status = $${idx++}`);
      params.push(st);
    }

    if (emotion !== undefined) {
      const emo = String(emotion).trim();
      if (emo.length === 0) {
        return res.status(400).json({ error: 'emotion은 빈 문자열일 수 없습니다.' });
      }
      where.push(`c.emotion = $${idx++}`);
      params.push(emo);
    }

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
      SELECT c.agent_id, c.case_id, c.customer_id, c.title, c.status, c.created_at, c.closed_at, c.memo, c.content, c.order_id, c.category, c.emotion
      FROM cases c
      ${whereSql}
      ORDER BY c.created_at DESC
    `;

    const { rows } = await pool.query(listSql, params);
    return res.json({ 
      data: rows,
      _links: [
        { rel: 'self', href: `/agents/${agentId}/cases${req._parsedUrl.search || ''}`, method: 'GET' },
        { rel: 'agent', href: `/agents/${agentId}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('상담 목록 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /agents/{agent_id}/satisfactions:
 *  get:
 *    summary: 상담원의 상담 만족도 조회
 *    description: |
 *      해당 상담원이 맡았던 상담의 만족도를 조회합니다.      
 *      - collected_at 기준 필터가 존재합니다.
 *    tags: [Agents]
 *    parameters:
 *      - in: path
 *        name: agent_id
 *        required: true
 *        schema:
 *          type: integer
 *        description: 상담원 ID
 *      - in: query
 *        name: from
 *        schema:
 *          type: string
 *          format: date-time
 *        description: 시작 시각(포함, collected_at 기준)
 *      - in: query
 *        name: to
 *        schema:
 *          type: string
 *          format: date-time
 *        description: 종료 시각(포함, collected_at 기준)
 *    responses:
 *      200:
 *        description: 만족도 이력
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                data:
 *                  type: array
 *                  items:
 *                    type: object
 *                    properties:
 *                      case_id:
 *                        type: integer
 *                      score:
 *                        type: integer
 *                        description: "만족도"
 *                      comment:
 *                        type: string
 *                        nullable: true
 *                      collected_at:
 *                        type: string
 *                        format: date-time
 *                _links:
 *                  type: array
 *            example:
 *              data:
 *                - case_id: 1
 *                  score: 5
 *                  comment: "너무 친절하셔요"
 *                  collected_at: "2025-09-01T04:08:31.231Z"
 *              _links:
 *                - rel: "self"
 *                  href: "/agents/1/satisfactions"
 *                  method: "GET"
 *                - rel: "agent"
 *                  href: "/agents/1"
 *                  method: "GET"
 *      400:
 *        description: 잘못된 요청
 *      500:
 *        description: 서버 오류
 */

router.get('/:agent_id/satisfactions', async (req, res) => {
  try {
    const agentId = Number.parseInt(req.params.agent_id, 10);
    if (!Number.isInteger(agentId) || agentId <= 0) {
      return res.status(400).json({ error: '유효하지 않은 상담원 ID입니다.' });
    }

    const { from, to } = req.query;

    let fromDate = null;
    let toDate = null;

    if (from !== undefined) {
      fromDate = new Date(from);
      if (Number.isNaN(fromDate.getTime())) {
        return res.status(400).json({ error: 'from은 ISO 날짜 형식이어야 합니다.' });
      }
    }
    if (to !== undefined) {
      toDate = new Date(to);
      if (Number.isNaN(toDate.getTime())) {
        return res.status(400).json({ error: 'to은 ISO 날짜 형식이어야 합니다.' });
      }
    }
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      return res.status(400).json({ error: 'from은 to보다 클 수 없습니다.' });
    }

    const where = ['c.agent_id = $1'];
    const params = [agentId];
    let idx = 2;

    if (fromDate) {
      where.push(`s.collected_at >= $${idx++}`);
      params.push(fromDate);
    }
    if (toDate) {
      where.push(`s.collected_at <= $${idx++}`);
      params.push(toDate);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    const listSql = `
      SELECT s.case_id, s.score, s.comment, s.collected_at
      FROM satisfactions s
      JOIN cases c ON c.case_id = s.case_id
      ${whereSql}
      ORDER BY s.collected_at DESC
    `;

    const { rows } = await pool.query(listSql, params);
    return res.json({
      data: rows,
      _links: [
        { rel: 'self', href: `/agents/${agentId}/satisfactions${req._parsedUrl.search || ''}`, method: 'GET' },
        { rel: 'agent', href: `/agents/${agentId}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('만족도 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;