// verifyServiceKey의 metadata→orgId 추출은 테넌트 격리 경계 — 오염 입력 fail-closed 검증.
import { describe, expect, test } from 'bun:test';
import { extractKeyOrgId } from '../domain/service-key';

describe('extractKeyOrgId — fail-closed', () => {
  test('정상 문자열 orgId 추출', () => {
    expect(extractKeyOrgId({ orgId: 'org_A' })).toBe('org_A');
  });
  test('metadata 없음/null → null', () => {
    expect(extractKeyOrgId(undefined)).toBeNull();
    expect(extractKeyOrgId(null)).toBeNull();
  });
  test('orgId 없는 metadata → null', () => {
    expect(extractKeyOrgId({})).toBeNull();
    expect(extractKeyOrgId({ other: 'x' })).toBeNull();
  });
  test('★비-문자열 orgId(숫자/객체/배열/불리언) → null (타입 혼동 매칭 방지)', () => {
    expect(extractKeyOrgId({ orgId: 123 })).toBeNull();
    expect(extractKeyOrgId({ orgId: { toString: () => 'org_A' } })).toBeNull();
    expect(extractKeyOrgId({ orgId: ['org_A'] })).toBeNull();
    expect(extractKeyOrgId({ orgId: true })).toBeNull();
    expect(extractKeyOrgId({ orgId: null })).toBeNull();
  });
  test('빈 문자열 orgId → null (사고성 매칭 방지)', () => {
    expect(extractKeyOrgId({ orgId: '' })).toBeNull();
  });
  test('원시값/문자열 metadata 자체 → null', () => {
    expect(extractKeyOrgId('org_A')).toBeNull();
    expect(extractKeyOrgId(42)).toBeNull();
  });
});
