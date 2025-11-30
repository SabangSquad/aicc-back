// bedrock.js
const axios = require('axios');
require('dotenv').config();

const region = process.env.AWS_REGION;
const apiKey = process.env.BEDROCK_API_KEY;
const modelId = process.env.BEDROCK_MODEL_ID;

// Bedrock Runtime Converse 엔드포인트
const bedrockEndpoint =
  `https://bedrock-runtime.${region}.amazonaws.com/model/${modelId}/converse`;

/**
 * Bedrock에 질문 보내고, 모델 답변 텍스트만 리턴
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function askBedrock(userMessage) {
  const payload = {
    messages: [
      {
        role: 'user',
        content: [{ text: userMessage }],
      },
    ],
  };

  const res = await axios.post(bedrockEndpoint, payload, {
    headers: {
      'Content-Type': 'application/json',
      // Bedrock API 키는 Authorization: Bearer 헤더로 보냄 
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = res.data;
  // Claude 계열 응답 형식 기준
  const text = data?.output?.message?.content?.[0]?.text || '';
  return text;
}

module.exports = { askBedrock };
