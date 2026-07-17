// domain — 서비스 키가 특정 org에 사용량을 기록할 수 있는지. 순수.
// keyOrgId = 키 metadata.orgId. 스코프 없는 키(null)는 거부(fail-closed) —
// "전역 키"는 명시적 별도 매커니즘으로만 허용해야지, 스코프 누락을 프리패스로
// 해석하면 안 된다 (R2: null=allow 였던 크로스 테넌트 홀 차단).
export function keyAllowsOrg(keyOrgId: string | null, orgId: string): boolean {
  return keyOrgId !== null && keyOrgId === orgId;
}
