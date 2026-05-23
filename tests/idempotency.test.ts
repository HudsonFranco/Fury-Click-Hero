import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';
import { db } from '../src/config/database';
import { adTakedowns } from '../src/db/schema';
import { takedownQueue } from '../src/config/queue';
import { worker } from '../src/queue/worker';
import { eq } from 'drizzle-orm';

describe('POST /webhook/violation — concurrent idempotency', () => {
  it('handles concurrent identical webhooks safely', async () => {
    await worker.pause();

    const payload = {
      adId: 'ad_dupe_test',
      tenantId: 'tenant_dupe_test',
      violationType: 'BRAND_VIOLATION',
      severity: 'HIGH',
      detectedAt: new Date().toISOString(),
    };
    const expectedJobId = `takedown:${payload.tenantId}:${payload.adId}`;
    const TOTAL = 20;

    const start = Date.now();
    const responses = await Promise.all(
      Array.from({ length: TOTAL }).map(() =>
        request(app).post('/webhook/violation').send(payload)
      )
    );
    const elapsed = Date.now() - start;

    responses.forEach(res => expect(res.status).toBe(200));

    const records = await db
      .select()
      .from(adTakedowns)
      .where(eq(adTakedowns.jobId, expectedJobId));

    expect(records.length).toBe(1);
    expect(records[0].status).toBe('PENDING');

    const waiting = await takedownQueue.getWaiting();
    expect(waiting.filter(j => j.id === expectedJobId).length).toBe(1);

    await worker.resume();
  });
});
