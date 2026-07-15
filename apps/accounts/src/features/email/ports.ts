// hex 포트 — 배송 채널 추상화.
export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}
