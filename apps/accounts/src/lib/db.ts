import { createDb } from '@p0/db';
import { env } from './env';

export const db = createDb(env.DATABASE_URL);
