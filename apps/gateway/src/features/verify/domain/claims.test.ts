import { describe, expect, test } from 'bun:test';
import { parseClaims } from './claims';

const valid = {
  org: 'org_1',
  plan: 'team',
  role: 'owner',
  maxSeats: 25,
  aiTokensPerMonth: 1_000_000,
  scansPerMonth: 500,
  features: ['viz.basic', 'fix.pipeline'],
  epoch: 3,
};

describe('parseClaims (fail-closed)', () => {
  test('유효 payload → 클레임', () => {
    const c = parseClaims(valid);
    expect(c).not.toBeNull();
    expect(c?.epoch).toBe(3);
    expect(c?.org).toBe('org_1');
  });
  test('epoch 없는 payload → null (미배선 클레임 거부)', () => {
    const { epoch, ...noEpoch } = valid;
    void epoch;
    expect(parseClaims(noEpoch)).toBeNull();
  });
  test('빈 payload → null', () => {
    expect(parseClaims({})).toBeNull();
  });
  test('타입 오염(features 문자열) → null', () => {
    expect(parseClaims({ ...valid, features: 'nope' })).toBeNull();
  });
});
