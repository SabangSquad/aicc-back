import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import pool from '../db.js';
import { registerType, toSql } from 'pgvector/pg';

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

// pgvector 검색 — manuals 테이블 기반 (해당 가게 매뉴얼에서 유사도 검색)
export async function findSimilarContext(query, storeId) {
  const vector = await getQuestionVector(query);
  const client = await pool.connect();
  try {
    await registerType(client);
    const sql = `
      SELECT content FROM manuals
      WHERE store_id = $2
      ORDER BY embedding <=> $1 LIMIT 2
    `;
    const res = await client.query(sql, [toSql(vector), storeId]);
    return res.rows.map(row => row.content).join('\n\n');
  } finally {
    client.release();
  }
}
