import pool from '../db.js';
import { registerType, toSql } from 'pgvector/pg';
import { generateEmbedding } from './embeddingService.js';

// pgvector 검색 — manuals 테이블 기반 (해당 가게 매뉴얼에서 유사도 검색)
export async function findSimilarContext(query, storeId) {
  const vector = await generateEmbedding(query);
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
