import { pgTable, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const adTakedowns = pgTable('ad_takedowns', {
  jobId: text('job_id').primaryKey(),
  adId: text('ad_id').notNull(),
  tenantId: text('tenant_id').notNull(),
  violationType: text('violation_type').notNull(),
  severity: text('severity').notNull(),
  status: text('status').$type<'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'>().notNull().default('PENDING'),
  attempts: integer('attempts').default(0).notNull(),
  result: jsonb('result'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
