import express from 'express';
const router = express.Router();

/**
 * @swagger
 * /shipments/{shipment_id}/events:
 *   get:
 *     summary: 특정 배송 이벤트 조회
 *     parameters:
 *       - in: path
 *         name: shipment_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 이벤트 목록
 *         content:
 *           application/json:
 *             example:
 *               - shipment_event_id: 1
 *                 shipment_id: 1
 *                 event_at: "2025-10-01"
 *                 event_type: "도착"
 *                 location: "서울"
 */
router.get('/shipments/:shipment_id/events', (req, res) => {
  res.json([{ shipment_event_id: 1, shipment_id: req.params.shipment_id, event_at: "2025-10-01", event_type: "도착", location: "서울" }]);
});

export default router;
