// driven adapter — accounts의 서비스키 epoch 엔드포인트 조회 + 짧은 TTL 캐시.
// (revocation 지연 = 캐시 TTL. 프로덕션은 change-feed로 대체 권장 — README 한계.)
import { env } from '../../../lib/env';

type CacheEntry = { epoch: number; at: number };
const cache = new Map<string, CacheEntry>();

/** now는 테스트 주입용 (Date.now 기본). */
export async function fetchCurrentEpoch(
  orgId: string,
  now: () => number = Date.now,
): Promise<number> {
  const hit = cache.get(orgId);
  if (hit && now() - hit.at < env.EPOCH_CACHE_TTL_MS) return hit.epoch;

  const res = await fetch(`${env.ACCOUNTS_URL}/v1/service/entitlements/${orgId}/epoch`, {
    headers: { 'x-api-key': env.GATEWAY_SERVICE_KEY ?? '' },
  });
  if (!res.ok) throw new Error(`epoch fetch failed: ${res.status}`);
  const body = (await res.json()) as { epoch: number };
  cache.set(orgId, { epoch: body.epoch, at: now() });
  return body.epoch;
}
