// 늦은 바인딩 레지스트리 — auth 어댑터(better-auth)가 billing/entitlements를 직접
// import하면 순환(auth→entitlements→billing→auth)이 되므로, composition root(app.ts)에서
// 구현을 주입한다. setClaimsBuilder와 같은 패턴.
//
// 기본값은 fail-CLOSED(throw): 미주입은 부팅 배선 버그이며, 조용히 통과(무제한 시트/
// 취소 스킵)하면 과금 사고가 된다. 프로덕션은 index.ts→app.ts가, 테스트는 test-preload가
// app을 import해 반드시 주입한다.
function unwired(name: string): never {
  throw new Error(
    `[auth/hooks] ${name} not wired — composition root(app.ts)를 import해야 한다`,
  );
}

// 시트 한도: org의 plan 기반 최대 멤버수.
let seatLimitResolver: (orgId: string) => Promise<number> = () => unwired('seatLimitResolver');
export function setSeatLimitResolver(fn: (orgId: string) => Promise<number>): void {
  seatLimitResolver = fn;
}
export function resolveSeatLimit(orgId: string): Promise<number> {
  return seatLimitResolver(orgId);
}

// org 삭제 직전 훅: Stripe 구독 취소 등.
let orgDeletingHandler: (orgId: string) => Promise<void> = () => unwired('orgDeletingHandler');
export function setOrgDeletingHandler(fn: (orgId: string) => Promise<void>): void {
  orgDeletingHandler = fn;
}
export function runOrgDeleting(orgId: string): Promise<void> {
  return orgDeletingHandler(orgId);
}

// 사용자 삭제 직전 훅: 단독소유 org의 구독취소+삭제 (고아 org·유령 구독 방지).
let userDeletingHandler: (userId: string) => Promise<void> = () => unwired('userDeletingHandler');
export function setUserDeletingHandler(fn: (userId: string) => Promise<void>): void {
  userDeletingHandler = fn;
}
export function runUserDeleting(userId: string): Promise<void> {
  return userDeletingHandler(userId);
}
