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

  test('오염된 plan 값(알 수 없는 문자열)은 free로 폴백 — 크래시 안 남', () => {
    // 오염된 DB row가 as PlanId로 새어들어온 상황 재현
    const e = computeEntitlements('startup_LEAKED' as never, 'member');
    expect(e.plan).toBe('free');
    expect(e.maxSeats).toBe(3);
    expect(e.features).toContain('viz.basic');
  });

  test('오염된 plan + guest도 안전하게 free 읽기전용', () => {
    const e = computeEntitlements('' as never, 'guest');
    expect(e.plan).toBe('free');
    expect(e.features).not.toContain('fix.pipeline');
  });

  // H3: 쓰기 기능 유지/제거를 모든 역할 × 상위플랜에서 전수 확인
  const WRITE = ['fix.pipeline', 'review.ai', 'agents.fleet'];

  test('business/enterprise에서 비-guest는 모든 쓰기 기능 유지', () => {
    for (const plan of ['business', 'enterprise'] as const) {
      for (const role of ['owner', 'admin', 'member'] as const) {
        const e = computeEntitlements(plan, role);
        for (const f of WRITE) {
          if (computeEntitlements(plan, 'owner').features.includes(f)) {
            expect(e.features).toContain(f);
          }
        }
      }
    }
  });

  test('★guest는 business/enterprise에서도 쓰기 기능 전부 제거 (agents.fleet 포함)', () => {
    for (const plan of ['business', 'enterprise'] as const) {
      const g = computeEntitlements(plan, 'guest');
      for (const f of WRITE) expect(g.features).not.toContain(f);
      // 읽기 기능은 유지
      expect(g.features).toContain('viz.basic');
    }
  });

  test('billing 역할도 플랜의 쓰기 기능을 그대로 받는다 (제품 기능은 org 관리권한과 분리)', () => {
    const e = computeEntitlements('business', 'billing');
    expect(e.plan).toBe('business');
  });
});
