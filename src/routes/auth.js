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
  // 1. Passport 세션 로그아웃
  req.logout((err) => {
    if (err) return next(err);

    // 2. 서버 세션 파괴
    req.session.destroy((err) => {
      if (err) return next(err);

      // 3. 브라우저에 저장된 쿠키들 삭제
      res.clearCookie('auth_token'); // JWT 쿠키 삭제
      res.clearCookie('connect.sid'); // 세션 쿠키 삭제

      // 4. 메인 페이지로 리다이렉트
      return res.redirect('https://aicc-web.duckdns.org');
    });
  });
});

export default router;