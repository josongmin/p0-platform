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
  // fail-CLOSED (H4): 미배선 시 빈 클레임({})으로 토큰을 발급하면 plan/role/epoch가
  // undefined인 토큰이 나가 제품 API 권한검사가 fail-open될 수 있다. seat/org/user
  // 훅과 동일하게 배선 버그를 크게 터뜨린다 (프로덕션은 index.ts→app.ts가, 테스트는
  // test-preload가 반드시 주입).
  if (!builder) {
    throw new Error('[auth/claims] claimsBuilder not wired — import composition root(app.ts)');
  }
  return builder(input);
}
