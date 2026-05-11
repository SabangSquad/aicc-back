import pool from '../db.js';
import { registerType, toSql } from 'pgvector/pg';
import { generateEmbedding } from './embeddingService.js';

// pgvector 검색 — manuals 테이블 기반 (해당 가게 매뉴얼에서 유사도 검색)
// 반환: { context: string (LLM에 넘길 텍스트), sources: [{ manualId, title, category, distance, excerpt }] }
// categoryHint: 정책 키워드 기반 카테고리 우선 정렬 (예: "예약변경", "환불", "교환")
export async function findSimilarContext(query, storeId, categoryHint = null) {
  const vector = await generateEmbedding(query);
  const client = await pool.connect();
  try {
    await registerType(client);
    // categoryHint 있으면 해당 카테고리 매뉴얼 우선 (있으면 top, 그 다음 임베딩 거리)
    // 없으면 기존대로 임베딩 거리만으로 정렬
    const sql = categoryHint
      ? `
        SELECT manual_id, title, category, content, embedding <=> $1 AS distance
        FROM manuals
        WHERE store_id = $2
        ORDER BY
          CASE WHEN category = $3 THEN 0 ELSE 1 END,
          embedding <=> $1
        LIMIT 3
      `
      : `
        SELECT manual_id, title, category, content, embedding <=> $1 AS distance
        FROM manuals
        WHERE store_id = $2
        ORDER BY embedding <=> $1 LIMIT 2
      `;
    const params = categoryHint
      ? [toSql(vector), storeId, categoryHint]
      : [toSql(vector), storeId];
    const res = await client.query(sql, params);
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
