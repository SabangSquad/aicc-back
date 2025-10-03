import express from 'express';
const router = express.Router();

/**
 * @swagger
 * /shipments:
 *   get:
 *     summary: 주문별 배송 조회
 *     parameters:
 *       - in: query
 *         name: order_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 배송 정보
 *         content:
 *           application/json:
 *             example:
 *               shipment_id: 1
 *               order_id: 1
 *               carrier_code: "CJ"
 *               status: "in_transit"
 */
router.get('/', (req, res) => {
  res.json([{ shipment_id: 1, order_id: req.query.order_id, carrier_code: "CJ", status: "in_transit" }]);
});

export default router;
