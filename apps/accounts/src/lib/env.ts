import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';

// bun은 "cwd의 .env"만 자동 로드한다 — 루트에서 실행하면 로드되고
// apps/accounts에서 실행하면 안 되는 함정 (시크릿이 컨텍스트마다 갈려서
// jwks 복호화 실패 같은 사고가 남). 모노레포 루트 .env를 명시 병합한다.
// 이미 설정된 실제 환경변수(CI 등)가 항상 우선.
const rootEnvPath = new URL('../../../../.env', import.meta.url).pathname;
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

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z
  .object({
    APP_ENV: z.enum(['dev', 'test', 'prod']).default('dev'),
    DATABASE_URL: z.string().default('postgres://p0:p0@localhost:5432/p0'),
    BETTER_AUTH_SECRET: z.string().default('dev-secret-change-me'),
    BETTER_AUTH_URL: z.string().default('http://localhost:4000'),
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

function loadEnv(): z.infer<typeof schema> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // import 타임에 raw zod 스택으로 죽지 말고 깔끔하게 알리고 종료
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`);
    console.error(`[accounts] invalid environment:\n${lines.join('\n')}`);
    // 테스트 러너에서는 throw (프로세스 죽이면 스위트 전체가 날아감)
    if (process.env.NODE_ENV === 'test' || process.env.BUN_TEST) {
      throw new Error('invalid environment');
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof schema>;
