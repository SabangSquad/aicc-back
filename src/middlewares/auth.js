export const isAuthorized = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "로그인이 필요합니다." });
};

// 관리자 권한 체크
export const isAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'ADMIN') {
    return next();
  }
  // 사용자가 접근할 경우 "권한 없음" 메시지 전송
  res.status(403).json({ message: "관리자만 접근 가능한 페이지입니다." });
};