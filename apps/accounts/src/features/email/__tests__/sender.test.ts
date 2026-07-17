// 채널 선택 분기 — 모듈 로드시 1회 평가라 프로덕션 코드로는 양쪽 못 타므로 순수 분리.
import { describe, expect, test } from 'bun:test';
import { pickSender } from '../service';
import type { EmailSender } from '../ports';

const resend: EmailSender = { send: async () => {} };
const fallback: EmailSender = { send: async () => {} };

describe('pickSender', () => {
  test('Resend 키 있으면 resend sender', () => {
    expect(pickSender(true, resend, fallback)).toBe(resend);
  });
  test('키 없으면 콘솔 폴백', () => {
    expect(pickSender(false, resend, fallback)).toBe(fallback);
  });
});
