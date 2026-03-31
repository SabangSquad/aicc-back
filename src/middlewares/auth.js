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

// OWNER/ADMIN 전용 (store_id 검증 없음 — store_id가 경로에 없는 엔드포인트용)
export const isOwner = (req, res, next) => {
  const secret = req.headers['x-internal-secret'];
  if (secret === process.env.INTERNAL_SECRET_KEY) return next();
  if (req.isAuthenticated() && ['OWNER', 'ADMIN'].includes(req.user?.role)) return next();
  res.status(403).json({ message: '가게 오너만 접근 가능합니다.' });
};

// 해당 가게의 OWNER만 접근 가능 (req.params.store_id === req.user.store_id)
export const isStoreOwner = (req, res, next) => {
  const secret = req.headers['x-internal-secret'];
  if (secret === process.env.INTERNAL_SECRET_KEY) return next();
  if (!req.isAuthenticated()) return res.status(401).json({ message: '로그인이 필요합니다.' });
  if (req.user.role === 'ADMIN') return next();

  const storeId = Number(req.params.store_id);
  if (req.user.role === 'OWNER' && req.user.store_id === storeId) return next();

  res.status(403).json({ message: '해당 가게의 오너만 접근 가능합니다.' });
};

// 고객 본인 또는 OWNER/ADMIN
export const isCustomerOrOwner = (req, res, next) => {
  const secret = req.headers['x-internal-secret'];
  if (secret === process.env.INTERNAL_SECRET_KEY) return next();
  if (!req.isAuthenticated()) return res.status(401).json({ message: '로그인이 필요합니다.' });

  const { role, customer_id } = req.user;
  if (['OWNER', 'ADMIN'].includes(role)) return next();

  const paramId = Number(req.params.customer_id);
  if (role === 'CUSTOMER' && customer_id === paramId) return next();

  res.status(403).json({ message: '본인 정보만 접근 가능합니다.' });
};