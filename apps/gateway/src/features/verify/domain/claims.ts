// domain — JWT payload에서 엔타이틀먼트 클레임을 안전 추출. 순수.
import { entitlementClaims, type EntitlementClaims } from '@p0/contracts';

/** payload → 검증된 클레임. 형식 불일치면 null (fail-closed). */
export function parseClaims(payload: Record<string, unknown>): EntitlementClaims | null {
  const r = entitlementClaims.safeParse(payload);
  return r.success ? r.data : null;
}
