import { app } from './app';
import { env } from './lib/env';

// 최후 안전망 — 어떤 비동기 거부/예외도 프로세스를 조용히 죽이지 못하게.
process.on('unhandledRejection', (reason) => {
  console.error('[accounts] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[accounts] uncaughtException:', err);
});

console.log(`[accounts] listening on :${env.PORT}`);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
