import express from 'express';
import passport from 'passport';

const router = express.Router();

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

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
    
      req.session.save((err) => {
        if (err) return next(err);
        return res.redirect(`${process.env.ROOT_URL}/home`);
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
        id: req.user.id,
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