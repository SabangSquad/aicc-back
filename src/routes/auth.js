import express from 'express';
import passport from 'passport';

const router = express.Router();

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

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
      return res.json({ success: true, message: "로그인 성공", user });
    });
  })(req, res, next);
});

// 로그아웃
router.get('/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ message: "로그아웃 성공" });
    });
  });
});

export default router;