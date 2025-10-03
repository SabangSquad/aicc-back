import express from 'express';
const router = express.Router();

/**
 * @swagger
 * /demands:
 *   get:
 *     summary: 요청 전체 목록 조회 (페이징/필터링/정렬 지원)
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           example: refund
 *         description: 요청 타입 (refund, exchange 등)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           example: 1
 *         description: 페이지 번호 (기본값 1)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           example: 20
 *         description: 한 페이지 당 항목 개수 (기본값 20)
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           example: requested_at
 *         description: 정렬 기준 컬럼
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           example: desc
 *         description: 정렬 순서
 *     responses:
 *       200:
 *         description: 요청 목록 (페이징된 결과)
 *         content:
 *           application/json:
 *             example:
 *               page: 1
 *               limit: 20
 *               total_items: 125
 *               total_pages: 7
 *               data:
 *                 - demand_id: 21
 *                   order_id: 1001
 *                   customer_id: 55
 *                   reason_code: "REFUND"
 *                   type: "환불"
 *                   requested_at: "2025-09-01T10:00:00"
 */
router.get('/', (req, res) => {
  // query 파라미터 추출
  const { type, page = 1, limit = 20, sort = 'requested_at', order = 'desc' } = req.query;

  // Mock 데이터 (DB 연결 전용)
  const total_items = 125;
  const total_pages = Math.ceil(total_items / limit);

  const data = [
    { demand_id: 21, order_id: 1001, customer_id: 55, reason_code: "REFUND", type: "환불", requested_at: "2025-09-01T10:00:00" },
    { demand_id: 22, order_id: 1002, customer_id: 72, reason_code: "EXCHANGE", type: "교환", requested_at: "2025-09-01T11:00:00" }
  ];

  res.json({
    page: Number(page),
    limit: Number(limit),
    total_items,
    total_pages,
    data
  });
});

export default router;
