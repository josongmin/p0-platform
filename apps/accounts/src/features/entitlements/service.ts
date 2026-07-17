import type { EntitlementClaims, PlanId } from '@p0/contracts';
import { bus } from '../../lib/events';
import { bumpEpoch, readEpoch } from './adapters/epoch-repo';
import { planReader, roleReader } from './adapters/readers';
import { computeEntitlements, maxSeatsForPlan, PLAN_TABLE } from './domain/policy';

/** org의 현재 엔타이틀먼트 epoch (제품 API의 stale 판정 기준). */
export function currentEpoch(orgId: string): Promise<number> {
  return readEpoch(orgId);
}

/** plan/role/membership 변경 시 epoch 증가 → 기존 JWT를 stale로 만든다. */
export function bumpOrgEpoch(orgId: string): Promise<number> {
  return bumpEpoch(orgId);
}

// bump은 revocation 무결성이라 fire-and-forget이라도 최선을 다한다: 짧은 backoff로
// 재시도해 일시적 DB 오류로 stale 토큰이 살아남는 확률을 낮춘다. 최종 실패는 로깅
// (하드 backstop은 JWT 5분 만료 — 완전 무결성은 mutation-tx 동기 bump가 후속 과제).
async function bumpReliable(orgId: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await bumpEpoch(orgId);
      return;
    } catch (e) {
      if (attempt === 3) {
        console.error(`[entitlements] epoch bump FAILED for ${orgId} after 3 tries:`, e);
        return;
      }
      await new Promise((r) => setTimeout(r, attempt * 50));
    }
  }
}

/** 엔타이틀먼트 무효화 트리거 구독 — 구독변경·멤버십변경 시 epoch bump. */
export function registerEpochSubscriptions(): void {
  bus.on('billing.subscription.updated', (p) => {
    void bumpReliable(p.orgId);
  });
  bus.on('org.membership.changed', (p) => {
    void bumpReliable(p.orgId);
  });
  bus.on('entitlements.invalidate', (p) => {
    void bumpReliable(p.orgId);
  });
}

/** org의 시트 한도 — 현재 plan 기준. 시트 강제(membershipLimit)에서 사용. */
export async function seatLimitForOrg(orgId: string): Promise<number> {
  return maxSeatsForPlan(await planReader.planOf(orgId));
}

// 컴파일 타임 드리프트 가드 — domain은 contracts를 import 못 하므로(순수 규칙)
// 정합을 여기서 강제한다. contracts에 plan 추가 + PLAN_TABLE 미갱신 = 컴파일 에러.
const _PLAN_COVERAGE: Record<PlanId, keyof typeof PLAN_TABLE> = {
  free: 'free',
  team: 'team',
  business: 'business',
  enterprise: 'enterprise',
};
void _PLAN_COVERAGE;

/** JWT definePayload에서 호출 — org 없는 세션은 free/member 취급 */
export async function buildClaims(input: {
  userId: string;
  orgId: string | null;
}): Promise<EntitlementClaims> {
  if (!input.orgId) {
    return { org: null, epoch: 0, ...computeEntitlements('free', 'member') };
  }
  const [plan, role, epoch] = await Promise.all([
    planReader.planOf(input.orgId),
    roleReader.roleOf(input.userId, input.orgId),
    readEpoch(input.orgId),
  ]);
  return { org: input.orgId, epoch, ...computeEntitlements(plan, role ?? 'member') };
}
