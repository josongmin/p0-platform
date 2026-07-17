// C1 핵심 로직 — 서비스 키 org 스코핑 결정. 순수, 목 없이.
import { describe, expect, test } from 'bun:test';
import { keyAllowsOrg } from '../domain/scope';

describe('keyAllowsOrg', () => {
  test('키 org과 대상 org이 같으면 허용', () => {
    expect(keyAllowsOrg('org_A', 'org_A')).toBe(true);
  });
  test('★키 org과 대상 org이 다르면 거부 (크로스 테넌트 위조 차단)', () => {
    expect(keyAllowsOrg('org_A', 'org_B')).toBe(false);
  });
  test('★스코프 없는 키(null)는 거부 — fail-closed (R2)', () => {
    expect(keyAllowsOrg(null, 'org_A')).toBe(false);
    expect(keyAllowsOrg(null, 'org_Z')).toBe(false);
    expect(keyAllowsOrg(null, '')).toBe(false);
  });
  test('빈 문자열 대상 org은 불일치로 거부', () => {
    expect(keyAllowsOrg('org_A', '')).toBe(false);
  });
  test('빈 문자열 키 org은 같은 빈 문자열만 매칭(사고성 매칭 경계 문서화)', () => {
    expect(keyAllowsOrg('', 'org_A')).toBe(false);
    expect(keyAllowsOrg('', '')).toBe(true);
  });
});
