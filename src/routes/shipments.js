// src/routes/shipments.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Shipments
 *     description: "주문 배송 API"
 */

/**
 * @swagger
 * /shipments/{shipment_id}:
 *   get:
 *     summary: "주문 배송상태 조회"
 *     description: "shipment 단건의 배송 정보를 조회합니다."
 *     tags:
 *       - Shipments
 *     parameters:
 *       - in: path
 *         name: shipment_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "배송 ID"
 *     responses:
 *       200:
 *         description: "배송 정보"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 shipment_id: { type: integer }
 *                 order_id: { type: integer }
 *                 carrier: { type: string }
 *                 tracking_no: { type: string, description: "운송장 번호" }
 *                 promised_at: { type: string, format: date, description: "도착 예정 일자" }
 *                 delivered_at: { type: string, format: date-time, nullable: true, description: "실제 도착 시각" }
 *                 requirement: { type: string, nullable: true, description: "고객 메모/요청사항" }
 *             example:
 *               shipment_id: 501
 *               order_id: 1001
 *               carrier: "CJ대한통운"
 *               tracking_no: "1234-5678-9012"
 *               promised_at: "2025-10-11"
 *               delivered_at: null
 *               requirement: "문 앞에 놓아주세요"
 *       400: { description: "잘못된 요청" }
 *       404: { description: "배송 정보 없음" }
 *       500: { description: "서버 오류" }
 */
router.get('/:shipment_id', async (req, res) => {
  try {
    const shipmentId = parseInt(req.params.shipment_id, 10);
    if (Number.isNaN(shipmentId)) {
      return res.status(400).json({ error: '유효하지 않은 배송 ID입니다.' });
    }

    const sql = `
      SELECT shipment_id, order_id, carrier, tracking_no, promised_at, delivered_at, requirement
      FROM shipments
      WHERE shipment_id = $1
    `;
    const { rows } = await pool.query(sql, [shipmentId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: '배송 정보를 찾을 수 없습니다.' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('배송 정보 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /shipments/{shipment_id}/events:
 *   get:
 *     summary: "주문 배송상태 상세 조회"
 *     description: "배송 이력 이벤트를 시간순으로 반환합니다."
 *     tags:
 *       - Shipments
 *     parameters:
 *       - in: path
 *         name: shipment_id
 *         required: true
 *         schema: { type: integer }
 *         description: "배송 ID"
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: "asc"
 *         description: "정렬 순서(시간 기준)"
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *         description: "페이지 번호"
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *         description: "페이지 크기(최대 200)"
 *     responses:
 *       200:
 *         description: "배송 이벤트 목록"
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
 *                       shipment_event_id: { type: integer }
 *                       shipment_id: { type: integer }
 *                       event_at: { type: string, format: date-time }
 *                       event_type: { type: string }
 *                       location: { type: string, nullable: true }
 *                 meta:
 *                   type: object
 *                   properties:
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *                     total: { type: integer }
 *             example:
 *               data:
 *                 - shipment_event_id: 9001
 *                   shipment_id: 501
 *                   event_at: "2025-10-09T04:00:00Z"
 *                   event_type: "picked_up"
 *                   location: "서울 중구"
 *                 - shipment_event_id: 9002
 *                   shipment_id: 501
 *                   event_at: "2025-10-09T08:30:00Z"
 *                   event_type: "in_transit"
 *                   location: "성남 분류센터"
 *               meta: { page: 1, limit: 50, total: 2 }
 *       400: { description: "잘못된 요청" }
 *       404: { description: "배송 정보 없음" }
 *       500: { description: "서버 오류" }
 */
router.get('/:shipment_id/events', async (req, res) => {
  try {
    const shipmentId = parseInt(req.params.shipment_id, 10);
    if (Number.isNaN(shipmentId)) {
      return res.status(400).json({ error: '유효하지 않은 배송 ID입니다.' });
    }

    const exists = await pool.query(
      'SELECT 1 FROM shipments WHERE shipment_id = $1',
      [shipmentId]
    );
    if (exists.rowCount === 0) {
      return res.status(404).json({ error: '배송 정보를 찾을 수 없습니다.' });
    }

    const order = (req.query.order || 'asc').toString().toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '50', 10)));
    const offset = (page - 1) * limit;

    const listSql = `
      SELECT shipment_event_id, shipment_id, event_at, event_type, location
      FROM shipment_events
      WHERE shipment_id = $1
      ORDER BY event_at ${order}, shipment_event_id ${order}
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countSql = `
      SELECT COUNT(*) AS total
      FROM shipment_events
      WHERE shipment_id = $1
    `;

    const [listRes, countRes] = await Promise.all([
      pool.query(listSql, [shipmentId]),
      pool.query(countSql, [shipmentId]),
    ]);

    const total = Number(countRes.rows[0]?.total ?? 0);

    return res.json({
      data: listRes.rows,
      meta: { page, limit, total },
    });
  } catch (err) {
    console.error('배송 이벤트 조회 오류:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
