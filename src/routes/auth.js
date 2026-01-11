import express from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';

const router = express.Router();

router.get('/google', (req, res, next) => {
  const redirectTo = req.query.redirect_to || 'http://localhost:3000';
  
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    state: redirectTo
  })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', (err, user, info) => {
    if (err) return next(err);
    
    // 유저가 없거나 인증 실패
    if (!user) {
      return res.status(403).json({ 
        success: false, 
        message: info ? info.message : '로그인 실패' 
      });
    }

    // 로그인 성공 처리
    req.logIn(user, (err) => {
      if (err) return next(err);
      const returnTo = req.query.state || 'https://aicc-web.duckdns.org';
      return res.redirect(`${returnTo}/home`);
    });
  })(req, res, next);
});

// 인증 상태 확인
router.get('/status', (req, res) => {
  // Passport 세션이 유효한지 확인
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
  // 인증되지 않음
  res.status(401).json({ isAuthenticated: false });
});

// 로그아웃 라우터
router.get('/logout', (req, res, next) => {
  const returnTo = req.query.redirect_to || 'https://aicc-web.duckdns.org';
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('connect.sid');
      return res.redirect(returnTo);
    });
  });
});

export default router;