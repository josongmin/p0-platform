// domain 매트릭스 → better-auth access control 객체로 파생.
// better-auth org 플러그인의 자체 엔드포인트(invite-member 등)도 이 역할 정의로 검사한다.
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/organization/access';
import { ORG_ROLES, PERMISSION_MATRIX, RESOURCES } from '../domain/roles';

const statement = {
  ...defaultStatements,
  billing: RESOURCES.billing,
  workspace: RESOURCES.workspace,
} as const;

export const ac = createAccessControl(statement);

type StatementKey = keyof typeof statement;

function toAcRole(role: (typeof ORG_ROLES)[number]) {
  const grants: Partial<Record<StatementKey, string[]>> = {};
  for (const [resource, actions] of Object.entries(PERMISSION_MATRIX[role])) {
    const allowed = statement[resource as StatementKey] as
      | readonly string[]
      | undefined;
    if (!allowed || !actions) continue;
    // statement에 존재하는 액션만 통과 (better-auth 기본 statement와의 드리프트 방지)
    grants[resource as StatementKey] = (actions as readonly string[]).filter(
      (a) => allowed.includes(a),
    );
  }
  return ac.newRole(grants as never);
}

export const orgRoles = Object.fromEntries(
  ORG_ROLES.map((r) => [r, toAcRole(r)]),
) as Record<(typeof ORG_ROLES)[number], ReturnType<typeof toAcRole>>;
