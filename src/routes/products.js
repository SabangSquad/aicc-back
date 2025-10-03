import express from 'express';
const router = express.Router();

/**
 * @swagger
 * /products:
 *   get:
 *     summary: 전체 상품 목록 조회
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 상품 목록
 *         content:
 *           application/json:
 *             example:
 *               - product_id: 1
 *                 product_name: "노트북"
 *                 price: 1200000
 */
router.get('/', (req, res) => {
  res.json([{ product_id: 1, product_name: "노트북", price: 1200000 }]);
});

export default router;
