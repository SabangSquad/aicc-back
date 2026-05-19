// scripts/eval-solutions.js
// solutionAnalyzer 평가용: N개 매장(또는 같은 매장 반복)에 대해 ai_analysis 생성 후 평가용 markdown 출력
//
// 사용:
//   node scripts/eval-solutions.js [store_id|random] [limit=10] [max_case_id=500] [iterations=1]
//   node scripts/eval-solutions.js random 10 500 10    # 랜덤 매장 10개 각각 1회 (총 10 iteration)
//   node scripts/eval-solutions.js 79 10 500 1          # store_id=79 1회
//   node scripts/eval-solutions.js 79 10 500 5          # store_id=79 5회 반복 (일관성 측정)
//
// 출력: eval-solutions-{ts}.md (다중 매장이면 매장별 섹션)
// 평가 항목: headline 적절성 / issues 가치 / strategies 실행가능성 / urgency 적정성

import 'dotenv/config';
import fs from 'fs';
import pool from '../src/db.js';
import { analyzeSolutions } from '../src/bedrock.js';

const storeArg = process.argv[2];
const limit = parseInt(process.argv[3] || '10', 10);
const maxCaseId = parseInt(process.argv[4] || '500', 10);
const iterations = parseInt(process.argv[5] || '1', 10);
const storeIdFixed = storeArg && storeArg !== 'random' ? parseInt(storeArg, 10) : null;

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
    [maxCaseId, limit, n]
  );
  return rows.map(r => r.store_id);
}

async function analyzeOneStore(storeId) {
  // 케이스 limit건
  const { rows: cases } = await pool.query(
    `SELECT c.case_id, c.category, c.emotion, c.summary, c.status, c.created_at,
            s.category AS store_category, s.name AS store_name
     FROM cases c
     LEFT JOIN stores s ON c.store_id = s.store_id
     WHERE c.store_id = $1 AND c.summary IS NOT NULL AND c.case_id < $3
     ORDER BY c.case_id DESC
     LIMIT $2`,
    [storeId, limit, maxCaseId]
  );

  if (cases.length === 0) {
    return { storeId, cases: [], analysis: null, statsText: '', summaryText: '', skipped: true };
  }

  // 통계
  const byCategoryMap = {};
  const byEmotionMap = {};
  cases.forEach(c => {
    if (c.category) byCategoryMap[c.category] = (byCategoryMap[c.category] || 0) + 1;
    if (c.emotion) byEmotionMap[c.emotion] = (byEmotionMap[c.emotion] || 0) + 1;
  });
  const byCategory = Object.entries(byCategoryMap)
    .map(([k, v]) => ({ category: k, count: v }))
    .sort((a, b) => b.count - a.count);
  const byEmotion = Object.entries(byEmotionMap)
    .map(([k, v]) => ({ emotion: k, count: v }))
    .sort((a, b) => b.count - a.count);

  const totalCases = cases.length;
  const aiResolved = cases.filter(c => c.status === 'AI자동해결').length;
  const negativeEmotions = cases.filter(c => c.emotion === '화남' || c.emotion === '짜증').length;
  const aiResolveRate = totalCases > 0 ? aiResolved / totalCases : 0;
  const negativeRate = totalCases > 0 ? negativeEmotions / totalCases : 0;
  // 평가용 도구는 만족도 측정 안 함 → 70점 만점 가중 합산 후 100점 환산 (stores.js와 동일 로직)
  const score = Math.round(((aiResolveRate * 40) + ((1 - negativeRate) * 30)) * 100 / 70);

  const statsText = [
    `총 상담: ${totalCases}건 / case_id < ${maxCaseId} 최근 ${limit}건`,
    `카테고리별: ${byCategory.map(r => `${r.category} ${r.count}건`).join(', ') || '없음'}`,
    `감정별: ${byEmotion.map(r => `${r.emotion} ${r.count}건`).join(', ') || '없음'}`,
  ].join('\n');

  const summaryText = cases
    .slice(0, 30)
    .map(r => {
      const s = (r.summary || '').replace(/\s+/g, ' ').slice(0, 80);
      return `${r.category || '미분류'}|${r.emotion || '없음'}|${s}`;
    })
    .join('\n');

  let analysis;
  try {
    analysis = await analyzeSolutions(statsText, summaryText);
  } catch (e) {
    console.error(`   ❌ analyzeSolutions 실패 (store_id=${storeId}): ${e.message}`);
    analysis = { headline: 'ERROR', issues: [], strategies: [] };
  }

  return {
    storeId,
    storeName: cases[0]?.store_name || `store_${storeId}`,
    storeCategory: cases[0]?.store_category || 'N/A',
    cases,
    analysis,
    statsText,
    summaryText,
    score,
    aiResolveRate,
    negativeRate,
    skipped: false,
  };
}

function renderStoreSection(idx, result) {
  if (result.skipped) {
    return `### 매장 #${idx} — store_id=${result.storeId} (스킵: 케이스 ${limit}건 미달)\n\n---\n\n`;
  }
  let md = `### 매장 #${idx} — store_id=${result.storeId} · ${result.storeName} (${result.storeCategory})\n\n`;
  md += `- 품질 score: **${result.score}점** (AI해결률 ${(result.aiResolveRate * 100).toFixed(0)}% / 부정감정 ${((result.negativeRate) * 100).toFixed(0)}%)\n`;
  md += `- 인풋 케이스: ${result.cases.length}건\n\n`;

  const a = result.analysis;
  md += `#### Headline\n> ${a.headline || '(없음)'}\n\n`;
  md += `#### Issues (${(a.issues || []).length}개)\n`;
  if (a.issues && a.issues.length > 0) {
    a.issues.forEach((iss, i) => {
      if (typeof iss === 'string') md += `${i + 1}. ${iss}\n`;
      else md += `${i + 1}. **${iss.title || iss.headline || ''}**: ${iss.description || iss.detail || JSON.stringify(iss)}\n`;
    });
  } else md += `(없음)\n`;
  md += `\n#### Strategies (${(a.strategies || []).length}개)\n`;
  if (a.strategies && a.strategies.length > 0) {
    a.strategies.forEach((st, i) => {
      if (typeof st === 'string') md += `${i + 1}. ${st}\n`;
      else {
        const urg = st.urgency ? ` [urgency=${st.urgency}]` : '';
        md += `${i + 1}. **${st.title || st.headline || ''}**${urg}: ${st.description || st.action || JSON.stringify(st)}\n`;
      }
    });
  } else md += `(없음)\n`;

  md += `\n#### 평가 (1~5점)\n`;
  md += `| 항목 | 점수 | 메모 |\n|---|---|---|\n`;
  md += `| Headline 적절성 |  |  |\n`;
  md += `| Issues 가치 |  |  |\n`;
  md += `| Strategies 실행가능성 |  |  |\n`;
  md += `| Urgency 적정성 |  |  |\n`;
  md += `| 전체 솔루션 평가 |  |  |\n\n`;

  md += `<details>\n<summary>분석에 쓰인 케이스 ${result.cases.length}건 + 입력 텍스트</summary>\n\n`;
  md += `| # | case_id | 카테고리 | 감정 | status | summary | 생성일 |\n`;
  md += `|---|---------|---------|------|--------|---------|--------|\n`;
  result.cases.forEach((c, i) => {
    md += `| ${i + 1} | ${c.case_id} | ${c.category ?? '미분류'} | ${c.emotion ?? '없음'} | ${c.status ?? ''} | ${escapeMd(c.summary, 100)} | ${c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : ''} |\n`;
  });
  md += `\n**statsText**:\n\`\`\`\n${result.statsText}\n\`\`\`\n\n`;
  md += `**summaryText**:\n\`\`\`\n${result.summaryText}\n\`\`\`\n\n</details>\n\n---\n\n`;
  return md;
}

async function main() {
  // 매장 선택
  let storeIds = [];
  if (storeIdFixed !== null && !isNaN(storeIdFixed)) {
    // 고정 매장 → iterations 만큼 반복
    for (let i = 0; i < iterations; i++) storeIds.push(storeIdFixed);
    if (iterations > 1) console.log(`🔁 store_id=${storeIdFixed}로 ${iterations}회 반복 (일관성 측정)`);
  } else {
    // 랜덤: iterations 만큼 다른 매장
    storeIds = await pickNRandomStoreIds(iterations);
    if (storeIds.length === 0) {
      console.error(`❌ 평가 가능한 매장 0개 (case_id < ${maxCaseId} + summary 있는 케이스 ${limit}건 이상)`);
      await pool.end();
      process.exit(1);
    }
    if (storeIds.length < iterations) {
      console.warn(`⚠️  조건 충족 매장이 ${storeIds.length}개뿐, 요청한 ${iterations}개보다 적음`);
    }
    console.log(`🎲 랜덤 매장 ${storeIds.length}개 선택: ${storeIds.join(', ')}`);
  }

  // 각 매장 분석
  const results = [];
  for (let i = 0; i < storeIds.length; i++) {
    const sid = storeIds[i];
    console.log(`🧠 [${i + 1}/${storeIds.length}] store_id=${sid} analyzeSolutions 호출...`);
    const r = await analyzeOneStore(sid);
    results.push(r);
  }

  // Markdown 생성
  const ts = new Date().toISOString();
  let md = `# 솔루션 분석 평가 — ${results.length} iteration\n\n`;
  md += `- 생성 시각: ${ts}\n`;
  md += `- 인자: store=${storeArg ?? 'random'} / limit=${limit} / maxCaseId=${maxCaseId} / iterations=${iterations}\n`;
  md += `- 평가 항목: Headline 적절성 / Issues 가치 / Strategies 실행가능성 / Urgency 적정성 / 전체\n\n`;

  md += `## 매장 요약\n\n`;
  md += `| # | store_id | 업종 | 케이스 | score | Headline 한 줄 |\n`;
  md += `|---|----------|------|--------|-------|----------------|\n`;
  results.forEach((r, i) => {
    if (r.skipped) {
      md += `| ${i + 1} | ${r.storeId} | - | 0 | - | (스킵) |\n`;
    } else {
      md += `| ${i + 1} | ${r.storeId} | ${r.storeCategory} | ${r.cases.length} | ${r.score} | ${escapeMd(r.analysis.headline, 60)} |\n`;
    }
  });

  md += `\n## 매장별 상세 + 평가\n\n`;
  results.forEach((r, i) => {
    md += renderStoreSection(i + 1, r);
  });

  md += `\n## 종합 평가 (전체 ${results.length} iteration)\n\n`;
  md += `| 항목 | 평균 점수 (직접 계산) | 메모 |\n|---|---|---|\n`;
  md += `| Headline 적절성 |  |  |\n`;
  md += `| Issues 가치 |  |  |\n`;
  md += `| Strategies 실행가능성 |  |  |\n`;
  md += `| Urgency 적정성 |  |  |\n`;
  md += `| 전체 |  |  |\n`;

  const stamp = ts.slice(0, 19).replace(/[:T]/g, '-');
  const filename = `eval-solutions-iter${results.length}-${stamp}.md`;
  fs.writeFileSync(filename, md, 'utf8');
  console.log(`\n✅ 솔루션 평가 데이터 ${results.length} iteration → ${filename}`);

  await pool.end();
}

main().catch(async (e) => {
  console.error('❌ 실행 오류:', e);
  await pool.end();
  process.exit(1);
});
