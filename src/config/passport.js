import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import dotenv from 'dotenv';
import pool from '../db.js';

dotenv.config();

export const setupPassport = () => {
  passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/auth/google/callback"
    },
    async (accessToken, refreshToken, profile, done) => {
      const email = profile.emails[0].value;

      try {
        // 1. .env 어드민 체크
        if (email === process.env.ADMIN_EMAIL) {
          return done(null, { email, name: profile.displayName, role: 'ADMIN' });
        }

        // 2. DB 유저 체크
        const result = await pool.query('SELECT * FROM agents WHERE email = $1', [email]);
        const dbUser = result.rows[0];
        
        if (dbUser) {
          // agents 테이블에 있으면 로그인 허용
          return done(null, { ...dbUser, role: 'USER' });
        } else {
          return done(null, false, { message: '등록되지 않은 사용자입니다.' });
        }

      } catch (err) {
        console.error("인증 과정 중 DB 오류 발생:", err.message);
        return done(null, false, { message: '등록되지 않은 사용자입니다.' });
      }
    }
  ));

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));
};