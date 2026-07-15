import type { ClaimsBuilder } from './ports';

// 늦은 바인딩 레지스트리 — better-auth 어댑터가 entitlements를 직접 import하면
// 순환(auth→entitlements→auth)이 생기므로 composition root가 여기로 주입한다.
let builder: ClaimsBuilder | null = null;

export function setClaimsBuilder(fn: ClaimsBuilder): void {
  builder = fn;
}

export async function buildJwtClaims(input: {
  userId: string;
  orgId: string | null;
}): Promise<Record<string, unknown>> {
  return builder ? builder(input) : {};
}
