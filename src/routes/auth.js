import express from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';

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

      // 1. JWT 토큰 생성 (유저 ID, 이메일, 역할 포함)
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET, // .env에 정의된 비밀키
        { expiresIn: '24h' }    // 토큰 유효 시간
      );

      // 2. 쿠키에 토큰 설정
      res.cookie('auth_token', token, {
        httpOnly: true,       // 자바스크립트로 접근 불가 (XSS 방지)
        secure: true,         // HTTPS 환경에서만 전송
        sameSite: 'lax',      // CSRF 보호
        maxAge: 24 * 60 * 60 * 1000 // 24시간 유지
      });

      // 3. /home으로 리다이렉트
      return res.redirect('https://aicc-web.duckdns.org/home');
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