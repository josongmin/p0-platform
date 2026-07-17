// domain — 서비스 키 metadata에서 org 스코프 추출. 순수 (fail-closed).
// better-auth가 metadata를 객체 또는 (double-)stringified JSON으로 돌려줄 수 있어
// 양쪽을 방어한다. orgId가 비어있지 않은 문자열일 때만 org로 인정 — 그 외
// (없음/숫자/객체/배열/빈문자열/파싱실패)는 전부 null → keyAllowsOrg에서 거부되어
// 크로스 테넌트로 절대 못 샌다.
export function extractKeyOrgId(metadata: unknown): string | null {
  let meta = metadata;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      return null;
    }
  }
  if (meta && typeof meta === 'object' && 'orgId' in meta) {
    const orgId = (meta as { orgId?: unknown }).orgId;
    return typeof orgId === 'string' && orgId.length > 0 ? orgId : null;
  }
  return null;
}
