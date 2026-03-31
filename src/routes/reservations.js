// src/routes/reservations.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

const RESERVATION_STATUSES = new Set(['완료', '취소']);

/**
 * @swagger
 * tags:
 *   - name: Reservations
 *     description: "예약 API"
 */

/**
 * @swagger
 * /reservations:
 *   post:
 *     summary: "예약 추가"
 *     tags: [Reservations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [store_id, customer_id, reserved_at]
 *             properties:
 *               store_id: { type: integer }
 *               customer_id: { type: integer }
 *               reserved_at: { type: string, format: date-time }
 *               headcount: { type: integer }
 *     responses:
 *       201: { description: "예약 생성 완료" }
 *       400: { description: "잘못된 요청" }
 */
router.post('/', async (req, res) => {
  const { store_id, customer_id, reserved_at, headcount } = req.body ?? {};

  if (!store_id || !customer_id || !reserved_at) {
    return res.status(400).json({ error: '필수 입력값(store_id, customer_id, reserved_at)이 누락되었습니다.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO reservations (store_id, customer_id, reserved_at, status, headcount)
       VALUES ($1, $2, $3, '완료', $4)
       RETURNING reservation_id, store_id, customer_id, reserved_at, status, headcount`,
      [store_id, customer_id, reserved_at, headcount ?? null]
    );
    return res.status(201).json({
      ...rows[0],
      _links: [
        { rel: 'self', href: '/reservations', method: 'POST' },
        { rel: 'get_reservation', href: `/reservations/${rows[0].reservation_id}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('예약 추가 오류:', err);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /reservations/{reservation_id}:
 *   get:
 *     summary: "예약 단건 조회"
 *     tags: [Reservations]
 *     parameters:
 *       - in: path
 *         name: reservation_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "예약 정보" }
 *       404: { description: "예약 없음" }
 *   patch:
 *     summary: "예약 수정"
 *     tags: [Reservations]
 *     parameters:
 *       - in: path
 *         name: reservation_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reserved_at: { type: string, format: date-time }
 *               status: { type: string, enum: ["완료","취소"] }
 *               headcount: { type: integer }
 *     responses:
 *       200: { description: "수정된 예약" }
 *       400: { description: "잘못된 요청" }
 *       404: { description: "예약 없음" }
 */
router.route('/:reservation_id')
  .get(async (req, res) => {
    try {
      const reservationId = parseInt(req.params.reservation_id, 10);
      if (Number.isNaN(reservationId)) {
        return res.status(400).json({ error: '유효하지 않은 예약 ID입니다.' });
      }

      const { rows } = await pool.query(
        `SELECT reservation_id, store_id, customer_id, reserved_at, status, headcount
         FROM reservations WHERE reservation_id = $1`,
        [reservationId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: '예약을 찾을 수 없습니다.' });
      }

      return res.json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/reservations/${reservationId}`, method: 'GET' },
          { rel: 'update', href: `/reservations/${reservationId}`, method: 'PATCH' }
        ]
      });
    } catch (err) {
      console.error('예약 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .patch(async (req, res) => {
    try {
      const reservationId = parseInt(req.params.reservation_id, 10);
      if (Number.isNaN(reservationId)) {
        return res.status(400).json({ error: '유효하지 않은 예약 ID입니다.' });
      }

      const ALLOWED_FIELDS = ['reserved_at', 'status', 'headcount'];
      const body = req.body ?? {};

      if (body.status !== undefined && !RESERVATION_STATUSES.has(body.status)) {
        return res.status(400).json({ error: "status는 '완료' | '취소' 중 하나여야 합니다." });
      }

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

      values.push(reservationId);
      const { rows } = await pool.query(
        `UPDATE reservations SET ${updates.join(', ')} WHERE reservation_id = $${idx}
         RETURNING reservation_id, store_id, customer_id, reserved_at, status, headcount`,
        values
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: '예약을 찾을 수 없습니다.' });
      }

      return res.json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/reservations/${reservationId}`, method: 'PATCH' },
          { rel: 'get_reservation', href: `/reservations/${reservationId}`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('예약 수정 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });

export default router;
