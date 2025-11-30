import { Router } from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

const region = process.env.AWS_REGION;
const apiKey = process.env.BEDROCK_API_KEY;
const inferenceProfileId = process.env.BEDROCK_INFERENCE_PROFILE_ID;


const bedrockEndpoint =
  `https://bedrock-runtime.${region}.amazonaws.com/model/${inferenceProfileId}/converse`;

async function askBedrock(message) {

  const payload = {
    messages: [
      {
        role: 'user',
        content: [{ text: message }],
      },
    ],
  };

  const res = await axios.post(bedrockEndpoint, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    timeout: 10000,
  });

  const data = res.data;
  console.log('Bedrock 응답 수신:', JSON.stringify(data).slice(0, 300));

  const text = data?.output?.message?.content?.[0]?.text || '';
  return text;
}

router.post('/', async (req, res) => {
  try {
    console.log('/chat 라우트 진입, body:', req.body);
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const reply = await askBedrock(message);
    return res.json({ reply });
  } catch (err) {
    console.error('Bedrock Error:', err.response?.data || err.message || err);
    return res.status(500).json({
      error: 'Bedrock 호출 실패',
      detail: err.response?.data || err.message || String(err),
    });
  }
});

export default router;
