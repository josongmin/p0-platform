// domain — 이메일 템플릿은 순수 함수. 렌더 결과만 검증 가능.
export type EmailContent = { subject: string; html: string; text: string };

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function shell(title: string, body: string, ctaLabel: string, url: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:32px;background:#0b0b0f;font-family:-apple-system,Segoe UI,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#16161d;border:1px solid #2a2a35;border-radius:12px;padding:32px">
    <p style="color:#8b8b98;font-size:12px;letter-spacing:2px;margin:0 0 16px">P0</p>
    <h1 style="color:#f2f2f7;font-size:20px;margin:0 0 12px">${esc(title)}</h1>
    <div style="color:#b9b9c6;font-size:14px;line-height:1.6">${body}</div>
    <a href="${esc(url)}" style="display:inline-block;margin-top:24px;padding:12px 20px;background:#f2f2f7;color:#0b0b0f;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">${esc(ctaLabel)}</a>
    <p style="color:#5c5c68;font-size:12px;margin-top:24px">버튼이 안 되면 이 링크를 복사하세요:<br>${esc(url)}</p>
  </div>
</body></html>`;
}

export function verificationEmail(i: { name: string; url: string }): EmailContent {
  return {
    subject: 'p0 이메일 인증',
    html: shell(
      '이메일을 인증해주세요',
      `<p>${esc(i.name)}님, 아래 버튼을 눌러 가입을 완료하세요.</p>`,
      '이메일 인증',
      i.url,
    ),
    text: `${i.name}님, 아래 링크로 이메일을 인증하세요:\n${i.url}`,
  };
}

export function resetPasswordEmail(i: { name: string; url: string }): EmailContent {
  return {
    subject: 'p0 비밀번호 재설정',
    html: shell(
      '비밀번호 재설정',
      `<p>${esc(i.name)}님, 비밀번호 재설정 요청이 접수됐습니다. 본인이 아니라면 무시하세요.</p>`,
      '비밀번호 재설정',
      i.url,
    ),
    text: `${i.name}님, 아래 링크로 비밀번호를 재설정하세요:\n${i.url}`,
  };
}

export function invitationEmail(i: {
  inviter: string;
  org: string;
  url: string;
}): EmailContent {
  return {
    subject: `${i.org} 워크스페이스 초대`,
    html: shell(
      `${esc(i.org)}에 초대되었습니다`,
      `<p>${esc(i.inviter)}님이 <strong style="color:#f2f2f7">${esc(i.org)}</strong> 조직에 초대했습니다.</p>`,
      '초대 수락',
      i.url,
    ),
    text: `${i.inviter}님이 ${i.org} 조직에 초대했습니다. 수락:\n${i.url}`,
  };
}

// dunning — 결제 실패 알림. 재시도 회차를 알려 서비스 중단 전 결제수단 갱신 유도.
export function dunningEmail(i: {
  amountLabel: string;
  attemptCount: number;
  portalUrl: string;
}): EmailContent {
  const retry = i.attemptCount > 1 ? ` (재시도 ${String(i.attemptCount)}회차)` : '';
  return {
    subject: 'p0 결제 실패 — 결제수단을 업데이트해주세요',
    html: shell(
      '결제가 실패했습니다',
      `<p><strong style="color:#f2f2f7">${esc(i.amountLabel)}</strong> 청구가 실패했습니다${esc(retry)}. 서비스 중단을 막으려면 결제수단을 업데이트해주세요.</p>`,
      '결제수단 업데이트',
      i.portalUrl,
    ),
    text: `${i.amountLabel} 청구 실패${retry}. 결제수단 업데이트: ${i.portalUrl}`,
  };
}
