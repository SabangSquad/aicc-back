import express from 'express';
import pool from '../db.js';
const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Agents:
 * 		   type: Object
 *       properties:
 *         		
 * 
 * /agents/{id}:
 *   get:
 *     summary: 상담원 상세 조회
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 상담원 ID
 *     responses:
 *       200:
 *         description: 상담원 정보
 *         content:
 *           application/json:
 *             example:
 *               agent_id: 1
 *               name: "김상담"
 *               is_online: true
 *               phone: "010-1111-2222"
 *               email: "agent@test.com"
 *   patch:
 *     summary: 상담원 상세 수정
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 상담원 ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           example:
 *             name: "김상담"
 *             is_online: true
 *             phone: 010-1111-2222
 *             email: "agent@test.com"
 *     responses:
 *       200:
 *         description: 수정된 상담원 정보
 *         content:
 *           application/json:
 *             example:
 *               agent_id: 1
 *               name: "김상담"
 *               is_online: true
 *               phone: 010-1111-2222
 *               email: "agent@test.com"
 */
router.route('/:id')
  // 상담원 상세 조회
  .get(async (req, res) => {
    try {
      const { id } = req.params;
      const agentId = parseInt(id, 10);

      if (isNaN(agentId)) {
        return res.status(400).json({ error: '유효하지 않은 상담원 ID입니다.' });
      }

      const result = await pool.query(
        'SELECT agent_id, name, is_online, phone, email FROM agents WHERE agent_id = $1',
        [agentId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '상담원을 찾을 수 없습니다.' });
      }

      res.json(result.rows[0]);
    } 
    catch (err) {
      console.error('상담원 조회 오류:', err);
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  })
  // 상담원 정보 수정 - name, is_online, phone, email
  .patch(async (req, res) => {
    try {
      const { id } = req.params;
      const agentId = parseInt(id, 10);

      if (isNaN(agentId)) {
        return res.status(400).json({ error: '유효하지 않은 상담원 ID입니다.' });
      }

      const { name, is_online, phone, email } = req.body;
      
      // is_online 값이 boolean이 아닐 경우 예외 처리
      if (is_online !== undefined && typeof is_online !== 'boolean') {
        return res.status(400).json({ error: 'is_online 필드는 boolean 값이어야 합니다.' });
      }

      const fields = { name, is_online, phone, email };

      const updates = [];
      const values = [];
      let paramIndex = 1;

      // 요청 본문에 포함된 필드만 동적으로 SET 절에 추가
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
          updates.push(`${key} = $${paramIndex++}`);
          values.push(value);
        }
      }

      // 수정할 필드가 하나도 없으면 오류 응답
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

      // 수정된 상담원 정보를 그대로 응답
      res.status(200).json(result.rows[0]);

    } catch (err) {
      console.error('상담원 수정 오류:', err);
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });

export default router;

