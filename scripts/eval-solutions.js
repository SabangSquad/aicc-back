// scripts/eval-solutions.js
// solutionAnalyzer 평가용: 최근 N건 상담을 입력으로 ai_analysis 생성 후 평가용 markdown 출력
//
// 사용:
//   node scripts/eval-solutions.js [store_id|random] [limit=10] [max_case_id=500]
//   node scripts/eval-solutions.js random 10 500   # 랜덤 매장 (eval-export와 다른 매장 가능)
//   node scripts/eval-solutions.js 3 10 500        # store_id=3 고정 (eval-export와 같은 매장 평가하려면 이쪽)
//
// 출력: eval-solutions-store{id}-{ts}.md
// 평가 항목: headline 적절성 / issues 가치 / strategies 실행가능성 / urgency 적정성

import 'dotenv/config';
import fs from 'fs';
import pool from '../src/db.js';
import { analyzeSolutions } from '../src/bedrock.js';

const storeArg = process.argv[2];
const limit = parseInt(process.argv[3] || '10', 10);
const maxCaseId = parseInt(process.argv[4] || '500', 10);
const storeIdFixed = storeArg && storeArg !== 'random' ? parseInt(storeArg, 10) : null;

function escapeMd(s, maxLen = 200) {
  if (s == null) return '';
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' / ').slice(0, maxLen);
}

async function pickRandomStoreId() {
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
  let storeId = storeIdFixed;
  if (storeId === null || isNaN(storeId)) {
    storeId = await pickRandomStoreId();
    if (!storeId) {
      console.error(`❌ 평가 가능한 매장 없음 (case_id < ${maxCaseId} + summary 있는 케이스 ${limit}건 이상)`);
      await pool.end();
      process.exit(1);
    }
    console.log(`🎲 랜덤 매장 선택: store_id=${storeId}`);
    console.log(`   ⚠️  추천/감정 평가도 같은 매장으로 돌리려면: node scripts/eval-export.js ${storeId} ${limit} ${maxCaseId}`);
  }

  console.log(`🔍 store_id=${storeId} 솔루션 분석 평가: 최근 ${limit}건 (case_id < ${maxCaseId})`);

  // 1. case_id < maxCaseId + summary 있는 최근 limit건
  const { rows: cases } = await pool.query(
    `SELECT c.case_id, c.category, c.emotion, c.summary, c.status, c.created_at, c.closed_at,
            s.category AS store_category, s.name AS store_name
     FROM cases c
     LEFT JOIN stores s ON c.store_id = s.store_id
     WHERE c.store_id = $1 AND c.summary IS NOT NULL AND c.case_id < $3
     ORDER BY c.case_id DESC
     LIMIT $2`,
    [storeId, limit, maxCaseId]
  );

  if (cases.length === 0) {
    console.error('❌ 평가할 케이스 0건');
    await pool.end();
    process.exit(1);
  }
  console.log(`   └─ ${cases.length}건 확보`);

  // 2. 통계 계산 (stores.js /solutions 로직 그대로)
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
  // 만족도는 평가용이라 0 처리 (시간 범위 아닌 case_id 기준이라 satisfactions 매핑 애매)
  const score = Math.round((aiResolveRate * 40) + ((1 - negativeRate) * 30));

  // 3. AI 인풋 텍스트 구성
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

  // 4. analyzeSolutions 호출
  console.log(`🧠 analyzeSolutions 호출 중...`);
  let analysis;
  try {
    analysis = await analyzeSolutions(statsText, summaryText);
  } catch (e) {
    console.error(`❌ analyzeSolutions 실패: ${e.message}`);
    analysis = { headline: 'ERROR', issues: [], strategies: [] };
  }

  // 5. Markdown 생성
  const storeCategory = cases[0]?.store_category || 'N/A';
  const storeName = cases[0]?.store_name || `store_${storeId}`;
  const ts = new Date().toISOString();
  let md = `# 솔루션 분석 평가 — ${storeName}\n\n`;
  md += `- 생성 시각: ${ts}\n`;
  md += `- store_id: ${storeId} (업종: ${storeCategory})\n`;
  md += `- 인풋: case_id < ${maxCaseId} 최근 ${limit}건 (summary 있는 것만)\n`;
  md += `- 품질 score: **${score}점** (AI해결률 ${(aiResolveRate * 100).toFixed(0)}% × 40 + 부정감정 비율 역수 ${((1 - negativeRate) * 100).toFixed(0)}% × 30, 만족도 제외)\n\n`;

  md += `## AI 분석 결과 (평가 대상)\n\n`;
  md += `### Headline\n> ${analysis.headline || '(없음)'}\n\n`;
  md += `### Issues (${(analysis.issues || []).length}개)\n`;
  if (analysis.issues && analysis.issues.length > 0) {
    analysis.issues.forEach((iss, idx) => {
      if (typeof iss === 'string') {
        md += `${idx + 1}. ${iss}\n`;
      } else {
        md += `${idx + 1}. **${iss.title || iss.headline || ''}**: ${iss.description || iss.detail || JSON.stringify(iss)}\n`;
      }
    });
  } else {
    md += `(없음)\n`;
  }
  md += `\n### Strategies (${(analysis.strategies || []).length}개)\n`;
  if (analysis.strategies && analysis.strategies.length > 0) {
    analysis.strategies.forEach((st, idx) => {
      if (typeof st === 'string') {
        md += `${idx + 1}. ${st}\n`;
      } else {
        const urg = st.urgency ? ` [urgency=${st.urgency}]` : '';
        md += `${idx + 1}. **${st.title || st.headline || ''}**${urg}: ${st.description || st.action || JSON.stringify(st)}\n`;
      }
    });
  } else {
    md += `(없음)\n`;
  }

  md += `\n## 평가 항목 (점수 입력)\n\n`;
  md += `| 평가 항목 | 1~5점 | 메모 |\n`;
  md += `|---|---|---|\n`;
  md += `| Headline 적절성 (매장 현황 정확히 요약) |  |  |\n`;
  md += `| Issues 가치 (실제 운영에 의미 있는 문제 발견) |  |  |\n`;
  md += `| Strategies 실행가능성 (사장이 실제로 할 수 있는 대응) |  |  |\n`;
  md += `| Urgency 등급 적정성 (high/medium/low 적절) |  |  |\n`;
  md += `| 전체 솔루션 평가 (1~5 종합) |  |  |\n\n`;

  md += `\n## 분석에 쓰인 케이스 ${cases.length}건\n\n`;
  md += `| # | case_id | 카테고리 | 감정 | status | summary | 생성일 |\n`;
  md += `|---|---------|---------|------|--------|---------|--------|\n`;
  cases.forEach((c, i) => {
    md += `| ${i + 1} | ${c.case_id} | ${c.category ?? '미분류'} | ${c.emotion ?? '없음'} | ${c.status ?? ''} | ${escapeMd(c.summary, 100)} | ${c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : ''} |\n`;
  });

  md += `\n## 통계 (analyzeSolutions에 입력된 값)\n\n`;
  md += `**statsText**:\n\`\`\`\n${statsText}\n\`\`\`\n\n`;
  md += `**summaryText**:\n\`\`\`\n${summaryText}\n\`\`\`\n`;

  // 6. 파일 저장
  const stamp = ts.slice(0, 19).replace(/[:T]/g, '-');
  const filename = `eval-solutions-store${storeId}-${stamp}.md`;
  fs.writeFileSync(filename, md, 'utf8');
  console.log(`\n✅ 솔루션 평가 데이터 → ${filename}`);
  console.log(`   AI 분석 결과 + 인풋 케이스 ${cases.length}건 + 평가 입력 칸 포함`);

  await pool.end();
}

main().catch(async (e) => {
  console.error('❌ 실행 오류:', e);
  await pool.end();
  process.exit(1);
});
