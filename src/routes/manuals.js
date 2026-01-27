// src/routes/manuals.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Manuals
 *     description: "매뉴얼 API"
 */

/**
 * @swagger
 * /manuals:
 *   get:
 *     summary: 매뉴얼 조회
 *     description: | 
 *       전체 매뉴얼을 조회합니다.
 *       - 카테고리 필터가 존재합니다.
 *     tags: [Manuals]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [취소, 교환, 반품, 반품비, 회수, 취소철회, 배송일정, 배송완료미수령, 상품파손, 해외배송, 상품누락, 주소검색, 배송비, 포장, 상품문의, 상품후기, 가입, 탈퇴, 개인정보설정, 로그인, 로그아웃, 인증, 비밀번호관리, 신용카드, 결제수단, 무통장입금, 할인쿠폰, 주문, 주문확인, 포인트]
 *         description: 카테고리 필터
 *     responses:
 *       200:
 *         description: 상담 목록
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
 *                       manual_id: 
 *                         type: integer 
 *                         description: 매뉴얼 ID
 *                       title:
 *                         type: string
 *                         description: 매뉴얼 제목
 *                       edited_at:  
 *                         type: string
 *                         format: date-time
 *                         description: 최근 수정 날짜
 *                       file_url:
 *                         type: string
 *                         description: 파일 URL
 *                         nullable: true
 *                       category:
 *                         type: string
 *                         description: 카테고리
 *                       content:
 *                         type: string 
 *                         description: 매뉴얼 내용
 *                       _links:
 *                         type: array
 *                 _links:
 *                   type: array
 *             example:
 *               data:
 *                 - manual_id: 1
 *                   title: "로그인 오류 해결 방법"
 *                   edited_at: "2025-09-01T04:08:31.231Z"
 *                   file_url: "http://dummyimage.com/192x100.png/ff4444/ffffff"
 *                   category: "로그인"
 *                   content: "재부팅을 요청한다."
 *                   _links:
 *                     - rel: "update"
 *                       href: "/manuals/1"
 *                       method: "PATCH"
 *               _links:
 *                 - rel: "self"
 *                   href: "/manuals"
 *                   method: "GET"
 *                 - rel: "create"
 *                   href: "/manuals"
 *                   method: "POST"
 *       400:
 *         description: 잘못된 요청
 *       500:
 *         description: 서버 오류
 */

router.get('/', async (req, res) => {
  try {

    const { category } = req.query;

    const params = [];
    let whereSql = '';

    // category: 문자열, 공백 방지
    if (category !== undefined) {
      const cat = String(category).trim();
      if (cat.length === 0) {
        return res.status(400).json({ error: 'category는 빈 문자열일 수 없습니다.' });
      }
      params.push(cat);
      whereSql = 'WHERE m.category = $1';
    }

    const listSql = `
      SELECT m.manual_id, m.title, m.edited_at, m.file_url, m.category, m.content
      FROM manuals m
      ${whereSql}
      ORDER BY m.category DESC
    `;

    const { rows } = await pool.query(listSql, params);
    
    const data = rows.map(row => ({
      ...row,
      _links: [
        { rel: 'update', href: `/manuals/${row.manual_id}`, method: 'PATCH' }
      ]
    }));

    return res.json({ 
      data,
      _links: [
        { rel: 'self', href: `/manuals${req._parsedUrl.search || ''}`, method: 'GET' },
        { rel: 'create', href: '/manuals', method: 'POST' }
      ]
    });
  } catch (err) {
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

/**
 * @swagger
 * /manuals:
 *   post:
 *     summary: "매뉴얼 추가"
 *     tags: [Manuals]
 *     description: 매뉴얼을 추가합니다.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, file_url, category, content]
 *             properties:
 *               title:
 *                 type: string
 *                 description: 매뉴얼 제목
 *               file_url:
 *                 type: string 
 *                 description: 파일 URL
 *                 nullable: true
 *               category:
 *                 type: string
 *                 description: 카테고리
 *               content:
 *                 type: string
 *                 description: 매뉴얼 내용
 *           example:
 *             title: "반품 접수 방법"
 *             file_url: "http://dummyimage.com/192x100.png/ff4444/ffffff"
 *             category: "반품"
 *             content: "반품을 접수하기 위해서는 고객의 주문 내역에서 반품 신청을 누른다."
 *     responses:
 *       201:
 *         description: "매뉴얼 추가 완료"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 manual_id:
 *                   type: integer
 *                   description: 매뉴얼 ID
 *                 title: 
 *                   type: string
 *                   description: 매뉴얼 제목
 *                 edited_at:
 *                   type: string
 *                   format: date-time
 *                   description: 최근 수정 날짜
 *                 file_url: 
 *                   type: string
 *                   description: 파일 URL
 *                 category:
 *                   type: string
 *                   description: 카테고리
 *                 content:
 *                   type: string
 *                   description: 매뉴얼 내용
 *                 _links:
 *                   type: array
 *             example:
 *               manual_id: 1
 *               title: "반품 접수 방법"
 *               edited_at: "2025-09-01T04:08:31.231Z"
 *               file_url: "http://dummyimage.com/192x100.png/ff4444/ffffff"
 *               category: "반품"
 *               content: "반품을 접수하기 위해서는 고객의 주문 내역에서 반품 신청을 누른다."
 *               _links:
 *                 - rel: "self"
 *                   href: "/manuals"
 *                   method: "POST"
 *                 - rel: "update"
 *                   href: "/manuals/1"
 *                   method: "PATCH"
 *       400: 
 *         description: "잘못된 요청"
 *       404: 
 *         description: "매뉴얼 추가 오류"
 *       500:   
 *         description: "서버 오류"
 */

router.post('/', async (req, res) => {


  const { title, file_url, category, content } = req.body;

  if (typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'title은 비어 있을 수 없습니다.' });
  }
  if (typeof file_url !== 'string') {
    return res.status(400).json({ error: 'file_url의 형식은 string이어야 합니다.' });
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: 'content는 비어 있을 수 없습니다.' });
  }
  if (typeof category !== 'string' || category.trim().length === 0) {
    return res.status(400).json({ error: 'category는 비어 있을 수 없습니다.' });
  }
  
  

  try {

    const { rows } = await pool.query(
      `INSERT INTO manuals (title, file_url, category, content)
       VALUES ($1, $2, $3, $4)
       RETURNING manual_id, title, edited_at, file_url, category, content`,
      [title, file_url, category, content]
    );

    const newManual = rows[0];
    res.status(201).json({
      ...newManual,
      _links: [
        { rel: 'self', href: '/manuals', method: 'POST' },
        { rel: 'update', href: `/manuals/${newManual.manual_id}`, method: 'PATCH' }
      ]
    });
  } catch (err) {
    res.status(500).json({ error: '서버 내부 오류가 발생했습니다.'});
  }
});

/**
 * @swagger
 * /manuals/{manual_id}:
 *   patch:
 *     summary: 매뉴얼 수정
 *     description: 해당 매뉴얼을 수정합니다.
 *     tags: [Manuals]
 *     parameters:
 *       - in: path
 *         name: manual_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 매뉴얼 ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: 매뉴얼 제목
 *               file_url:
 *                 type: string
 *                 nullable: true
 *                 description: 파일 URL
 *               category:
 *                 type: string
 *                 description: 카테고리
 *               content:
 *                 type: string
 *                 description: 매뉴얼 내용
 *           example:
 *             title: "교환 규정"
 *             file_url: "http://dummyimage.com/237x100.png/cc0000/ffffff"
 *             category: "교환"
 *             content: "단순 변심은 30일 이내, 제품 문제는 3개월 이내 교환이 가능하다."
 *     responses:
 *       200:
 *         description: 수정된 매뉴얼 정보
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 manual_id:
 *                   type: integer
 *                 title:
 *                   type: string
 *                   description: 매뉴얼 제목
 *                 edited_at:
 *                   type: string
 *                   formant: date-time
 *                   description: 최근 수정 날짜
 *                 file_url:
 *                   type: string
 *                   nullable: true
 *                   description: 파일 URL
 *                 category:
 *                   type: string
 *                   description: 카테고리
 *                 content:
 *                   type: string
 *                   description: 매뉴얼 내용
 *                 _links:
 *                   type: array
 *             example:
 *               manual_id: 1
 *               title: "교환 규정"
 *               edited_at: "2025-09-01T04:08:31.231Z"
 *               file_url: "http://dummyimage.com/237x100.png/cc0000/ffffff"
 *               category: "교환"
 *               content: "단순 변심은 30일 이내, 제품 문제는 3개월 이내 교환이 가능하다."
 *               _links:
 *                 - rel: "self"
 *                   href: "/manuals/1"
 *                   method: "PATCH"
 *                 - rel: "list"
 *                   href: "/manuals"
 *                   method: "GET"
 *       400:
 *         description: 잘못된 요청
 *       404:
 *         description: 매뉴얼 없음
 *       500:
 *         description: 서버 오류
 */


router.route('/:manual_id')
  .patch(async (req, res) => {
    try {
      const manualId = Number.parseInt(req.params.manual_id, 10);
      if (Number.isNaN(manualId)) {
        return res.status(400).json({ error: '유효하지 않은 매뉴얼 ID입니다.' });
      }

      let { title, file_url, category, content } = req.body ?? {};
      if (title !== undefined) title = String(title).trim();
      if (file_url !== undefined) file_url = String(file_url).trim();
      if (category !== undefined) category = String(category).trim();
      if (content !== undefined) content = String(content).trim();

      const fields = { title, file_url, category, content };
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

      // edited_at은 항상 현재 시간
      updates.push('edited_at = NOW()');

      values.push(manualId);

      const updateQuery = `
        UPDATE manuals
        SET ${updates.join(', ')}
        WHERE manual_id = $${paramIndex}
        RETURNING manual_id, title, edited_at, file_url, category, content
      `;
      const result = await pool.query(updateQuery, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '매뉴얼을 찾을 수 없습니다.' });
      }

      const updatedManual = result.rows[0];
      return res.status(200).json({
        ...updatedManual,
        _links: [
          { rel: 'self', href: `/manuals/${manualId}`, method: 'PATCH' },
          { rel: 'list', href: '/manuals', method: 'GET' }
        ]
      });
    } catch (err) {
      console.error('매뉴얼 수정 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });

export default router;