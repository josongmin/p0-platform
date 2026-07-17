import { z } from 'zod';
import { planId } from './billing';

// JWT 클레임에 그대로 박히는 형태 — 제품 API들은 이걸 로컬 검증만으로 읽는다.
export const entitlementClaims = z.object({
  org: z.string().nullable(),
  plan: planId,
  role: z.enum(['owner', 'admin', 'member', 'billing', 'guest']),
  maxSeats: z.number().int(),
  aiTokensPerMonth: z.number().int(),
  scansPerMonth: z.number().int(),
  features: z.array(z.string()),
  // 엔타이틀먼트 버전 — plan/role/membership 변경 시 증가. 제품 API는 토큰의 epoch가
  // 현재 org epoch보다 낮으면 stale로 보고 거부/재발급한다 (5분 staleness 무력화).
  epoch: z.number().int(),
});
export type EntitlementClaims = z.infer<typeof entitlementClaims>;

/**
 * 제품 API용 순수 헬퍼 — 토큰 epoch가 현재 org epoch보다 낮으면 stale.
 * 사용: JWKS로 서명검증 후 isEntitlementStale(claims.epoch, cachedCurrentEpoch)면 재발급 유도.
 * tokenEpoch가 없거나(구버전 토큰=epoch 클레임 이전) 정수가 아니면 stale로 취급(fail-safe) —
 * `undefined < N === false`로 영구 fresh 판정되는 fail-open 구멍 차단.
 */
export function isEntitlementStale(
  tokenEpoch: number | undefined | null,
  currentEpoch: number,
): boolean {
  return !Number.isInteger(tokenEpoch) || (tokenEpoch as number) < currentEpoch;
}
