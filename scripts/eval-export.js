// scripts/eval-export.js
// 종료된 상담 케이스를 SELECT → caseWriter 재호출 → 평가용 markdown 표 출력
// (다중 매장 지원: iterations > 1이고 random이면 매장 N개에서 각 cases_per_store건씩)
//
// 사용:
//   node scripts/eval-export.js [store_id|random|cases:id1,id2,...] [cases_per_store=10] [max_case_id=500] [iterations=1]
//   node scripts/eval-export.js random 1 500 10                    # 매장 10개 × 1건 = 10 iteration
//   node scripts/eval-export.js random 10 500 1                    # 매장 1개 × 10건 (기존)
//   node scripts/eval-export.js 79 10 500                          # store_id=79 1건 10개
//   node scripts/eval-export.js cases:412,405,318,217 1 500 1      # 명시한 case_id들만 평가 (messages 수정 후 재실행용)
//
// 출력: eval-report-{ts}.md
// 평가 컬럼: 추천 적절(○/△/X), 감정 정확(○/X)

import 'dotenv/config';
import fs from 'fs';
import pool from '../src/db.js';
import { analyzeCaseConversation } from '../src/bedrock.js';

const storeArg = process.argv[2];
const casesPerStore = parseInt(process.argv[3] || '10', 10);
const maxCaseId = parseInt(process.argv[4] || '500', 10);
const iterations = parseInt(process.argv[5] || '1', 10);

// 인자 파싱: 'cases:id1,id2,...' → 특정 case_id 명시 모드
const isCaseIdMode = typeof storeArg === 'string' && storeArg.startsWith('cases:');
const fixedCaseIds = isCaseIdMode
  ? storeArg.slice(6).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
  : null;
const storeIdFixed = !isCaseIdMode && storeArg && storeArg !== 'random'
  ? parseInt(storeArg, 10)
  : null;

function escapeMd(s, maxLen = 200) {
  if (s == null) return '';
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' / ').slice(0, maxLen);
}

async function pickNRandomStoreIds(n) {
  const { rows } = await pool.query(
    `SELECT store_id FROM (
       SELECT c.store_id, COUNT(*)::int AS cnt
       FROM cases c
       WHERE c.summary IS NOT NULL AND c.case_id < $1
       GROUP BY c.store_id
       HAVING COUNT(*) >= $2
     ) t
     ORDER BY RANDOM() LIMIT $3`,
    [maxCaseId, casesPerStore, n]
  );
  return rows.map(r => r.store_id);
}

async function fetchStoreCases(storeId) {
  const { rows: cases } = await pool.query(
    `SELECT c.case_id, c.store_id, c.category, c.status, c.emotion, c.summary,
            c.created_at, c.closed_at,
            s.category AS store_category, s.name AS store_name
     FROM cases c
     LEFT JOIN stores s ON c.store_id = s.store_id
     WHERE c.store_id = $1
       AND c.summary IS NOT NULL
       AND c.case_id < $3
     ORDER BY c.case_id DESC
     LIMIT $2`,
    [storeId, casesPerStore, maxCaseId]
  );
  return cases;
}

async function analyzeCase(caseRow, opts = {}) {
  const { rows: msgs } = await pool.query(
    'SELECT speaker, content FROM messages WHERE case_id = $1 ORDER BY occurred_at ASC',
    [caseRow.case_id]
  );
  const text = msgs.map(m => `[${m.speaker}] ${m.content}`).join('\n');
  const lastCustomer = [...msgs].reverse().find(m => m.speaker === '고객')?.content || '';
  const lastBot = [...msgs].reverse().find(m => m.speaker === '챗봇')?.content || '';

  let analysis;
  try {
    analysis = await analyzeCaseConversation(text, caseRow.store_category);
  } catch (e) {
    console.error(`   ⚠️ caseWriter 실패 (case_id=${caseRow.case_id}): ${e.message}`);
    analysis = { json: null };
  }

  // cases: 모드(messages 수정 후 재평가 시나리오)면 caseWriter 결과를 cases 테이블에 UPDATE
  // emotion/category/summary 갱신 → 이후 solutionAnalyzer 입력에도 반영됨
  if (opts.updateDb && analysis.json) {
    try {
      await pool.query(
        `UPDATE cases SET emotion = $1, summary = $2, category = COALESCE($3, category) WHERE case_id = $4`,
        [
          analysis.json.emotion ?? null,
          analysis.json.summary ?? null,
          analysis.json.category ?? null,
          caseRow.case_id,
        ]
      );
      console.log(`   └─ 💾 cases UPDATE: emotion=${analysis.json.emotion ?? 'null'}, category=${analysis.json.category ?? 'null'}`);
    } catch (e) {
      console.error(`   ⚠️ cases UPDATE 실패: ${e.message}`);
    }
  }

  return {
    case_id: caseRow.case_id,
    store_id: caseRow.store_id,
    store_name: caseRow.store_name || `store_${caseRow.store_id}`,
    store_category: caseRow.store_category || 'N/A',
    status: caseRow.status,
    messages: msgs,
    last_customer: lastCustomer,
    last_bot: lastBot,
    db_emotion: caseRow.emotion,
    db_category: caseRow.category,
    db_summary: caseRow.summary,
    new_emotion: analysis.json?.emotion ?? null,
    new_category: analysis.json?.category ?? null,
    new_summary: analysis.json?.summary ?? null,
    new_suggested_reply: analysis.json?.suggested_reply ?? null,
  };
}

function renderMd(rows, meta) {
  const ts = new Date().toISOString();
  let md = `# 평가 데이터 — ${rows.length} iteration\n\n`;
  md += `- 생성 시각: ${ts}\n`;
  md += `- 인자: store=${meta.storeArg ?? 'random'} / cases_per_store=${meta.casesPerStore} / max_case_id=${meta.maxCaseId} / iterations=${meta.iterations}\n`;
  md += `- **평가 방법**: 케이스별 상세의 전체 대화를 읽고 직접 판단. LLM 분류 결과는 anchoring 방지를 위해 \`<details>\`에 접어둠 (평가 후 비교용)\n`;
  md += `- 평가 컬럼: **추천 적절** (○/△/X, suggested_reply 사용 가능성) / **감정 평가** (대화 분위기 보고 본인이 emotion 라벨 입력)\n\n`;

  md += `## 한눈에 보기 (점수 입력)\n\n`;
  md += `| # | store_id | 업종 | case_id | suggested_reply (LLM 추천 답변) | 추천 적절 | 감정 평가 | 메모 |\n`;
  md += `|---|----------|------|---------|------------------------------|---------|---------|------|\n`;
  rows.forEach((r, i) => {
    md += `| ${i + 1} | ${r.store_id} | ${r.store_category} | ${r.case_id} | ${escapeMd(r.new_suggested_reply, 180)} |  |  |  |\n`;
  });

  md += `\n> **감정 평가**는 [케이스별 상세]의 전체 대화 읽고 분위기 판단 후 emotion 라벨을 적으세요 (평온/기쁨/슬픔/화남/짜증). 그 후 \`<details>\` 펼쳐서 LLM 결과와 비교.\n\n`;

  md += `\n## 케이스별 상세\n\n`;
  rows.forEach((r, i) => {
    md += `### #${i + 1} — store_id=${r.store_id} (${r.store_category}) · case_id=${r.case_id} (${r.status ?? ''})\n\n`;
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

async function fetchCasesByIds(caseIds) {
  if (caseIds.length === 0) return [];
  const placeholders = caseIds.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await pool.query(
    `SELECT c.case_id, c.store_id, c.category, c.status, c.emotion, c.summary,
            c.created_at, c.closed_at,
            s.category AS store_category, s.name AS store_name
     FROM cases c
     LEFT JOIN stores s ON c.store_id = s.store_id
     WHERE c.case_id IN (${placeholders})
     ORDER BY c.case_id DESC`,
    caseIds
  );
  return rows;
}

async function main() {
  const allRows = [];

  if (isCaseIdMode) {
    // case_id 명시 모드: 매장 무관, 그 case들만
    console.log(`🎯 case_id 명시 모드: ${fixedCaseIds.join(', ')}`);
    const cases = await fetchCasesByIds(fixedCaseIds);
    if (cases.length === 0) {
      console.error('❌ 명시한 case_id에 해당하는 케이스 없음');
      await pool.end();
      process.exit(1);
    }
    if (cases.length < fixedCaseIds.length) {
      const found = cases.map(c => c.case_id);
      const missing = fixedCaseIds.filter(id => !found.includes(id));
      console.warn(`⚠️  찾지 못한 case_id: ${missing.join(', ')}`);
    }
    for (const c of cases) {
      console.log(`📝 [${allRows.length + 1}/${cases.length}] case_id=${c.case_id} (store_id=${c.store_id}) caseWriter 재호출...`);
      const r = await analyzeCase(c, { updateDb: true });  // cases: 모드 → DB UPDATE
      allRows.push(r);
    }
  } else {
    // 매장 목록 결정
    let storeIds = [];
    if (storeIdFixed !== null && !isNaN(storeIdFixed)) {
      storeIds = [storeIdFixed];
      if (iterations > 1) console.warn(`⚠️  store_id 고정 시 iterations 무시 (매장 1개에서 ${casesPerStore}건)`);
    } else {
      storeIds = await pickNRandomStoreIds(iterations);
      if (storeIds.length === 0) {
        console.error(`❌ 평가 가능한 매장 0개 (case_id < ${maxCaseId} + summary 있는 케이스 ${casesPerStore}건 이상)`);
        await pool.end();
        process.exit(1);
      }
      if (storeIds.length < iterations) {
        console.warn(`⚠️  조건 충족 매장이 ${storeIds.length}개뿐 (요청 ${iterations}개)`);
      }
      console.log(`🎲 랜덤 매장 ${storeIds.length}개 선택: ${storeIds.join(', ')}`);
    }

    for (let i = 0; i < storeIds.length; i++) {
      const sid = storeIds[i];
      const cases = await fetchStoreCases(sid);
      if (cases.length === 0) {
        console.warn(`   ⚠️  store_id=${sid} 케이스 0건 (스킵)`);
        continue;
      }
      for (let j = 0; j < cases.length; j++) {
        const c = cases[j];
        console.log(`📝 [${allRows.length + 1}] store_id=${sid} case_id=${c.case_id} caseWriter 재호출...`);
        const r = await analyzeCase(c);
        allRows.push(r);
      }
    }
  }

  if (allRows.length === 0) {
    console.error('❌ 평가할 케이스 0건');
    await pool.end();
    process.exit(1);
  }

  const md = renderMd(allRows, { storeArg, casesPerStore, maxCaseId, iterations });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  let suffix;
  if (isCaseIdMode) {
    suffix = `cases${allRows.length}`;
  } else {
    const uniqueStores = [...new Set(allRows.map(r => r.store_id))];
    suffix = uniqueStores.length === 1 ? `store${uniqueStores[0]}` : `iter${uniqueStores.length}`;
  }
  const filename = `eval-report-${suffix}-${stamp}.md`;
  fs.writeFileSync(filename, md, 'utf8');

  const uniqueStoreIds = [...new Set(allRows.map(r => r.store_id))];
  console.log(`\n✅ 평가 데이터 ${allRows.length}건 → ${filename}`);
  console.log(`   매장 ${uniqueStoreIds.length}개 (실제 추출: ${allRows.length}건)`);

  await pool.end();
}

main().catch(async (e) => {
  console.error('❌ 실행 오류:', e);
  await pool.end();
  process.exit(1);
});
