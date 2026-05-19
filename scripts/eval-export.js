// scripts/eval-export.js
// 종료된 상담 케이스 N건을 SELECT → caseWriter 재호출 → 평가용 markdown 표 출력
//
// 사용:
//   node scripts/eval-export.js [store_id|random] [limit=10] [max_case_id=500]
//   node scripts/eval-export.js random 10 500    # 랜덤 매장
//   node scripts/eval-export.js 3 10 500         # store_id=3 고정
//   kubectl -n aicc exec deploy/aicc-back -- node scripts/eval-export.js random 10 500
//
// 출력: eval-report-store{id}-{timestamp}.md
// 평가 컬럼: 추천 적절(○/△/X), 감정 정확(○/X)

import 'dotenv/config';
import fs from 'fs';
import pool from '../src/db.js';
import { analyzeCaseConversation } from '../src/bedrock.js';

const storeArg = process.argv[2];
const limit = parseInt(process.argv[3] || '10', 10);
const maxCaseId = parseInt(process.argv[4] || '500', 10);  // 이 ID 미만의 case만 (500 이후는 테스트 데이터라 제외)
const storeIdFixed = storeArg && storeArg !== 'random' ? parseInt(storeArg, 10) : null;

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
  md += `- **평가 방법**: 아래 [케이스별 상세]의 전체 대화를 직접 읽고 분위기·맥락 파악 → 점수 입력. LLM이 분류한 emotion/category 결과는 anchoring 방지를 위해 케이스 섹션 끝의 \`<details>\`에 접어둠 (평가 완료 후 비교용)\n`;
  md += `- 평가 컬럼: **추천 적절** (○/△/X, suggested_reply 사용 가능성) / **감정 정확** (○/X, 대화 분위기와 emotion 일치)\n\n`;
  md += `## 한눈에 보기 (점수 입력)\n\n`;
  md += `| # | case_id | suggested_reply (LLM 추천 답변) | 추천 적절 | 감정 평가 | 메모 |\n`;
  md += `|---|---------|------------------------------|---------|---------|------|\n`;
  rows.forEach((r, i) => {
    md += `| ${i + 1} | ${r.case_id} | ${escapeMd(r.new_suggested_reply, 180)} |  |  |  |\n`;
  });

  md += `\n> **감정 평가**는 [케이스별 상세]의 전체 대화 읽고 분위기 판단 후 직접 emotion 라벨을 적으세요 (평온/기쁨/슬픔/화남/짜증). 그 후 \`<details>\` 펼쳐서 LLM 결과와 비교.\n\n`;

  md += `\n## 케이스별 상세\n\n`;
  rows.forEach((r, i) => {
    md += `### #${i + 1} — case_id=${r.case_id} (${r.status ?? ''})\n\n`;
    md += `**전체 대화**:\n\n`;
    if (r.messages && r.messages.length > 0) {
      r.messages.forEach(m => {
        const safeContent = (m.content || '').replace(/\n/g, '\n> ');
        md += `> **[${m.speaker}]** ${safeContent}\n>\n`;
      });
    } else {
      md += `> (메시지 없음)\n`;
    }
    md += `\n<details>\n<summary>LLM 분류 결과 (평가 후 비교용)</summary>\n\n`;
    md += `**DB 저장값**: emotion=\`${r.db_emotion ?? 'null'}\`, category=\`${r.db_category ?? 'null'}\`\n\n`;
    md += `**DB summary**: ${r.db_summary ?? '(없음)'}\n\n`;
    md += `**caseWriter 재분석 결과**:\n`;
    md += `- emotion: \`${r.new_emotion ?? 'null'}\`\n`;
    md += `- category: \`${r.new_category ?? 'null'}\`\n`;
    md += `- summary: ${r.new_summary ?? '(없음)'}\n`;
    md += `- suggested_reply: ${r.new_suggested_reply ?? '(없음)'}\n\n`;
    md += `</details>\n\n---\n\n`;
  });
  return md;
}

async function pickRandomStoreId() {
  // case_id < maxCaseId + summary 있는 케이스를 N건 이상 가진 매장 중 랜덤 1개
  const { rows } = await pool.query(
    `SELECT store_id FROM (
       SELECT c.store_id, COUNT(*)::int AS cnt
       FROM cases c
       WHERE c.summary IS NOT NULL AND c.case_id < $1
       GROUP BY c.store_id
       HAVING COUNT(*) >= $2
     ) t
     ORDER BY RANDOM() LIMIT 1`,
    [maxCaseId, limit]
  );
  return rows[0]?.store_id || null;
}

async function main() {
  // 매장 선택: 인자 있으면 고정, 없거나 'random'이면 DB에서 랜덤
  let storeId = storeIdFixed;
  if (storeId === null || isNaN(storeId)) {
    storeId = await pickRandomStoreId();
    if (!storeId) {
      console.error(`❌ 평가 가능한 매장 없음 (case_id < ${maxCaseId} + summary 있는 케이스 ${limit}건 이상)`);
      await pool.end();
      process.exit(1);
    }
    console.log(`🎲 랜덤 매장 선택: store_id=${storeId}`);
    console.log(`   ⚠️  솔루션 평가도 같은 매장으로 돌리려면: node scripts/eval-solutions.js ${storeId} ${limit} ${maxCaseId}`);
  }

  console.log(`🔍 store_id=${storeId} 종료 케이스 ${limit}건 추출 중... (case_id < ${maxCaseId})`);

  // 종료/분석 완료 케이스 (summary 있는 것) — case_id 내림차순 (최근 생성)
  // eval-solutions.js와 같은 풀을 보도록 정렬 통일
  // case_id 상한 필터: 그 이후는 테스트 데이터라 제외
  const { rows: cases } = await pool.query(
    `SELECT c.case_id, c.store_id, c.category, c.status, c.emotion, c.summary,
            c.created_at, c.closed_at,
            s.category AS store_category
     FROM cases c
     LEFT JOIN stores s ON c.store_id = s.store_id
     WHERE c.store_id = $1
       AND c.summary IS NOT NULL
       AND c.case_id < $3
     ORDER BY c.case_id DESC
     LIMIT $2`,
    [storeId, limit, maxCaseId]
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
      messages: msgs,  // 전체 대화 (사람이 분위기 판단)
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
