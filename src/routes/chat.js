// src/routes/chat.js
// /chat 엔드포인트 모음:
//  - POST /chat           : 단일 message → LLM 응답 ([응답]/[근거])
//  - POST /chat/{case_id} : 해당 case_id의 전체 메시지 로그 분석 (감정, 요약, 추천 답변)

import express from "express";
import { runAiccPrompt, analyzeCaseConversation } from "../bedrock.js";
import pool from "../db.js"; // DB 커넥션 모듈 경로는 프로젝트에 맞게 조정

const router = express.Router();

/**
 * @swagger
 * /chat:
 *   post:
 *     summary: "AICC 테스트 챗봇 질의"
 *     description: |
 *       AICC 테스트 프롬프트를 호출하여 [응답] / [근거] 형식의 상담 답변을 생성합니다.
 *       - 요청 바디의 `message`에 고객 발화(텍스트)를 전달합니다.
 *       - 응답의 `answer`는 실제 고객에게 보여줄 답변, `reason`은 규정/판단 근거입니다.
 *     tags:
 *       - Chat
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 description: "고객 발화(텍스트)"
 *                 example: "자기소개해봐"
 *     responses:
 *       200:
 *         description: "정상적으로 Bedrock에서 응답을 생성한 경우"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 answer:
 *                   type: string
 *                   description: "실제 고객에게 전달할 상담 답변([응답] 부분)"
 *                   example: "안녕하세요, 저는 AICC 테스트용 상담 챗봇입니다. 궁금하신 점을 도와드릴게요."
 *                 reason:
 *                   type: string
 *                   nullable: true
 *                   description: "응답에 대한 규정/판단 근거([근거] 부분)"
 *                   example: "테스트 단계에서 자기소개 요청 시 챗봇 역할을 설명 (규정 1-1)"
 *       400:
 *         description: "요청 바디 검증 실패 (message 누락 또는 타입 오류)"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "message 필드는 반드시 string이어야 합니다."
 *       500:
 *         description: "Bedrock 호출 중 서버 내부 오류"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Bedrock 호출 중 오류가 발생했습니다."
 *                 detail:
 *                   type: string
 *                   description: "실제 에러 메시지"
 */

/**
 * POST /chat
 * body: { "message": string }
 */
router.post("/", async (req, res) => {
  try {
    const { message } = req.body ?? {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        ok: false,
        error: "message 필드는 반드시 string이어야 합니다.",
      });
    }

    // Bedrock Prompt Management 프롬프트 호출
    const result = await runAiccPrompt(message);

    // 디버깅용: 실제 LLM 출력 전체
    console.log("[Bedrock rawText]", result.rawText);

    return res.json({
      ok: true,
      answer: result.answer,
      reason: result.reason,
    });
  } catch (err) {
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
 * /chat/{case_id}:
 *   post:
 *     summary: "상담 케이스 대화 로그 분석 (감정 + 요약 + 추천 답변)"
 *     description: |
 *       해당 상담의 메시지를 DB에서 조회하여 LLM에게 넘겨 다음과 같은 응답을 받습니다.
 *       - 'emotion': 대화 전체에 대한 감정 (평온, 기쁨, 슬픔, 화남, 짜증)
 *       - 'summary': 상담 내용을 2~3문장으로 요약
 *       - 'suggested_answer': 상담사가 다음에 고객에게 보내면 좋은 추천 답변
 *
 *     tags:
 *       - Chat
 *     parameters:
 *       - in: path
 *         name: case_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "분석할 상담 케이스 ID"
 *     responses:
 *       200:
 *         description: "정상적으로 분석을 마친 경우"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 case_id:
 *                   type: integer
 *                   example: 123
 *                 emotion:
 *                   type: string
 *                   example: "negative"
 *                 summary:
 *                   type: string
 *                   example: "고객은 배송 지연에 대해 불만을 제기했고, 상담사는 사과와 도착 예정일을 안내했습니다."
 *                 suggested_answer:
 *                   type: string
 *                   example: "고객님, 다시 한 번 배송 지연으로 불편을 드려 죄송합니다. 현재 배송사와 재차 확인 중이며, 지연이 지속될 경우 별도 보상 방안을 안내드리겠습니다."
 *       404:
 *         description: "해당 case_id에 대한 메시지 로그가 없는 경우"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "해당 case_id에 대한 메시지가 없습니다."
 *       400:
 *         description: "case_id가 유효한 숫자가 아닌 경우"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "case_id는 양의 정수여야 합니다."
 *       500:
 *         description: "DB 조회 또는 Bedrock 호출 중 서버 내부 오류"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "케이스 분석 중 오류가 발생했습니다."
 *                 detail:
 *                   type: string
 *                   description: "실제 에러 메시지"
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
    // messages 테이블 스키마:
    // message_id, case_id, occurred_at, content, speaker
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
        // speaker 값에 따라 한국어 라벨링
        const role =
          m.speaker === "customer"
            ? "고객"
            : m.speaker === "agent"
            ? "상담사"
            : m.speaker || "기타";

        return `${role}: ${m.content}`;
      })
      .join("\n");

    const analysis = await analyzeCaseConversation(conversationText);

    const emotion = analysis.json?.emotion ?? null;
    const summary = analysis.json?.summary ?? null;
    const suggestedAnswer = analysis.json?.suggested_reply ?? null;

    // cases 테이블에 emotion / memo 저장
    try {
      await pool.query(
        `
        UPDATE cases
        SET emotion = $1,
            memo = $2
        WHERE case_id = $3
        `,
        [emotion, summary, caseIdNum]
      );
    } catch (dbErr) {
      // DB 업데이트 실패해도 분석 결과 응답은 내려줌
      console.error("케이스 emotion/memo 업데이트 실패:", dbErr);
    }

    return res.json({
      ok: true,
      case_id: caseIdNum,
      emotion,
      summary,
      suggested_answer: suggestedAnswer,
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
