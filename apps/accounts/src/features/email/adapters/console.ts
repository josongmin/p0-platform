// dev 폴백 — RESEND_API_KEY 없으면 콘솔로. 메일 계정 없이 전체 플로우 개발 가능.
import type { EmailSender } from '../ports';

export const consoleSender: EmailSender = {
  send: async (email) => {
    console.log(
      `\n📧 [email:console] to=${email.to}\n   subject: ${email.subject}\n   ${email.text.replaceAll('\n', '\n   ')}\n`,
    );
  },
};
