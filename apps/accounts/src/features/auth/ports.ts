// hex 포트 — auth 도메인이 바깥에 요구하는 것.

/** member 테이블에서 역할 조회 (auth feature가 테이블 소유) */
export interface MemberRoleReader {
  roleOf(userId: string, orgId: string): Promise<string | null>;
}

/**
 * JWT 클레임 빌더 — entitlements 같은 타 feature가 제공.
 * composition root(app.ts)에서 setClaimsBuilder로 주입 (feature 간 순환 import 차단).
 */
export type ClaimsBuilder = (input: {
  userId: string;
  orgId: string | null;
}) => Promise<Record<string, unknown>>;
