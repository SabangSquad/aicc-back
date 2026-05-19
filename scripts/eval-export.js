// scripts/eval-export.js
// 종료된 상담 케이스 N건을 SELECT → caseWriter 재호출 → 평가용 markdown 표 출력
//
// 사용:
//   node scripts/eval-export.js [store_id=1] [limit=10]
//   kubectl -n aicc exec -it deploy/aicc-back -- node scripts/eval-export.js 1 10
//
// 출력: eval-report-{timestamp}.md
// 평가 컬럼: 솔루션★(1~5), 추천 적절(○/△/X), 감정 정확(○/X)

import 'dotenv/config';
import fs from 'fs';
import pool from '../src/db.js';
import { analyzeCaseConversation } from '../src/bedrock.js';

const storeId = parseInt(process.argv[2] || '1', 10);
const limit = parseInt(process.argv[3] || '10', 10);

function escapeMd(s, maxLen = 200) {
  if (s == null) return '';
  return String(s)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' / ')
    .slice(0, maxLen);
}

function renderMd(rows, meta) {
  const ts = new Date().toISOString();
  let md = `# 평가 데이터 — ${rows.length}건\n\n`;
  md += `- 생성 시각: ${ts}\n`;
  md += `- store_id: ${meta.storeId} (업종: ${meta.storeCategory || 'N/A'})\n`;
  md += `- 평가 컬럼: **솔루션★** (1~5, AI 답변 적절성) / **추천 적절** (○/△/X, suggested_reply 사용 가능성) / **감정 정확** (○/X, emotion 적합성)\n\n`;
  md += `## 한눈에 보기\n\n`;
  md += `| # | case_id | 마지막 고객 질문 | AI 답변 | DB 감정 | DB 카테고리 | 신규 emotion | 신규 category | 신규 suggested_reply | 솔루션★ | 추천 적절 | 감정 정확 | 메모 |\n`;
  md += `|---|---------|----------------|---------|--------|------------|-------------|--------------|---------------------|--------|---------|---------|------|\n`;
  rows.forEach((r, i) => {
    md += `| ${i + 1} | ${r.case_id} | ${escapeMd(r.last_customer, 80)} | ${escapeMd(r.last_bot, 120)} | ${r.db_emotion ?? ''} | ${r.db_category ?? ''} | ${r.new_emotion ?? ''} | ${r.new_category ?? ''} | ${escapeMd(r.new_suggested_reply, 120)} |  |  |  |  |\n`;
  });

  md += `\n## 케이스별 상세\n\n`;
  rows.forEach((r, i) => {
    md += `### #${i + 1} — case_id=${r.case_id} (${r.status ?? ''})\n\n`;
    md += `**마지막 고객 질문**:\n> ${(r.last_customer || '(없음)').replace(/\n/g, '\n> ')}\n\n`;
    md += `**AI 답변(마지막)**:\n> ${(r.last_bot || '(없음)').replace(/\n/g, '\n> ')}\n\n`;
    md += `**DB 저장값**: emotion=\`${r.db_emotion ?? 'null'}\`, category=\`${r.db_category ?? 'null'}\`\n\n`;
    md += `**DB summary**: ${r.db_summary ?? '(없음)'}\n\n`;
    md += `**caseWriter 재분석 결과**:\n`;
    md += `- emotion: \`${r.new_emotion ?? 'null'}\`\n`;
    md += `- category: \`${r.new_category ?? 'null'}\`\n`;
    md += `- summary: ${r.new_summary ?? '(없음)'}\n`;
    md += `- suggested_reply: ${r.new_suggested_reply ?? '(없음)'}\n\n`;
    md += `---\n\n`;
  });
  return md;
}

async function main() {
  console.log(`🔍 store_id=${storeId} 종료 케이스 ${limit}건 추출 중...`);

  // 종료/분석 완료 케이스 (summary 있는 것) — closed_at 기준 최근순
  const { rows: cases } = await pool.query(
    `SELECT c.case_id, c.store_id, c.category, c.status, c.emotion, c.summary,
            c.created_at, c.closed_at,
            s.category AS store_category
     FROM cases c
     LEFT JOIN stores s ON c.store_id = s.store_id
     WHERE c.store_id = $1
       AND c.summary IS NOT NULL
     ORDER BY COALESCE(c.closed_at, c.created_at) DESC
     LIMIT $2`,
    [storeId, limit]
  );

  if (cases.length === 0) {
    console.error('❌ 평가할 케이스가 없습니다 (summary 있는 종료 케이스 0건).');
    await pool.end();
    process.exit(1);
  }
  console.log(`   └─ ${cases.length}건 확보`);

  const storeCategory = cases[0]?.store_category || null;
  const rows = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    console.log(`📝 [${i + 1}/${cases.length}] case_id=${c.case_id} 메시지 + caseWriter 재호출...`);

    const { rows: msgs } = await pool.query(
      'SELECT speaker, content FROM messages WHERE case_id = $1 ORDER BY occurred_at ASC',
      [c.case_id]
    );

    const text = msgs.map(m => `[${m.speaker}] ${m.content}`).join('\n');
    const lastCustomer = [...msgs].reverse().find(m => m.speaker === '고객')?.content || '';
    const lastBot = [...msgs].reverse().find(m => m.speaker === '챗봇')?.content || '';

    let analysis;
    try {
      analysis = await analyzeCaseConversation(text, c.store_category);
    } catch (e) {
      console.error(`   ⚠️ caseWriter 실패: ${e.message}`);
      analysis = { json: null };
    }

    rows.push({
      case_id: c.case_id,
      status: c.status,
      last_customer: lastCustomer,
      last_bot: lastBot,
      db_emotion: c.emotion,
      db_category: c.category,
      db_summary: c.summary,
      new_emotion: analysis.json?.emotion ?? null,
      new_category: analysis.json?.category ?? null,
      new_summary: analysis.json?.summary ?? null,
      new_suggested_reply: analysis.json?.suggested_reply ?? null,
    });
  }

  const md = renderMd(rows, { storeId, storeCategory });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `eval-report-store${storeId}-${stamp}.md`;
  fs.writeFileSync(filename, md, 'utf8');

  console.log(`\n✅ 평가 데이터 ${rows.length}건 → ${filename}`);
  console.log(`   Notion/Sheets에 붙여넣고 솔루션★ / 추천 적절 / 감정 정확 컬럼에 점수 입력하세요.`);

  await pool.end();
}

main().catch(async (e) => {
  console.error('❌ 실행 오류:', e);
  await pool.end();
  process.exit(1);
});
