// src/scripts/embed-manuals.js
// 기존 manuals 데이터 중 embedding이 NULL인 행을 일괄 벡터화
// 사용법: node src/scripts/embed-manuals.js

import 'dotenv/config';
import pg from 'pg';
import { registerType, toSql } from 'pgvector/pg';
import { generateEmbedding } from '../services/embeddingService.js';

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function main() {
  const client = await pool.connect();
  try {
    await registerType(client);

    // embedding이 NULL인 매뉴얼 조회
    const { rows } = await client.query(
      'SELECT manual_id, title, content FROM manuals WHERE embedding IS NULL'
    );

    console.log(`임베딩 대상: ${rows.length}건`);

    let success = 0;
    let fail = 0;

    for (const row of rows) {
      try {
        const embedding = await generateEmbedding(row.content);
        await client.query(
          'UPDATE manuals SET embedding = $1 WHERE manual_id = $2',
          [toSql(embedding), row.manual_id]
        );
        success++;
        console.log(`  [${success}/${rows.length}] manual_id=${row.manual_id} "${row.title}" 완료`);
      } catch (err) {
        fail++;
        console.error(`  [실패] manual_id=${row.manual_id}: ${err.message}`);
      }
    }

    console.log(`\n완료: 성공 ${success}건, 실패 ${fail}건`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('스크립트 오류:', err);
  process.exit(1);
});
