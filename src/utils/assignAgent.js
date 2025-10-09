import pool from '../db.js';

/**
 * 신규 상담을 배정할 상담원 탐색
 * 온라인 상태인 상담원 중에서 상담 건수(완료 제외)가 가장 적은 상담원에게 배정
 *
 * @returns {Promise<number|null>} - 배정된 상담원의 ID. 배정 가능한 상담원이 없으면 반환
 */
export async function assignAgentByLeastConnections() {
  try {
    const query = `
      SELECT
          a.agent_id,
          COUNT(c.case_id) AS active_cases
      FROM
          agents a
      LEFT JOIN
          cases c ON a.agent_id = c.agent_id AND c.status != '완료'
      WHERE
          a.is_online = true
      GROUP BY
          a.agent_id
      ORDER BY
          active_cases ASC
      LIMIT 1;
    `;

    const { rows } = await pool.query(query);

    if (rows.length > 0) {
      return rows[0].agent_id;
    } else {
      return null;
    }
  } catch (error) {
    console.error('상담원 배정 로직 실행 중 오류 발생:', error);
    throw error;
  }
}