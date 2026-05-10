import pool from '../db.js';
import { registerType, toSql } from 'pgvector/pg';
import { generateEmbedding } from './embeddingService.js';

// pgvector 검색 — manuals 테이블 기반 (해당 가게 매뉴얼에서 유사도 검색)
// 반환: { context: string (LLM에 넘길 텍스트), sources: [{ manualId, title, category, distance, excerpt }] }
export async function findSimilarContext(query, storeId) {
  const vector = await generateEmbedding(query);
  const client = await pool.connect();
  try {
    await registerType(client);
    const sql = `
      SELECT manual_id, title, category, content, embedding <=> $1 AS distance
      FROM manuals
      WHERE store_id = $2
      ORDER BY embedding <=> $1 LIMIT 2
    `;
    const res = await client.query(sql, [toSql(vector), storeId]);
    const context = res.rows.map(row => row.content).join('\n\n');
    const sources = res.rows.map(row => ({
      type: 'manual',
      manualId: row.manual_id,
      title: row.title,
      category: row.category,
      distance: parseFloat(row.distance),
      score: Number((1 - parseFloat(row.distance)).toFixed(3)), // 0~1 (1에 가까울수록 유사)
      excerpt: typeof row.content === 'string' ? row.content.slice(0, 120) : '',
    }));
    return { context, sources };
  } finally {
    client.release();
  }
}
