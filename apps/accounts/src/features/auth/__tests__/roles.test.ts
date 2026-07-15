// RED → domain/roles.ts 가 구현 대상.
// 권한 매트릭스는 순수 도메인 — DB도 better-auth도 없이 검증된다.
import { describe, expect, test } from 'bun:test';
import { can, isOrgRole, ORG_ROLES } from '../domain/roles';

describe('permission matrix — can(role, resource, action)', () => {
  test('owner는 전부 가능', () => {
    expect(can('owner', 'organization', 'delete')).toBe(true);
    expect(can('owner', 'billing', 'manage')).toBe(true);
    expect(can('owner', 'member', 'delete')).toBe(true);
    expect(can('owner', 'workspace', 'delete')).toBe(true);
  });

  test('admin — org 설정만(삭제 불가), 멤버 관리 가능, billing은 읽기만', () => {
    expect(can('admin', 'organization', 'update')).toBe(true);
    expect(can('admin', 'organization', 'delete')).toBe(false);
    expect(can('admin', 'member', 'create')).toBe(true);
    expect(can('admin', 'billing', 'read')).toBe(true);
    expect(can('admin', 'billing', 'manage')).toBe(false);
  });

  test('member — 워크스페이스 생성/읽기만, org·billing 관리 불가', () => {
    expect(can('member', 'workspace', 'create')).toBe(true);
    expect(can('member', 'workspace', 'read')).toBe(true);
    expect(can('member', 'workspace', 'delete')).toBe(false);
    expect(can('member', 'member', 'create')).toBe(false);
    expect(can('member', 'billing', 'read')).toBe(false);
  });

  test('billing 역할 — billing read+manage만', () => {
    expect(can('billing', 'billing', 'read')).toBe(true);
    expect(can('billing', 'billing', 'manage')).toBe(true);
    expect(can('billing', 'member', 'create')).toBe(false);
    expect(can('billing', 'workspace', 'create')).toBe(false);
  });

  test('guest — 읽기만', () => {
    expect(can('guest', 'workspace', 'read')).toBe(true);
    expect(can('guest', 'workspace', 'create')).toBe(false);
    expect(can('guest', 'billing', 'read')).toBe(false);
  });

  test('audit — owner/admin만 읽기', () => {
    expect(can('owner', 'audit', 'read')).toBe(true);
    expect(can('admin', 'audit', 'read')).toBe(true);
    expect(can('member', 'audit', 'read')).toBe(false);
    expect(can('billing', 'audit', 'read')).toBe(false);
    expect(can('guest', 'audit', 'read')).toBe(false);
  });

  test('isOrgRole 가드', () => {
    expect(isOrgRole('owner')).toBe(true);
    expect(isOrgRole('superuser')).toBe(false);
    expect(isOrgRole(null)).toBe(false);
    expect(ORG_ROLES).toHaveLength(5);
  });
});
