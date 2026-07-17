// RED → email/domain/templates.ts 가 구현 대상. 템플릿은 순수 함수 — 렌더만 검증.
import { describe, expect, test } from 'bun:test';
import {
  dunningEmail,
  invitationEmail,
  resetPasswordEmail,
  verificationEmail,
} from '../domain/templates';

describe('email templates (pure)', () => {
  test('verification — url이 html/text 양쪽에 들어간다', () => {
    const e = verificationEmail({ name: '송민', url: 'https://x.p0/verify?t=abc' });
    expect(e.subject.length).toBeGreaterThan(0);
    expect(e.html).toContain('https://x.p0/verify?t=abc');
    expect(e.text).toContain('https://x.p0/verify?t=abc');
    expect(e.html).toContain('송민');
  });

  test('reset password — url 포함', () => {
    const e = resetPasswordEmail({ name: 'a', url: 'https://x.p0/reset?t=1' });
    expect(e.html).toContain('https://x.p0/reset?t=1');
    expect(e.text).toContain('https://x.p0/reset?t=1');
  });

  test('invitation — 초대자·org명·수락 url 포함', () => {
    const e = invitationEmail({
      inviter: 'Jo',
      org: 'p0 HQ',
      url: 'https://x.p0/accept/inv_1',
    });
    expect(e.subject).toContain('p0 HQ');
    expect(e.html).toContain('Jo');
    expect(e.html).toContain('https://x.p0/accept/inv_1');
  });

  test('html 이스케이프 — 이름에 태그 주입 불가', () => {
    const e = verificationEmail({ name: '<script>x</script>', url: 'https://u' });
    expect(e.html).not.toContain('<script>');
  });

  test('dunning — 금액·포탈url 포함, 재시도 회차 표기', () => {
    const e = dunningEmail({ amountLabel: '29.00 USD', attemptCount: 2, portalUrl: 'https://x.p0/billing' });
    expect(e.subject).toContain('결제 실패');
    expect(e.html).toContain('29.00 USD');
    expect(e.html).toContain('https://x.p0/billing');
    expect(e.text).toContain('재시도 2회차');
  });

  test('dunning — 1회차는 재시도 문구 없음', () => {
    const e = dunningEmail({ amountLabel: '10.00 USD', attemptCount: 1, portalUrl: 'https://u' });
    expect(e.text).not.toContain('재시도');
  });
});
