// src/routes/shipments.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

const ALLOWED_EVENT_TYPES = new Set(['집하처리', '간선상차', '간선하차', '배송출고', '배송완료']);

/**
 * @swagger
 * tags:
 *   - name: Shipments
 *     description: "배송 API"
 */

/**
 * @swagger
 * /shipments:
 *   post:
 *     summary: "배송 추가"
 *     tags: [Shipments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [order_id, store_id]
 *             properties:
 *               order_id: { type: integer }
 *               store_id: { type: integer }
 *               tracking_no: { type: string }
 *               carrier: { type: string }
 *               promised_at: { type: string, format: date-time }
 *     responses:
 *       201: { description: "배송 생성 완료" }
 *       400: { description: "잘못된 요청" }
 */
router.post('/', async (req, res) => {
  const { order_id, store_id, tracking_no, carrier, promised_at } = req.body ?? {};

  if (!order_id || !store_id) {
    return res.status(400).json({ error: '필수 입력값(order_id, store_id)이 누락되었습니다.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO shipments (order_id, store_id, tracking_no, carrier, promised_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING shipment_id, order_id, store_id, tracking_no, carrier, promised_at, delivered_at`,
      [order_id, store_id, tracking_no ?? null, carrier ?? null, promised_at ?? null]
    );
    return res.status(201).json({
      ...rows[0],
      _links: [
        { rel: 'self', href: '/shipments', method: 'POST' },
        { rel: 'get_shipment', href: `/shipments/${rows[0].shipment_id}`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('배송 추가 오류:', err);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});


/**
 * @swagger
 * /shipments/{shipment_id}:
 *   get:
 *     summary: "배송 단건 조회"
 *     tags: [Shipments]
 *     parameters:
 *       - in: path
 *         name: shipment_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "배송 정보" }
 *       404: { description: "배송 없음" }
 *   patch:
 *     summary: "배송 정보 수정"
 *     tags: [Shipments]
 *     parameters:
 *       - in: path
 *         name: shipment_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tracking_no: { type: string }
 *               carrier: { type: string }
 *               promised_at: { type: string, format: date-time }
 *               delivered_at: { type: string, format: date-time }
 *     responses:
 *       200: { description: "수정된 배송" }
 *       400: { description: "잘못된 요청" }
 *       404: { description: "배송 없음" }
 */
router.route('/:shipment_id')
  .get(async (req, res) => {
    try {
      const shipmentId = parseInt(req.params.shipment_id, 10);
      if (Number.isNaN(shipmentId)) {
        return res.status(400).json({ error: '유효하지 않은 배송 ID입니다.' });
      }

      const { rows } = await pool.query(
        `SELECT shipment_id, order_id, store_id, tracking_no, carrier,
                promised_at, delivered_at
         FROM shipments WHERE shipment_id = $1`,
        [shipmentId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: '배송을 찾을 수 없습니다.' });
      }

      return res.json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/shipments/${shipmentId}`, method: 'GET' },
          { rel: 'update', href: `/shipments/${shipmentId}`, method: 'PATCH' },
          { rel: 'tracks', href: `/shipments/${shipmentId}/tracks`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('배송 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .patch(async (req, res) => {
    try {
      const shipmentId = parseInt(req.params.shipment_id, 10);
      if (Number.isNaN(shipmentId)) {
        return res.status(400).json({ error: '유효하지 않은 배송 ID입니다.' });
      }

      const ALLOWED_FIELDS = ['tracking_no', 'carrier', 'promised_at', 'delivered_at'];
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

      values.push(shipmentId);
      const { rows } = await pool.query(
        `UPDATE shipments SET ${updates.join(', ')} WHERE shipment_id = $${idx}
         RETURNING shipment_id, order_id, store_id, tracking_no, carrier,
                   promised_at, delivered_at`,
        values
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: '배송을 찾을 수 없습니다.' });
      }

      return res.json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/shipments/${shipmentId}`, method: 'PATCH' },
          { rel: 'get_shipment', href: `/shipments/${shipmentId}`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('배송 수정 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });


/**
 * @swagger
 * /shipments/{shipment_id}/tracks:
 *   get:
 *     summary: "배송이력 목록 조회"
 *     tags: [Shipments]
 *     parameters:
 *       - in: path
 *         name: shipment_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "배송이력 목록" }
 *   post:
 *     summary: "배송이력 추가"
 *     tags: [Shipments]
 *     parameters:
 *       - in: path
 *         name: shipment_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [event_at, event_type, location]
 *             properties:
 *               event_at: { type: string, format: date-time }
 *               event_type: { type: string, enum: ["집하처리","간선상차","간선하차","배송출고","배송완료"] }
 *               location: { type: string }
 *     responses:
 *       201: { description: "배송이력 추가 완료" }
 *       400: { description: "잘못된 요청" }
 */
router.route('/:shipment_id/tracks')
  .get(async (req, res) => {
    try {
      const shipmentId = parseInt(req.params.shipment_id, 10);
      if (Number.isNaN(shipmentId)) {
        return res.status(400).json({ error: '유효하지 않은 배송 ID입니다.' });
      }

      const { rows } = await pool.query(
        `SELECT track_id, shipment_id, event_at, event_type, location
         FROM tracks WHERE shipment_id = $1 ORDER BY event_at ASC`,
        [shipmentId]
      );

      return res.json({
        data: rows,
        _links: [
          { rel: 'self', href: `/shipments/${shipmentId}/tracks`, method: 'GET' },
          { rel: 'shipment', href: `/shipments/${shipmentId}`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('배송이력 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  .post(async (req, res) => {
    try {
      const shipmentId = parseInt(req.params.shipment_id, 10);
      if (Number.isNaN(shipmentId)) {
        return res.status(400).json({ error: '유효하지 않은 배송 ID입니다.' });
      }

      const { event_at, event_type, location } = req.body ?? {};

      if (!event_at || !event_type || !location) {
        return res.status(400).json({ error: '필수 입력값(event_at, event_type, location)이 누락되었습니다.' });
      }
      if (!ALLOWED_EVENT_TYPES.has(event_type)) {
        return res.status(400).json({ error: `event_type은 ${[...ALLOWED_EVENT_TYPES].join(' | ')} 중 하나여야 합니다.` });
      }

      const { rows } = await pool.query(
        `INSERT INTO tracks (shipment_id, event_at, event_type, location)
         VALUES ($1, $2, $3, $4)
         RETURNING track_id, shipment_id, event_at, event_type, location`,
        [shipmentId, event_at, event_type, location]
      );

      return res.status(201).json({
        ...rows[0],
        _links: [
          { rel: 'self', href: `/shipments/${shipmentId}/tracks`, method: 'POST' },
          { rel: 'shipment', href: `/shipments/${shipmentId}`, method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('배송이력 추가 오류:', err);
      return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
    }
  });


/**
 * @swagger
 * /shipments/{shipment_id}/tracks/{track_id}:
 *   patch:
 *     summary: "배송이력 수정"
 *     tags: [Shipments]
 *     parameters:
 *       - in: path
 *         name: shipment_id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: track_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event_at: { type: string, format: date-time }
 *               event_type: { type: string, enum: ["집하처리","간선상차","간선하차","배송출고","배송완료"] }
 *               location: { type: string }
 *     responses:
 *       200: { description: "수정된 배송이력" }
 *       400: { description: "잘못된 요청" }
 *       404: { description: "배송이력 없음" }
 */
router.patch('/:shipment_id/tracks/:track_id', async (req, res) => {
  try {
    const shipmentId = parseInt(req.params.shipment_id, 10);
    const trackId    = parseInt(req.params.track_id, 10);
    if (Number.isNaN(shipmentId) || Number.isNaN(trackId)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }

    const { event_at, event_type, location } = req.body ?? {};
    const updates = [];
    const values = [];
    let idx = 1;

    if (event_at !== undefined)   { updates.push(`event_at = $${idx++}`);   values.push(event_at);   }
    if (event_type !== undefined) {
      if (!ALLOWED_EVENT_TYPES.has(event_type)) {
        return res.status(400).json({ error: `event_type은 ${[...ALLOWED_EVENT_TYPES].join(' | ')} 중 하나여야 합니다.` });
      }
      updates.push(`event_type = $${idx++}`);
      values.push(event_type);
    }
    if (location !== undefined)   { updates.push(`location = $${idx++}`);   values.push(location);   }

    if (updates.length === 0) {
      return res.status(400).json({ error: '수정할 내용을 입력해주세요.' });
    }

    values.push(trackId, shipmentId);
    const { rows } = await pool.query(
      `UPDATE tracks SET ${updates.join(', ')}
       WHERE track_id = $${idx} AND shipment_id = $${idx + 1}
       RETURNING track_id, shipment_id, event_at, event_type, location`,
      values
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: '배송이력을 찾을 수 없습니다.' });
    }

    return res.json({
      ...rows[0],
      _links: [
        { rel: 'self', href: `/shipments/${shipmentId}/tracks/${trackId}`, method: 'PATCH' },
        { rel: 'tracks', href: `/shipments/${shipmentId}/tracks`, method: 'GET' }
      ]
    });
  } catch (err) {
    console.error('배송이력 수정 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
