// 종료된 상담의 잘못된 category 재분류 스크립트
// 실행: node scripts/recategorize-cases.js [--store-id=N] [--dry-run] [--all]
//   --store-id=N : 특정 가게만 처리
//   --dry-run    : DB 수정 안 하고 변경 예정만 출력
//   --all        : 잘못된 것뿐 아니라 모든 종료 상담 재분류 (느림)

import 'dotenv/config';
import pool from '../src/db.js';
import { analyzeCaseConversation } from '../src/bedrock.js';

const args = process.argv.slice(2);
const storeIdArg = args.find(a => a.startsWith('--store-id='));
const STORE_ID = storeIdArg ? parseInt(storeIdArg.split('=')[1], 10) : null;
const DRY_RUN = args.includes('--dry-run');
const ALL = args.includes('--all');

const ALLOWED = {
  '병원': ['예약', '예약확인', '예약변경', '예약취소', '진료과목'],
  '식당': ['예약', '예약확인', '예약변경', '예약취소', '메뉴', '가격'],
  '이커머스': ['배송조회', '주문확인', '환불', '교환', '취소', '상품정보'],
};

function isInvalid(category, storeCategory) {
  if (category == null) return true;
  if (category === 'null') return true;
  if (category.includes('|')) return true;
  if (['이커머스', '병원', '식당'].includes(category)) return true;
  const allowed = ALLOWED[storeCategory] || [];
  if (allowed.length && !allowed.includes(category)) return true;
  return false;
}

async function main() {
  const conditions = ["c.status IN ('종료', 'AI자동해결')"];
  const params = [];

  if (STORE_ID) {
    params.push(STORE_ID);
    conditions.push(`c.store_id = $${params.length}`);
  }

  if (!ALL) {
    // 잘못된 카테고리만 — null/파이프/업종명/허용 외 값
    conditions.push(`(
      c.category IS NULL
      OR c.category LIKE '%|%'
      OR c.category IN ('이커머스', '병원', '식당')
      OR (s.category = '이커머스' AND c.category NOT IN ('배송조회','주문확인','환불','교환','취소','상품정보'))
      OR (s.category = '병원' AND c.category NOT IN ('예약','예약확인','예약변경','예약취소','진료과목'))
      OR (s.category = '식당' AND c.category NOT IN ('예약','예약확인','예약변경','예약취소','메뉴','가격'))
    )`);
  }

  const sql = `
    SELECT c.case_id, c.store_id, c.category, s.category AS store_category
    FROM cases c
    LEFT JOIN stores s ON c.store_id = s.store_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.case_id DESC
  `;
  const { rows } = await pool.query(sql, params);

  console.log(`\n🔍 대상: ${rows.length}건 ${STORE_ID ? `(store_id=${STORE_ID})` : '(전체)'} ${DRY_RUN ? '[DRY RUN]' : ''}`);
  if (rows.length === 0) {
    console.log('처리할 케이스가 없습니다.');
    await pool.end();
    return;
  }

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (const row of rows) {
    processed++;
    const tag = `[${processed}/${rows.length}] case ${row.case_id}`;
    try {
      const { rows: msgs } = await pool.query(
        'SELECT speaker, content FROM messages WHERE case_id = $1 ORDER BY occurred_at ASC',
        [row.case_id]
      );
      if (msgs.length === 0) {
        console.log(`${tag} 메시지 없음 → 스킵`);
        skipped++;
        continue;
      }

      const text = msgs.map(m => `${m.speaker}: ${m.content}`).join('\n');
      const analysis = await analyzeCaseConversation(text, row.store_category);
      const newCategory = analysis.json?.category;
      const newSummary = analysis.json?.summary;
      const newEmotion = analysis.json?.emotion;

      if (!newCategory) {
        console.log(`${tag} LLM이 카테고리 못 뽑음 → 스킵`);
        skipped++;
        continue;
      }

      if (newCategory === row.category && !ALL) {
        console.log(`${tag} 이미 정확 (${newCategory}) → 스킵`);
        skipped++;
        continue;
      }

      console.log(`${tag} "${row.category}" → "${newCategory}" (store=${row.store_category})`);

      if (!DRY_RUN) {
        await pool.query(
          `UPDATE cases SET category = $1, summary = COALESCE($2, summary), emotion = COALESCE($3, emotion) WHERE case_id = $4`,
          [newCategory, newSummary, newEmotion, row.case_id]
        );
        updated++;
      }
    } catch (e) {
      console.error(`${tag} ❌ 실패: ${e.message}`);
      failed++;
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n✅ 완료 (${elapsed}초)`);
  console.log(`   처리: ${processed}건 / 업데이트: ${updated}건 / 스킵: ${skipped}건 / 실패: ${failed}건`);
  if (DRY_RUN) console.log('   ※ DRY RUN 모드. 실제 DB 변경 없었음.');

  await pool.end();
}

main().catch(err => {
  console.error('스크립트 오류:', err);
  process.exit(1);
});
