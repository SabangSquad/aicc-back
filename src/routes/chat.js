// src/routes/chat.js
// /chats 엔드포인트 모음:
//  - POST /chats                    : 단일 message → LLM 응답 (세션으로 caseId 유지)
//  - POST /chats/{case_id}/close    : 상담 종료 + 세션 초기화 + 비동기 AI 분석
//  - POST /chats/{case_id}          : 해당 case_id의 전체 메시지 로그 분석 (감정, 요약, 추천 답변)

import express from "express";
import { processAICC, analyzeCaseConversation } from "../bedrock.js";
import pool from "../db.js";

const router = express.Router();

/**
 * @swagger
 * /chats:
 *  post:
 *    summary: "AI에 질문 → 답변 수신"
 *    description: |
 *      고객 발화를 Bedrock LLM에 전달하여 [응답] / [근거] 형식의 상담 답변을 생성합니다.
 *      - 케이스가 없으면 신규 케이스를 자동 생성합니다.
 *      - 메시지(고객·챗봇)는 messages 테이블에 자동 저장됩니다.
 *    tags:
 *      - Chat
 *    requestBody:
 *      required: true
 *      content:
 *        application/json:
 *          schema:
 *            type: object
 *            required:
 *              - message
 *            properties:
 *              message:
 *                type: string
 *                description: "고객 발화(텍스트)"
 *                example: "환불 규정은 어떻게 돼?"
 *              caseId:
 *                type: integer
 *                description: "기존 상담 ID (최초 문의시 생략)"
 *                example: 1
 *              store_id:
 *                type: integer
 *                description: "가게 ID (최초 문의시 케이스 생성에 사용)"
 *                example: 1
 *    responses:
 *      200:
 *        description: "정상적으로 Bedrock에서 응답을 생성한 경우"
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                ok:
 *                  type: boolean
 *                  example: true
 *                answer:
 *                  type: string
 *                  description: "실제 고객에게 전달할 상담 답변([응답] 부분)"
 *                  example: "환불은 7일 이내입니다."
 *                reason:
 *                  type: string
 *                  nullable: true
 *                  description: "응답에 대한 규정/판단 근거([근거] 부분)"
 *                  example: "환불은 7일 이내입니다. (규정 1-1)"
 *                caseId:
 *                  type: integer
 *                  description: "사용된 상담 ID"
 *                _links:
 *                  type: array
 *                  items:
 *                    type: object
 *            example:
 *              ok: true
 *              answer: "환불은 7일 이내입니다."
 *              reason: "환불은 7일 이내입니다."
 *              caseId: 1
 *              _links:
 *                - rel: "self"
 *                  href: "/chats"
 *                  method: "POST"
 *      400:
 *        description: "요청 바디 검증 실패 (message 누락 또는 타입 오류)"
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                ok:
 *                  type: boolean
 *                  example: false
 *                error:
 *                  type: string
 *                  example: "message 필드는 반드시 string이어야 합니다."
 *      500:
 *        description: "Bedrock 호출 중 서버 내부 오류"
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                ok:
 *                  type: boolean
 *                  example: false
 *                error:
 *                  type: string
 *                  example: "Bedrock 호출 중 오류가 발생했습니다."
 *                detail:
 *                  type: string
 *                  description: "실제 에러 메시지"
 */

router.post("/", async (req, res) => {
  let client = null;
  try {
    const { message, caseId: inputCaseId, store_id: inputStoreId } = req.body ?? {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        ok: false,
        error: "message 필드는 반드시 string이어야 합니다.",
      });
    }

    client = await pool.connect();

    // caseId 우선순위: body > 세션 > 신규 생성
    let caseId = inputCaseId || req.session?.chatCaseId || null;

    await client.query('BEGIN');

    // 세션 복원된 케이스가 이미 종료됐으면 새로 시작
    if (caseId && !inputCaseId) {
      const { rows: caseCheck } = await client.query(
        "SELECT status FROM cases WHERE case_id = $1",
        [caseId]
      );
      const closedStatuses = new Set(['종료', 'AI자동해결']);
      if (!caseCheck.length || closedStatuses.has(caseCheck[0].status)) {
        caseId = null;
        if (req.session) delete req.session.chatCaseId;
      }
    }

    if (!caseId) {
      const storeId = inputStoreId ?? null;
      const customerId = req.isAuthenticated?.() ? (req.user?.customer_id ?? null) : null;

      if (!storeId) {
        if (client) { await client.query('ROLLBACK'); client.release(); }
        return res.status(400).json({ ok: false, error: 'store_id가 필요합니다.' });
      }

      const caseRes = await client.query(
        `INSERT INTO cases (store_id, customer_id, status, created_at)
         VALUES ($1, $2, '상담', NOW()) RETURNING case_id`,
        [storeId, customerId]
      );
      caseId = caseRes.rows[0].case_id;
    }

    // 세션에 caseId 저장 (비로그인도 express-session 쿠키로 유지)
    if (req.session) {
      req.session.chatCaseId = caseId;
    }

    // 비로그인→로그인 전환: 기존 케이스에 customer_id 연결
    if (req.isAuthenticated?.() && req.user?.customer_id) {
      await client.query(
        'UPDATE cases SET customer_id = $1 WHERE case_id = $2 AND customer_id IS NULL',
        [req.user.customer_id, caseId]
      );
    }

    // 고객 메시지 저장
    await client.query(
      "INSERT INTO messages (case_id, content, speaker, occurred_at) VALUES ($1, $2, '고객', NOW())",
      [caseId, message]
    );

    // storeId 확보 (processAICC에 전달)
    const { rows: caseRow } = await client.query('SELECT store_id FROM cases WHERE case_id = $1', [caseId]);
    const storeId = caseRow[0]?.store_id;

    await client.query('COMMIT');
    client.release();
    client = null;

    // Bedrock Prompt Management 프롬프트 호출
    const result = await processAICC(message, caseId, storeId);

    // AI 답변 저장
    await pool.query(
      "INSERT INTO messages (case_id, content, speaker, occurred_at) VALUES ($1, $2, '챗봇', NOW())",
      [caseId, result.answer]
    );

    return res.json({
      ok: true,
      answer: result.answer,
      reason: result.reason,
      suggestions: result.suggestions,
      caseId: caseId,
      _links: [{ rel: "self", href: "/chats", method: "POST" }]
    });
  } catch (err) {
    if (client) {
    try {
      // 이미 에러로 인해 연결이 끊겼을 수 있으므로 한 번 더 체크
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error("Rollback failed:", rollbackErr);
    } finally {
      client.release(); // 에러와 상관없이 반납은 반드시 수행
    }
  }
    console.error("Bedrock 호출 오류:", err);

    return res.status(500).json({
      ok: false,
      error: "Bedrock 호출 중 오류가 발생했습니다.",
      detail: err.message ?? String(err),
    });
  }
});

/**
 * @swagger
 * /chats/{case_id}/close:
 *  post:
 *    summary: "상담 종료 + 세션 초기화"
 *    description: |
 *      해당 상담을 종료하고 세션을 초기화합니다.
 *      - cases.status → '종료', closed_at 설정
 *      - 세션에서 chatCaseId 삭제 → 다음 채팅은 새 케이스
 *      - 비동기로 AI 분석(감정/요약) 실행
 *    tags:
 *      - Chat
 *    parameters:
 *      - in: path
 *        name: case_id
 *        required: true
 *        schema:
 *          type: integer
 *        description: "종료할 상담 케이스 ID"
 *    responses:
 *      200:
 *        description: "상담 종료 성공"
 *        content:
 *          application/json:
 *            example:
 *              ok: true
 *              case_id: 1
 *              status: "종료"
 *              closed_at: "2026-03-25T12:00:00.000Z"
 *              _links:
 *                - rel: "case"
 *                  href: "/cases/1"
 *                  method: "GET"
 *      404:
 *        description: "종료할 상담이 없거나 이미 종료된 경우"
 *      400:
 *        description: "case_id가 유효하지 않은 경우"
 *      500:
 *        description: "서버 오류"
 */
router.post("/:case_id/close", async (req, res) => {
  const caseId = Number(req.params.case_id);
  if (!Number.isInteger(caseId) || caseId <= 0) {
    return res.status(400).json({ ok: false, error: "case_id는 양의 정수여야 합니다." });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE cases SET status = '종료', closed_at = NOW()
       WHERE case_id = $1 AND status <> '종료'
       RETURNING case_id, status, closed_at`,
      [caseId]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "종료할 상담을 찾을 수 없습니다." });
    }

    // 세션 초기화 — 다음 채팅은 새 케이스
    if (req.session?.chatCaseId === caseId) {
      delete req.session.chatCaseId;
    }

    // 비동기 AI 분석 (감정/요약)
    setImmediate(async () => {
      try {
        const { rows: msgs } = await pool.query(
          'SELECT speaker, content FROM messages WHERE case_id = $1 ORDER BY occurred_at ASC',
          [caseId]
        );
        if (!msgs.length) return;
        const text = msgs.map(m => `${m.speaker}: ${m.content}`).join('\n');
        const analysis = await analyzeCaseConversation(text);
        await pool.query(
          'UPDATE cases SET emotion = $1, summary = $2 WHERE case_id = $3',
          [analysis.json?.emotion ?? null, analysis.json?.summary ?? null, caseId]
        );
      } catch (err) {
        console.error(`[종료 분석] 케이스 ${caseId} 실패:`, err.message);
      }
    });

    return res.json({
      ok: true,
      ...rows[0],
      _links: [{ rel: 'case', href: `/cases/${caseId}`, method: 'GET' }]
    });
  } catch (err) {
    console.error("상담 종료 오류:", err);
    return res.status(500).json({ ok: false, error: "상담 종료 중 오류가 발생했습니다." });
  }
});

/**
 * @swagger
 * /chats/{case_id}:
 *  post:
 *    summary: "해당 상담 추천 답변 + 요약 + 감정 분석"
 *    description: |
 *      해당 상담의 메시지를 DB에서 조회하여 LLM에게 넘겨 다음과 같은 응답을 받습니다.
 *      감정과 요약은 각각 cases 테이블의 emotion과 summary에 자동으로 저장됩니다.
 *      - 'emotion': 대화 전체에 대한 감정 (평온, 기쁨, 슬픔, 화남, 짜증)
 *      - 'summary': 상담 내용을 2~3문장으로 요약
 *      - 'suggested_answer': 상담사가 다음에 고객에게 보내면 좋은 추천 답변
 *
 *    tags:
 *      - Chat
 *    parameters:
 *      - in: path
 *        name: case_id
 *        required: true
 *        schema:
 *          type: integer
 *        description: "분석할 상담 케이스 ID"
 *    responses:
 *      200:
 *        description: "정상적으로 분석을 마친 경우"
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                ok:
 *                  type: boolean
 *                  example: true
 *                case_id:
 *                  type: integer
 *                  example: 123
 *                emotion:
 *                  type: string
 *                  example: "짜증"
 *                summary:
 *                  type: string
 *                  example: "고객은 배송 지연에 대해 불만을 제기했고, 상담사는 사과와 도착 예정일을 안내했습니다."
 *                suggested_answer:
 *                  type: string
 *                  example: "고객님, 다시 한 번 배송 지연으로 불편을 드려 죄송합니다. 현재 배송사와 재차 확인 중이며, 지연이 지속될 경우 별도 보상 방안을 안내드리겠습니다."
 *                _links:
 *                  type: array
 *                  items:
 *                    type: object
 *            example:
 *              ok: true
 *              case_id: 123
 *              emotion: "짜증"
 *              summary: "고객은 배송 지연에 대해 불만을 제기했고, 상담사는 사과와 도착 예정일을 안내했습니다."
 *              suggested_answer: "고객님, 다시 한 번 배송 지연으로 불편을 드려 죄송합니다..."
 *              _links:
 *                - rel: "self"
 *                  href: "/chats/123"
 *                  method: "POST"
 *                - rel: "case"
 *                  href: "/cases/123"
 *                  method: "GET"
 *      404:
 *        description: "해당 case_id에 대한 메시지 로그가 없는 경우"
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                ok:
 *                  type: boolean
 *                  example: false
 *                error:
 *                  type: string
 *                  example: "해당 case_id에 대한 메시지가 없습니다."
 *      400:
 *        description: "case_id가 유효한 숫자가 아닌 경우"
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                ok:
 *                  type: boolean
 *                  example: false
 *                error:
 *                  type: string
 *                  example: "case_id는 양의 정수여야 합니다."
 *      500:
 *        description: "DB 조회 또는 Bedrock 호출 중 서버 내부 오류"
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                ok:
 *                  type: boolean
 *                  example: false
 *                error:
 *                  type: string
 *                  example: "케이스 분석 중 오류가 발생했습니다."
 *                detail:
 *                  type: string
 *                  description: "실제 에러 메시지"
 */

router.post("/:case_id", async (req, res) => {
  const { case_id } = req.params;
  const caseIdNum = Number(case_id);

  if (!Number.isInteger(caseIdNum) || caseIdNum <= 0) {
    return res.status(400).json({
      ok: false,
      error: "case_id는 양의 정수여야 합니다.",
    });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT speaker, content, occurred_at
      FROM messages
      WHERE case_id = $1
      ORDER BY occurred_at ASC
      `,
      [caseIdNum]
    );

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        error: "해당 case_id에 대한 메시지가 없습니다.",
      });
    }

    // LLM에 넘길 로그 텍스트 구성
    const conversationText = rows
      .map((m) => {
        // speaker 값 그대로 사용 (이미 한국어)
        const role = m.speaker || "기타";

        return `${role}: ${m.content}`;
      })
      .join("\n");

    const analysis = await analyzeCaseConversation(conversationText);

    const emotion = analysis.json?.emotion ?? null;
    const summary = analysis.json?.summary ?? null;
    const suggestedAnswer = analysis.json?.suggested_reply ?? null;

    // cases 테이블에 emotion / summary 저장
    try {
      await pool.query(
        `UPDATE cases SET emotion = $1, summary = $2 WHERE case_id = $3`,
        [emotion, summary, caseIdNum]
      );
    } catch (dbErr) {
      // DB 업데이트 실패해도 분석 결과 응답은 내려줌
      console.error("케이스 emotion/summary 업데이트 실패:", dbErr);
    }

    return res.json({
      ok: true,
      case_id: caseIdNum,
      emotion,
      summary,
      suggested_answer: suggestedAnswer,
      _links: [
        { rel: "self", href: `/chats/${caseIdNum}`, method: "POST" },
        { rel: "case", href: `/cases/${caseIdNum}`, method: "GET" }
      ]
      // raw: analysis.rawText, // 필요하면 디버깅용으로 사용
    });
  } catch (err) {
    console.error("케이스 분석 중 오류:", err);

    return res.status(500).json({
      ok: false,
      error: "케이스 분석 중 오류가 발생했습니다.",
      detail: err.message ?? String(err),
    });
  }
});

export default router;