import { Hono } from 'hono';
import { auth } from './adapters/better-auth';

export const authRoutes = new Hono();

// better-auth가 /api/auth/* 전체를 소유 (sign-in/up, org, 2fa, jwks, api-key …)
authRoutes.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
