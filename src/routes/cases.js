import express from 'express';
import pool from '../db.js';
import { assignAgentByLeastConnections } from '../utils/assignAgent.js';
const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Cases:
 *       type: object
 *       properties:
 *         case_id:
 *           type: integer
 *           description: 상담 고유 ID
 *         customer_id:
 *           type: integer
 *           description: 고객 ID
 *         agent_id:
 *           type: integer
 *           description: 상담원 ID
 *         title:
 *           type: string
 *           description: 상담 제목
 *         category_id:
 *           type: integer
 *           description: 카테고리 ID
 *         status:
 *           type: string
 *           description: 상담 상태 (대기, 상담, 완료)
 *           example: "대기"
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: 생성 일시
 *         closed_at:
 *           type: string
 *           format: date-time
 *           description: 종료 일시
 *         memo:
 *           type: string
 *           description: 상담 메모
 *         emotion_id:
 *           type: integer
 *           description: 고객 만족도 점수 (e.g., 1~5)
 *         content:
 *           type: string
 *           description: 상담 내용
 *         order_id:
 *           type: integer
 *           description: 관련 주문 ID
 */

/**
 * @swagger
 * tags:
 *   - name: Cases
 *     description: 상담 케이스 관리 API
 */

// 정렬 함수
const getOrderByClause = (sortBy, order) => {
  const validOrder = (order && order.toLowerCase() === 'asc') ? 'ASC' : 'DESC';
  switch (sortBy) {
    case 'category':
      return `ORDER BY category_id ${validOrder}`;
    case 'satisfaction':
      return `ORDER BY emotion_id ${validOrder}`;
    case 'status':
      return `ORDER BY CASE status WHEN '대기' THEN 1 WHEN '상담' THEN 2 WHEN '완료' THEN 3 ELSE 4 END ${validOrder}, created_at DESC`;
    case 'createdAt':
    default:
      return `ORDER BY created_at ${validOrder}`;
  }
};

/**
 * @swagger
 * /cases/by-agent/{agent_id}:
 *   get:
 *     summary: 특정 상담원의 상담 목록 조회
 *     tags: [Cases]
 *     parameters:
 *       - in: path
 *         name: agent_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 상담원 ID
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [category, createdAt, status, satisfaction]
 *         description: 정렬 기준
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: 정렬 순서
 *     responses:
 *       '200':
 *         description: 상담원 별 상담 기록 조회에 성공했습니다.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Case'
 *       '500':
 *         description: 서버 오류
 */
router.get('/by-agent/:agent_id', async (req, res) => {
  try {
    const { agent_id } = req.params;
    const { sortBy, order } = req.query;

    const query =
      'SELECT * FROM cases WHERE agent_id = $1 ' + getOrderByClause(sortBy, order);

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
 *     summary: 특정 고객의 상담 목록 조회
 *     tags: [Cases]
 *     parameters:
 *       - in: path
 *         name: customer_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 고객 ID
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [category, createdAt, status, satisfaction]
 *         description: 정렬 기준
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: 정렬 순서
 *     responses:
 *       '200':
 *         description: 특정 고객의 상담 목록 조회에 성공했습니다.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Case'
 *       '500':
 *         description: 서버 오류
 */
router.get('/by-customer/:customer_id', async (req, res) => {
  try {
    const { customer_id } = req.params;
    const { sortBy, order } = req.query;

    const query =
      'SELECT * FROM cases WHERE customer_id = $1 ' + getOrderByClause(sortBy, order);

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
 *     summary: 신규 상담 생성 (상담원 자동 배정)
 *     tags: [Cases]
 *     description: 상담 신청 시 맡고 있는 상담 건수가 가장 적은 상담원에게 자동으로 배정합니다.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer_id, title, category_id, content]
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
 *       '201':
 *         description: 상담 문의에 성공했습니다.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Case'
 *       '400':
 *         description: 필수 입력값이 누락되었습니다.
 *       '503':
 *         description: 현재 배정 가능한 상담원이 없습니다.
 *       '500':
 *         description: 서버 오류
 */
router.post('/', async (req, res) => {
  // 상담사는 자동 배정
  const { customer_id, title, category_id, content, order_id } = req.body;

  // 필수 값 검증
  if (!customer_id || !title || !category_id || !content) {
    return res
      .status(400)
      .json({ error: '필수 입력값(customer_id, title, category_id, content)이 누락되었습니다.' });
  }

  try {
    // 1. 가장 한가한 상담원 ID를 받음
    const agentIdToAssign = await assignAgentByLeastConnections();

    // 2. 배정할 상담원이 없으면 에러 반환
    if (!agentIdToAssign) {
      return res.status(503).json({
        error: '현재 모든 상담원이 통화 중이거나 오프라인 상태입니다.',
      });
    }

    // 3. 받아온 상담원 ID로 새로운 상담 추가
    const insertQuery = `
      INSERT INTO cases (customer_id, agent_id, title, category_id, content, order_id, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, '대기', NOW())
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

export default router;
