// env 스키마 코너케이스 — 잘못된 값이 조용히 통과하거나 boot를 raw로 죽이지 않게.
import { describe, expect, test } from 'bun:test';
import { envSchema } from '../env';

const base = { DATABASE_URL: 'postgres://x', BETTER_AUTH_SECRET: 'x'.repeat(40) };

describe('env — PORT', () => {
  test('PORT=abc(NaN)는 거부된다 (예전엔 z.number()를 통과했음)', () => {
    expect(envSchema.safeParse({ ...base, PORT: 'abc' }).success).toBe(false);
  });
  test('PORT=0/음수/범위초과 거부', () => {
    expect(envSchema.safeParse({ ...base, PORT: '0' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, PORT: '-1' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, PORT: '70000' }).success).toBe(false);
  });
  test('정상 PORT 통과', () => {
    const r = envSchema.safeParse({ ...base, PORT: '4000' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.PORT).toBe(4000);
  });
});

describe('env — bool 강제', () => {
  test('true/false 문자열만 허용, 그 외 거부', () => {
    expect(envSchema.safeParse({ ...base, REQUIRE_EMAIL_VERIFICATION: 'true' }).success).toBe(true);
    expect(envSchema.safeParse({ ...base, REQUIRE_EMAIL_VERIFICATION: '1' }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, REQUIRE_EMAIL_VERIFICATION: 'TRUE' }).success).toBe(false);
  });
  test('미지정은 false로 default', () => {
    const r = envSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.REQUIRE_EMAIL_VERIFICATION).toBe(false);
  });
});

describe('env — prod 필수 시크릿 (조용한 degrade 방지)', () => {
  test('prod에서 RESEND/STRIPE/이메일인증 없으면 실패', () => {
    const r = envSchema.safeParse({ ...base, APP_ENV: 'prod' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('RESEND_API_KEY');
      expect(paths).toContain('STRIPE_SECRET_KEY');
      expect(paths).toContain('STRIPE_WEBHOOK_SECRET');
      expect(paths).toContain('REQUIRE_EMAIL_VERIFICATION');
    }
  });
  test('prod에서 dev 시크릿 그대로면 실패', () => {
    const r = envSchema.safeParse({
      DATABASE_URL: 'postgres://x',
      BETTER_AUTH_SECRET: 'dev-secret-change-me',
      APP_ENV: 'prod',
      RESEND_API_KEY: 'k',
      STRIPE_SECRET_KEY: 'k',
      STRIPE_WEBHOOK_SECRET: 'k',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path.join('.'))).toContain('BETTER_AUTH_SECRET');
    }
  });
  test('prod에서 모든 필수 키 채우면 통과', () => {
    const r = envSchema.safeParse({
      DATABASE_URL: 'postgres://x',
      BETTER_AUTH_SECRET: 'x'.repeat(40),
      BETTER_AUTH_URL: 'https://accounts.p0.dev',
      APP_URL: 'https://app.p0.dev',
      APP_ENV: 'prod',
      RESEND_API_KEY: 'k',
      STRIPE_SECRET_KEY: 'k',
      STRIPE_WEBHOOK_SECRET: 'k',
      REQUIRE_EMAIL_VERIFICATION: 'true',
      // 모든 usage metric은 prod에서 meter 매핑 필수 (릴레이 큐 굶김 방지)
      STRIPE_METER_AI_TOKENS: 'mtr_ai',
      STRIPE_METER_SCANS: 'mtr_scans',
      STRIPE_METER_STORAGE_MB: 'mtr_storage',
    });
    expect(r.success).toBe(true);
  });

  test('prod에서 APP_URL 미설정이면 실패 (Stripe/초대 URL 오라우팅 방지)', () => {
    const r = envSchema.safeParse({
      DATABASE_URL: 'postgres://x',
      BETTER_AUTH_SECRET: 'x'.repeat(40),
      BETTER_AUTH_URL: 'https://accounts.p0.dev',
      APP_ENV: 'prod',
      RESEND_API_KEY: 'k',
      STRIPE_SECRET_KEY: 'k',
      STRIPE_WEBHOOK_SECRET: 'k',
      REQUIRE_EMAIL_VERIFICATION: 'true',
      STRIPE_METER_AI_TOKENS: 'mtr_ai',
      STRIPE_METER_SCANS: 'mtr_scans',
      STRIPE_METER_STORAGE_MB: 'mtr_storage',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path.join('.'))).toContain('APP_URL');
    }
  });

  test('prod에서 BETTER_AUTH_URL이 http면 실패 (Secure 쿠키 불가)', () => {
    const r = envSchema.safeParse({
      DATABASE_URL: 'postgres://x',
      BETTER_AUTH_SECRET: 'x'.repeat(40),
      BETTER_AUTH_URL: 'http://accounts.p0.dev',
      APP_ENV: 'prod',
      RESEND_API_KEY: 'k',
      STRIPE_SECRET_KEY: 'k',
      STRIPE_WEBHOOK_SECRET: 'k',
      REQUIRE_EMAIL_VERIFICATION: 'true',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path.join('.'))).toContain('BETTER_AUTH_URL');
    }
  });
  test('dev에서는 시크릿 없어도 통과 (콘솔 폴백 등)', () => {
    expect(envSchema.safeParse({ ...base, APP_ENV: 'dev' }).success).toBe(true);
  });
});
