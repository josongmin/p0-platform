// 유스케이스 — 템플릿(domain) × 채널(port). 키 유무로 어댑터 선택.
import { env } from '../../lib/env';
import { consoleSender } from './adapters/console';
import { resendSender } from './adapters/resend';
import {
  dunningEmail,
  invitationEmail,
  resetPasswordEmail,
  verificationEmail,
} from './domain/templates';
import type { EmailSender } from './ports';

// 채널 선택 — Resend 키 있으면 실제 발송, 없으면 콘솔 폴백(dev). 순수라 단위테스트 가능.
export function pickSender(
  hasResendKey: boolean,
  resend: EmailSender,
  fallback: EmailSender,
): EmailSender {
  return hasResendKey ? resend : fallback;
}

const sender: EmailSender = pickSender(
  Boolean(env.RESEND_API_KEY),
  resendSender,
  consoleSender,
);

export async function sendVerificationEmail(i: {
  to: string;
  name: string;
  url: string;
}): Promise<void> {
  await sender.send({ to: i.to, ...verificationEmail(i) });
}

export async function sendResetPasswordEmail(i: {
  to: string;
  name: string;
  url: string;
}): Promise<void> {
  await sender.send({ to: i.to, ...resetPasswordEmail(i) });
}

export async function sendInvitationEmail(i: {
  to: string;
  inviter: string;
  org: string;
  url: string;
}): Promise<void> {
  await sender.send({ to: i.to, ...invitationEmail(i) });
}

export async function sendDunningEmail(i: {
  to: string;
  amountLabel: string;
  attemptCount: number;
  portalUrl: string;
}): Promise<void> {
  await sender.send({ to: i.to, ...dunningEmail(i) });
}
