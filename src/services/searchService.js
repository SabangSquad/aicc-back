import 'dotenv/config';
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import pkg from 'pg';
const { Pool } = pkg;
import { registerType, toSql } from 'pgvector/pg';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'ap-northeast-2' });

// 질문을 벡터로 변환
export async function getQuestionVector(text) {
  const command = new InvokeModelCommand({
    modelId: "amazon.titan-embed-text-v2:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({ inputText: text, dimensions: 1024, normalize: true }),
  });
  const res = await bedrock.send(command);
  return JSON.parse(new TextDecoder().decode(res.body)).embedding;
}

// pgvector 검색
export async function findSimilarContext(query, category) {
  const vector = await getQuestionVector(query);
  const client = await pool.connect();
  try {
    await registerType(client);
    const sql = `
      SELECT content FROM aicc_knowledge 
      WHERE category = $2 ORDER BY embedding <=> $1 LIMIT 2
    `;
    const res = await client.query(sql, [toSql(vector), category]);
    return res.rows.map(row => row.content).join('\n\n');
  } finally {
    client.release();
  }
}