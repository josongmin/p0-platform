import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';

// bun은 "cwd의 .env"만 자동 로드한다 — 루트에서 실행하면 로드되고
// apps/accounts에서 실행하면 안 되는 함정 (시크릿이 컨텍스트마다 갈려서
// jwks 복호화 실패 같은 사고가 남). 모노레포 루트 .env를 명시 병합한다.
// 이미 설정된 실제 환경변수(CI 등)가 항상 우선.
const rootEnvPath = new URL('../../../../.env', import.meta.url).pathname;
try {
  if (existsSync(rootEnvPath)) {
    for (const line of readFileSync(rootEnvPath, 'utf8').split('\n')) {
      const eq = line.indexOf('=');
      if (eq <= 0 || line.trimStart().startsWith('#')) continue;
      const key = line.slice(0, eq).trim();
      if (process.env[key] === undefined) {
        process.env[key] = line.slice(eq + 1).trim();
      }
    }
  }
} catch (e) {
  // .env가 읽기불가(권한 등)여도 import 타임에 raw 스택으로 죽지 않는다 (P5).
  console.warn('[accounts] could not read root .env:', e);
}

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z
  .object({
    APP_ENV: z.enum(['dev', 'test', 'prod']).default('dev'),
    CI: z.string().optional(),
    DATABASE_URL: z.string().default('postgres://p0:p0@localhost:5432/p0'),
    BETTER_AUTH_SECRET: z.string().default('dev-secret-change-me'),
    BETTER_AUTH_URL: z.string().default('http://localhost:4000'),
    // 브라우저 FE origin 화이트리스트 (콤마 구분) — CORS + better-auth CSRF(trustedOrigins).
    // 미설정이면 same-origin만. prod에서 크로스오리진 FE면 필수.
    TRUSTED_ORIGINS: z.string().optional(),
    // 고객 대면(브라우저) 베이스 URL — Stripe 체크아웃/포탈 리다이렉트와 초대 수락
    // 링크가 여기로 간다. FE origin. 미설정이면 TRUSTED_ORIGINS 첫 항목, 그것도
    // 없으면 dev FE(:5173)로 폴백 (아래 appBaseUrl).
    APP_URL: z.string().optional(),
    // NaN(=PORT=abc)이 z.number()를 통과하던 구멍 → int().positive()로 막음
    PORT: z.coerce.number().int().positive().max(65535).default(4000),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    // plan × cycle Stripe Price (미설정 plan은 checkout 불가 — placeholder 금지)
    STRIPE_PRICE_TEAM_MONTHLY: z.string().optional(),
    STRIPE_PRICE_TEAM_ANNUAL: z.string().optional(),
    STRIPE_PRICE_BUSINESS_MONTHLY: z.string().optional(),
    STRIPE_PRICE_BUSINESS_ANNUAL: z.string().optional(),
    // usage metric → Stripe Billing Meter event_name (없으면 해당 metric 릴레이 불가)
    STRIPE_METER_AI_TOKENS: z.string().optional(),
    STRIPE_METER_SCANS: z.string().optional(),
    STRIPE_METER_STORAGE_MB: z.string().optional(),
    // email — 키 없으면 콘솔 폴백 (dev). prod에서는 아래 refine이 필수화.
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('p0 <onboarding@resend.dev>'),
    REQUIRE_EMAIL_VERIFICATION: bool,
  })
  // prod에서 조용히 degrade하면 안 되는 것들을 boot 타임에 실패시킨다:
  // - RESEND 없으면 비번리셋 메일이 stdout으로만 나가고 유저는 영영 못 받음
  // - STRIPE 없으면 결제/웹훅이 요청 시점에 500
  .superRefine((v, ctx) => {
    if (v.APP_ENV !== 'prod') return;
    const required: Array<[boolean, string]> = [
      [!v.RESEND_API_KEY, 'RESEND_API_KEY'],
      [!v.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY'],
      [!v.STRIPE_WEBHOOK_SECRET, 'STRIPE_WEBHOOK_SECRET'],
      [v.BETTER_AUTH_SECRET === 'dev-secret-change-me', 'BETTER_AUTH_SECRET'],
      // 미인증 이메일로 즉시 인증세션 획득 방지 (P3: 계정 탈취/스팸)
      [!v.REQUIRE_EMAIL_VERIFICATION, 'REQUIRE_EMAIL_VERIFICATION'],
      // prod 쿠키에 Secure 플래그가 붙으려면 baseURL이 https여야 한다.
      [!v.BETTER_AUTH_URL.startsWith('https://'), 'BETTER_AUTH_URL'],
      // 고객 대면 URL(Stripe 리다이렉트·초대 수락)을 prod에서 명시 필수화 —
      // 미설정 시 TRUSTED_ORIGINS 첫 항목으로 조용히 폴백해 오라우팅 위험.
      [!v.APP_URL, 'APP_URL'],
      // 모든 usage metric에 Stripe meter 매핑 필수 — 하나라도 없으면 그 metric의
      // usage가 릴레이 배치에서 영구 defer돼 큐를 굶기고 무한증가한다(H1).
      [!v.STRIPE_METER_AI_TOKENS, 'STRIPE_METER_AI_TOKENS'],
      [!v.STRIPE_METER_SCANS, 'STRIPE_METER_SCANS'],
      [!v.STRIPE_METER_STORAGE_MB, 'STRIPE_METER_STORAGE_MB'],
    ];
    for (const [missing, key] of required) {
      if (missing) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} is required when APP_ENV=prod`,
          path: [key],
        });
      }
    }
  });

// 테스트에서 다양한 입력을 넣어보기 위해 스키마를 노출.
export const envSchema = schema;

function loadEnv(): z.infer<typeof schema> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // import 타임에 raw zod 스택으로 죽지 말고 깔끔하게 알리고 종료
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`);
    console.error(`[accounts] invalid environment:\n${lines.join('\n')}`);
    // 테스트 러너(bun test는 NODE_ENV=test)에서는 throw — 프로세스를 죽이면
    // 스위트 전체가 날아가므로. 그 외엔 깔끔히 종료.
    if (process.env.NODE_ENV === 'test') {
      throw new Error('invalid environment');
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

/**
 * 고객 대면(브라우저) 베이스 URL. Stripe 리다이렉트·초대 수락 링크는 반드시 FE로
 * 가야 한다 (BETTER_AUTH_URL=백엔드 origin으로 보내면 404). 우선순위:
 * APP_URL → TRUSTED_ORIGINS 첫 항목 → dev FE(:5173).
 */
export function appBaseUrl(): string {
  if (env.APP_URL) return env.APP_URL.replace(/\/+$/, '');
  const first = env.TRUSTED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean)[0];
  return (first ?? 'http://localhost:5173').replace(/\/+$/, '');
}
