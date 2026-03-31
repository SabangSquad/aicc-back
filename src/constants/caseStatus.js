export const CASE_STATUS = Object.freeze({
  WAITING:     '대기',
  COUNSELING:  '상담',
  CLOSED:      '종료',
  AI_RESOLVED: 'AI자동해결',
});

// 수동 변경 가능한 상태 (AI자동해결은 시스템 전용)
export const MUTABLE_STATUSES = new Set([
  CASE_STATUS.WAITING,
  CASE_STATUS.COUNSELING,
  CASE_STATUS.CLOSED,
]);

export const ALL_STATUSES = new Set(Object.values(CASE_STATUS));
