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
import { bus } from '../../../lib/events';
import { env, appBaseUrl } from '../../../lib/env';
import {
  sendInvitationEmail,
  sendResetPasswordEmail,
  sendVerificationEmail,
} from '../../email'; // ✅ 크로스 feature — 공개 API로만
import { buildJwtClaims } from '../claims';
import { resolveSeatLimit, runOrgDeleting, runUserDeleting } from '../hooks';
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
  // CSRF: state-changing 요청의 Origin이 이 목록에 있어야 통과. baseURL은 자동 포함.
  trustedOrigins: env.TRUSTED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean),
  advanced: {
    // 프록시 뒤에서 실제 클라이언트 IP로 rate limit 버킷 분리.
    ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
    // prod에서 세션 쿠키에 Secure 강제 (env가 BETTER_AUTH_URL https도 검증).
    useSecureCookies: env.APP_ENV === 'prod',
  },
  // 브루트포스/크리덴셜 스터핑 방어. 기본은 prod-only·in-memory이므로 명시 활성화.
  // (멀티인스턴스 정확도를 원하면 secondaryStorage에 redis를 물릴 것 — 후속.)
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 5 },
      '/forget-password': { window: 60, max: 3 },
      '/two-factor/verify-totp': { window: 60, max: 5 },
    },
  },
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
  // 계정 관리 (GDPR 기본기).
  user: {
    // 계정 삭제 — 확인 이메일 후 실행. member/session/account는 FK cascade로 정리.
    deleteUser: {
      enabled: true,
      sendDeleteAccountVerification: async ({ user, url }) => {
        await sendVerificationEmail({ to: user.email, name: user.name, url });
      },
      // C1: 삭제 직전, 이 사용자가 유일 owner인 org의 Stripe 구독 취소 + org 삭제.
      // 안 하면 주인 없는 org의 구독이 영원히 청구됨 (org-delete 훅 우회).
      beforeDelete: async (user: { id: string }) => {
        await runUserDeleting(user.id);
      },
    },
    // 이메일 변경 — 새 주소로 확인 메일.
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async (data: {
        user: { name: string };
        newEmail: string;
        url: string;
      }) => {
        await sendVerificationEmail({
          to: data.newEmail,
          name: data.user.name,
          url: data.url,
        });
      },
    },
  },
  socialProviders,
  plugins: [
    organization({
      teams: { enabled: true },
      ac,
      roles: orgRoles,
      // 시트 한도 강제 — org plan 기준 최대 멤버수. 초대·멤버추가 양쪽에서 검사되어
      // 한도 초과 시 FORBIDDEN. resolver는 composition root에서 주입(순환 방지).
      membershipLimit: async (_user, org) => resolveSeatLimit(org.id),
      organizationHooks: {
        // org 삭제 직전 Stripe 구독 취소 (FK cascade로 org_billing 지워지기 전).
        beforeDeleteOrganization: async ({ organization: o }) => {
          await runOrgDeleting(o.id);
        },
        // 멤버십/역할 변경 → entitlement epoch bump (기존 JWT stale화).
        afterAddMember: async ({ organization: o }) => {
          bus.emit('org.membership.changed', { orgId: o.id });
        },
        afterRemoveMember: async ({ organization: o }) => {
          bus.emit('org.membership.changed', { orgId: o.id });
        },
        afterUpdateMemberRole: async ({ organization: o }) => {
          bus.emit('org.membership.changed', { orgId: o.id });
        },
        // 초대수락도 멤버십 증가 — better-auth accept 경로는 afterAddMember를 안 쏘고
        // afterAcceptInvitation만 쏜다. 이걸 놓치면 초대로 늘어난 멤버가 epoch를
        // 못 올려 revocation 사각(가장 흔한 가입 경로)이 생긴다.
        afterAcceptInvitation: async ({ organization: o }) => {
          bus.emit('org.membership.changed', { orgId: o.id });
        },
      },
      sendInvitationEmail: async (data) => {
        await sendInvitationEmail({
          to: data.email,
          inviter: data.inviter.user.name ?? data.inviter.user.email,
          org: data.organization.name,
          url: `${appBaseUrl()}/accept-invitation/${data.id}`,
        });
      },
    }),
    twoFactor(),
    multiSession(),
    // enableMetadata: 서비스 키에 { orgId } 를 실어 org-스코핑한다 (C1).
    // rateLimit: 기본 10회/일은 제품 API의 usage/epoch 대량 호출을 막는다 → 서비스 키에
    // 맞게 상향(분당 6만 = 1000/s). DoS 방어는 API 게이트웨이/인프라 계층이 담당.
    apiKey({
      enableMetadata: true,
      rateLimit: { enabled: true, maxRequests: 60_000, timeWindow: 60_000 },
    }),
    admin(),
    jwt({
      jwt: {
        // ⚠️ 엔타이틀먼트 staleness: plan/role/features가 이 토큰에 박히고 제품 API는
        // JWKS 로컬검증만 하므로, 발급 후 다운그레이드/제거가 만료 전까지 반영 안 됨.
        // 기본 15m → 5m로 단축해 돈 새는 창을 줄인다. 완전 해소하려면 org/user
        // "entitlement epoch" 클레임 + 변경 시 bump + 제품측 stale-epoch 거부 필요(후속).
        expirationTime: '5m',
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
