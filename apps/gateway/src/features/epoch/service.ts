import { isEntitlementStale } from '@p0/contracts';
import { fetchCurrentEpoch } from './adapters/epoch-client';

/**
 * 토큰의 epoch가 accounts의 현재 epoch보다 낮으면 stale(=권한 변경 후 미갱신).
 * revocation의 실제 소비 지점 — 이게 있어야 5분 staleness가 캐시 TTL(기본 10s)로 줄어든다.
 * epoch 조회 실패 시 fail-closed(stale 취급)로 안전측.
 */
export async function isTokenStale(orgId: string, tokenEpoch: number): Promise<boolean> {
  try {
    const current = await fetchCurrentEpoch(orgId);
    return isEntitlementStale(tokenEpoch, current);
  } catch {
    return true; // accounts 조회 불가 → 안전하게 stale 취급
  }
}
