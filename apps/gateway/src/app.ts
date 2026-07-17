import { Hono } from 'hono';
import { inferRoutes } from './features/infer';

export const app = new Hono();

app.onError((err, c) => {
  console.error('[gateway]', err);
  return c.json({ error: 'internal error' }, 500);
});

app.get('/health', (c) => c.json({ ok: true, service: 'gateway' }));
app.route('/', inferRoutes);
