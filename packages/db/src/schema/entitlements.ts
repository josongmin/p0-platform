import { bigint, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization } from './auth';

// 소유: features/entitlements — org의 엔타이틀먼트 epoch.
// plan/role/membership 변경 시 증가. JWT 클레임에 실려, 제품 API가 stale 토큰을
// (JWKS 로컬검증만으로) 거부/재발급하게 한다 (5분 staleness 창 무력화).
export const orgEpoch = pgTable('org_epoch', {
  orgId: text('org_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  epoch: bigint('epoch', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
