// 권한 매트릭스 전수 — 모든 역할 × 리소스. 단일 기능만 확인하던 갭 메움 (H3).
import { describe, expect, test } from 'bun:test';
import { can, ORG_ROLES } from '../domain/roles';

describe('PERMISSION_MATRIX 전수 검증', () => {
  test('owner는 모든 리소스의 모든 액션 허용', () => {
    const checks: Array<[Parameters<typeof can>[1], string]> = [
      ['organization', 'delete'],
      ['member', 'delete'],
      ['billing', 'manage'],
      ['workspace', 'delete'],
      ['audit', 'read'],
      ['team', 'delete'],
    ];
    for (const [r, a] of checks) expect(can('owner', r, a)).toBe(true);
  });

  test('billing.manage는 owner·billing만 (admin/member/guest 불가)', () => {
    expect(can('owner', 'billing', 'manage')).toBe(true);
    expect(can('billing', 'billing', 'manage')).toBe(true);
    expect(can('admin', 'billing', 'manage')).toBe(false);
    expect(can('member', 'billing', 'manage')).toBe(false);
    expect(can('guest', 'billing', 'manage')).toBe(false);
  });

  test('audit.read는 owner·admin만', () => {
    expect(can('owner', 'audit', 'read')).toBe(true);
    expect(can('admin', 'audit', 'read')).toBe(true);
    for (const r of ['member', 'billing', 'guest'] as const) {
      expect(can(r, 'audit', 'read')).toBe(false);
    }
  });

  test('organization.delete는 owner만 (admin 불가)', () => {
    expect(can('owner', 'organization', 'delete')).toBe(true);
    expect(can('admin', 'organization', 'delete')).toBe(false);
  });

  test('member.create(초대급)는 owner·admin만', () => {
    expect(can('owner', 'member', 'create')).toBe(true);
    expect(can('admin', 'member', 'create')).toBe(true);
    for (const r of ['member', 'billing', 'guest'] as const) {
      expect(can(r, 'member', 'create')).toBe(false);
    }
  });

  test('알 수 없는 액션은 모든 역할에서 거부', () => {
    for (const r of ORG_ROLES) {
      expect(can(r, 'billing', 'nuke')).toBe(false);
      expect(can(r, 'workspace', 'teleport')).toBe(false);
    }
  });
});
