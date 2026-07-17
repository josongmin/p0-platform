// extractKeyOrgId — 서비스 키 metadata에서 orgId 안전 추출. C1의 org 판정 근거.
import { describe, expect, test } from 'bun:test';
import { extractKeyOrgId } from '../domain/service-key';

describe('extractKeyOrgId', () => {
  test('object metadata에서 orgId 추출', () => {
    expect(extractKeyOrgId({ orgId: 'org_A' })).toBe('org_A');
  });
  test('JSON 문자열 metadata도 파싱해서 추출 (double-stringified 방어)', () => {
    expect(extractKeyOrgId(JSON.stringify({ orgId: 'org_B' }))).toBe('org_B');
  });
  test('orgId 없으면 null', () => {
    expect(extractKeyOrgId({ foo: 'bar' })).toBeNull();
    expect(extractKeyOrgId({})).toBeNull();
  });
  test('orgId가 문자열이 아니면 null (숫자/객체 주입 방어)', () => {
    expect(extractKeyOrgId({ orgId: 123 })).toBeNull();
    expect(extractKeyOrgId({ orgId: { nested: 1 } })).toBeNull();
  });
  test('★빈 문자열 orgId는 null — 빈문자 키가 빈문자 org에 사고매칭되는 것 차단', () => {
    expect(extractKeyOrgId({ orgId: '' })).toBeNull();
  });
  test('null/undefined/깨진 JSON → null', () => {
    expect(extractKeyOrgId(null)).toBeNull();
    expect(extractKeyOrgId(undefined)).toBeNull();
    expect(extractKeyOrgId('{not json')).toBeNull();
    expect(extractKeyOrgId('plain-string')).toBeNull();
  });
});
