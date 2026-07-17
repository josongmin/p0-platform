import { app } from './app';
import { env } from './lib/env';

process.on('unhandledRejection', (r) => console.error('[gateway] unhandledRejection:', r));

console.log(`[gateway] listening on :${env.PORT} → accounts ${env.ACCOUNTS_URL}`);

export default { port: env.PORT, fetch: app.fetch };
