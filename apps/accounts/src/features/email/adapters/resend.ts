// driven adapter — Resend REST API. SDK 없이 fetch (의존성 0 추가).
import { env } from '../../../lib/env';
import type { EmailSender } from '../ports';

export const resendSender: EmailSender = {
  send: async (email) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });
    if (!res.ok) {
      throw new Error(`resend failed: ${res.status} ${await res.text()}`);
    }
  },
};
