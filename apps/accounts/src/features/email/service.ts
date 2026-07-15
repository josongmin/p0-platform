// 유스케이스 — 템플릿(domain) × 채널(port). 키 유무로 어댑터 선택.
import { env } from '../../lib/env';
import { consoleSender } from './adapters/console';
import { resendSender } from './adapters/resend';
import {
  invitationEmail,
  resetPasswordEmail,
  verificationEmail,
} from './domain/templates';
import type { EmailSender } from './ports';

const sender: EmailSender = env.RESEND_API_KEY ? resendSender : consoleSender;

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
