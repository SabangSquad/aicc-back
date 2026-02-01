// 인증 상태 체크
export const isAuthorized = (req, res, next) => {
  // 비밀 키(AI 전용) 확인
  const internalSecret = req.headers['x-internal-secret'];
  if (internalSecret && internalSecret === process.env.INTERNAL_SECRET_KEY) {
    return next();
  }

  // 세션 인증 확인
  if (req.isAuthenticated()) {
    return next();
  }
  
  res.status(401).json({ message: "로그인이 필요합니다." });
};

// 관리자 권한 체크 (AI 혹은 관리자)
export const isAdmin = (req, res, next) => {
  // AI는 시스템 대행이므로 관리자 권한을 부여하여 통과
  const internalSecret = req.headers['x-internal-secret'];
  if (internalSecret && internalSecret === process.env.INTERNAL_SECRET_KEY) {
    return next();
  }

  // 기존 관리자 세션 확인
  if (req.isAuthenticated() && req.user.role === 'ADMIN') {
    return next();
  }

  res.status(403).json({ message: "관리자만 접근 가능한 페이지입니다." });
};