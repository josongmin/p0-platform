import { describe, expect, test } from 'bun:test';
import { computeEntitlements } from '../domain/policy';

describe('computeEntitlements', () => {
  test('free 플랜 기본 한도', () => {
    const e = computeEntitlements('free', 'member');
    expect(e.maxSeats).toBe(3);
    expect(e.features).toContain('viz.basic');
    expect(e.features).not.toContain('fix.pipeline');
  });

  test('guest는 쓰기성 기능이 제거된다', () => {
    const member = computeEntitlements('team', 'member');
    const guest = computeEntitlements('team', 'guest');
    expect(member.features).toContain('fix.pipeline');
    expect(guest.features).not.toContain('fix.pipeline');
    expect(guest.features).toContain('overlays');
  });

  test('enterprise에만 sso.saml/scim', () => {
    expect(computeEntitlements('business', 'admin').features).not.toContain('sso.saml');
    const ent = computeEntitlements('enterprise', 'admin');
    expect(ent.features).toContain('sso.saml');
    expect(ent.features).toContain('scim');
  });

  test('plan/role이 결과에 그대로 실린다', () => {
    const e = computeEntitlements('team', 'owner');
    expect(e.plan).toBe('team');
    expect(e.role).toBe('owner');
  });
});
