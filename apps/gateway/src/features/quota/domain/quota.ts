// domain — 서버측 쿼터 결정. 순수. (auditor H2: 돈-경로 쿼터는 JWT 스냅샷이 아니라
// 요청시점에 서버측에서 강제해야 한다. 여기가 그 판정.)
export type QuotaDecision =
  | { allow: true; remaining: number }
  | { allow: false; reason: 'quota-exceeded'; limit: number; used: number };

/**
 * 이번 요청(requested)을 허용할지: 이미 쓴 양(used) + 요청량이 한도(limit) 이하인가.
 * limit는 JWT 클레임의 aiTokensPerMonth지만, used는 서버가 추적하는 라이브 값이라
 * 토큰이 stale해도(에폭으로 별도 차단) 과금 초과는 막힌다.
 */
export function decideQuota(
  used: number,
  requested: number,
  limit: number,
): QuotaDecision {
  if (requested <= 0) return { allow: true, remaining: Math.max(0, limit - used) };
  if (used + requested > limit) {
    return { allow: false, reason: 'quota-exceeded', limit, used };
  }
  return { allow: true, remaining: limit - used - requested };
}
