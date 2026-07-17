import type { Entitlements, OrgRole, PlanId } from './types';

// 플랜별 한도 SSOT — FE billing-stage 플랜 4종과 정렬. 숫자는 가격정책 확정 시 조정.
export const PLAN_TABLE: Record<PlanId, Omit<Entitlements, 'plan' | 'role'>> = {
  free: {
    maxSeats: 3,
    aiTokensPerMonth: 100_000,
    scansPerMonth: 10,
    features: ['viz.basic', 'search.dsl'],
  },
  team: {
    maxSeats: 25,
    aiTokensPerMonth: 2_000_000,
    scansPerMonth: 200,
    features: ['viz.basic', 'search.dsl', 'overlays', 'fix.pipeline', 'review.ai'],
  },
  business: {
    maxSeats: 100,
    aiTokensPerMonth: 10_000_000,
    scansPerMonth: 1_000,
    features: [
      'viz.basic',
      'search.dsl',
      'overlays',
      'fix.pipeline',
      'review.ai',
      'agents.fleet',
      'audit.export',
    ],
  },
  enterprise: {
    maxSeats: Number.MAX_SAFE_INTEGER,
    aiTokensPerMonth: Number.MAX_SAFE_INTEGER,
    scansPerMonth: Number.MAX_SAFE_INTEGER,
    features: [
      'viz.basic',
      'search.dsl',
      'overlays',
      'fix.pipeline',
      'review.ai',
      'agents.fleet',
      'audit.export',
      'sso.saml',
      'scim',
      'residency',
      'ai.byok',
    ],
  },
};

// 쓰기성 기능 — guest(읽기전용)에게는 제거된다.
const WRITE_FEATURES = new Set(['fix.pipeline', 'review.ai', 'agents.fleet']);

export function computeEntitlements(plan: PlanId, role: OrgRole): Entitlements {
  // 방어: 알 수 없는 plan 값(오염된 DB row 등)이 들어와도 free로 폴백해
  // undefined.features 크래시(→ JWT 발급 전체 실패)를 막는다.
  const base = PLAN_TABLE[plan] ?? PLAN_TABLE.free;
  const resolvedPlan: PlanId = PLAN_TABLE[plan] ? plan : 'free';
  const features =
    role === 'guest'
      ? base.features.filter((f) => !WRITE_FEATURES.has(f))
      : [...base.features];
  return { plan: resolvedPlan, role, ...base, features };
}

/** plan의 시트 한도 — 오염값은 free로 폴백(seat 강제에서 안전한 하한). */
export function maxSeatsForPlan(plan: string): number {
  return (PLAN_TABLE[plan as PlanId] ?? PLAN_TABLE.free).maxSeats;
}
