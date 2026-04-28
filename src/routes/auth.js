import express from 'express';
import passport from 'passport';

const router = express.Router();

// returnTo 검증: 같은 사이트 내부 경로만 허용 (open redirect 방어)
function isSafePath(p) {
  return typeof p === 'string'
    && p.startsWith('/')
    && !p.startsWith('//')
    && !p.includes('\\');
}

// role과 경로 매칭 검증
function isAllowedForRole(path, role) {
  const isChatPath = path === '/chat' || path.startsWith('/chat/');
  if (role === 'CUSTOMER') return isChatPath;
  return !isChatPath;
}

router.get('/google', (req, res, next) => {
  if (req.query.returnTo && isSafePath(req.query.returnTo)) {
    req.session.returnTo = req.query.returnTo;
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', (err, user, info) => {
    if (err) return next(err);

    if (!user) {
      return res.status(403).json({
        success: false,
        message: info ? info.message : '로그인 실패'
      });
    }

    req.logIn(user, (err) => {
      if (err) return next(err);

      const savedReturnTo = req.session.returnTo;
      delete req.session.returnTo;

      req.session.save((err) => {
        if (err) return next(err);

        const fallback = user.role === 'CUSTOMER' ? '/chat' : '/home';
        const target = (savedReturnTo && isSafePath(savedReturnTo) && isAllowedForRole(savedReturnTo, user.role))
          ? savedReturnTo
          : fallback;

        return res.redirect(`${process.env.ROOT_URL}${target}`);
      });
    });
  })(req, res, next);
});

// 인증 상태 확인
router.get('/status', (req, res) => {
  if (req.isAuthenticated() && req.user) {
    return res.json({
      isAuthenticated: true,
      user: {
        store_id: req.user.store_id,
        customer_id: req.user.customer_id,
        email: req.user.email,
        role: req.user.role,
        name: req.user.name
      }
    });
  }
  res.status(401).json({ isAuthenticated: false });
});

// 로그아웃 라우터
router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);

    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('connect.sid'); 

      return res.redirect(`${process.env.ROOT_URL}`);
    });
  });
});

export default router;