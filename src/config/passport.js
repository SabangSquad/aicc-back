import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import dotenv from 'dotenv';
import pool from '../db.js';

dotenv.config();

export const setupPassport = () => {
  passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.ROOT_URL}${process.env.ROOT_URL.includes('localhost') ? '/auth/google/callback' : '/api/auth/google/callback'}`
    },
    async (accessToken, refreshToken, profile, done) => {
      const email = profile.emails[0].value;

      try {
        // 1. ADMIN
        if (email === process.env.ADMIN_EMAIL) {
          return done(null, { email, name: profile.displayName, role: 'ADMIN' });
        }

        // 2. OWNER (stores 테이블)
        const storeResult = await pool.query(
          'SELECT store_id, name, email FROM stores WHERE email = $1', [email]
        );
        if (storeResult.rows[0]) {
          return done(null, { ...storeResult.rows[0], role: 'OWNER' });
        }

        // 3. CUSTOMER (customers 테이블)
        const customerResult = await pool.query(
          'SELECT customer_id, name, email FROM customers WHERE email = $1', [email]
        );
        if (customerResult.rows[0]) {
          return done(null, { ...customerResult.rows[0], role: 'CUSTOMER' });
        }

        return done(null, false, { message: '등록되지 않은 사용자입니다.' });
      } catch (err) {
        console.error("인증 과정 중 DB 오류 발생:", err.message);
        return done(null, false, { message: '등록되지 않은 사용자입니다.' });
      }
    }
  ));

  passport.serializeUser((user, done) => done(null, user));  // 로그인 -> 세션에 user 저장
  passport.deserializeUser((user, done) => done(null, user));  // 매 요청 -> 세션에서 꺼내서 req.user에 넣음
};