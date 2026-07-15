// driven adapter — 로직의 주인은 better-auth. 설정+글루만 여기에.
import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import {
  admin,
  jwt,
  multiSession,
  organization,
  twoFactor,
} from 'better-auth/plugins';
import { db } from '../../../lib/db';
import { env } from '../../../lib/env';
import {
  sendInvitationEmail,
  sendResetPasswordEmail,
  sendVerificationEmail,
} from '../../email'; // ✅ 크로스 feature — 공개 API로만
import { buildJwtClaims } from '../claims';
import { ac, orgRoles } from './access-control';

const socialProviders: Record<
  string,
  { clientId: string; clientSecret: string }
> = {};
if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  };
}
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
    sendResetPassword: async ({ user, url }) => {
      await sendResetPasswordEmail({ to: user.email, name: user.name, url });
    },
  },
  emailVerification: {
    sendOnSignUp: env.REQUIRE_EMAIL_VERIFICATION,
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail({ to: user.email, name: user.name, url });
    },
  },
  socialProviders,
  plugins: [
    organization({
      teams: { enabled: true },
      ac,
      roles: orgRoles,
      sendInvitationEmail: async (data) => {
        await sendInvitationEmail({
          to: data.email,
          inviter: data.inviter.user.name ?? data.inviter.user.email,
          org: data.organization.name,
          url: `${env.BETTER_AUTH_URL}/accept-invitation/${data.id}`,
        });
      },
    }),
    twoFactor(),
    multiSession(),
    apiKey(),
    admin(),
    jwt({
      jwt: {
        // 제품 API가 JWKS 로컬검증만으로 plan/role/한도를 읽도록 클레임에 박는다.
        definePayload: async ({ user, session }) => {
          const orgId =
            (session as { activeOrganizationId?: string | null })
              .activeOrganizationId ?? null;
          const claims = await buildJwtClaims({ userId: user.id, orgId });
          return { email: user.email, ...claims };
        },
      },
    }),
  ],
});
