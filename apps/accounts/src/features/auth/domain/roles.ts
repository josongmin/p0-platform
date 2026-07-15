// domain — 권한 매트릭스의 SSOT. 순수 TS (외부 의존 0, lint 강제).
// better-auth AC 객체는 adapters/access-control.ts 가 이 매트릭스에서 파생한다.
export const ORG_ROLES = ['owner', 'admin', 'member', 'billing', 'guest'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const RESOURCES = {
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  billing: ['read', 'manage'],
  workspace: ['create', 'read', 'update', 'delete'],
  audit: ['read'],
} as const;
export type Resource = keyof typeof RESOURCES;
export type ActionOf<R extends Resource> = (typeof RESOURCES)[R][number];

type Grants = { [R in Resource]?: readonly ActionOf<R>[] };

const ALL: Grants = RESOURCES;

export const PERMISSION_MATRIX: Record<OrgRole, Grants> = {
  owner: ALL,
  admin: {
    organization: ['update'], // 삭제는 owner만
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
    team: ['create', 'update', 'delete'],
    billing: ['read'], // 결제 변경은 owner/billing만
    workspace: ['create', 'read', 'update', 'delete'],
    audit: ['read'],
  },
  member: {
    workspace: ['create', 'read'],
  },
  billing: {
    billing: ['read', 'manage'],
  },
  guest: {
    workspace: ['read'],
  },
};

export function can(role: OrgRole, resource: Resource, action: string): boolean {
  const actions = PERMISSION_MATRIX[role][resource] ?? [];
  return (actions as readonly string[]).includes(action);
}

export function isOrgRole(value: string | null | undefined): value is OrgRole {
  return typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value);
}
