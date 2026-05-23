import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';
import { db } from '../src/config/database';
import { adTakedowns } from '../src/db/schema';
import { takedownQueue } from '../src/config/queue';
import { worker } from '../src/queue/worker';
import { eq } from 'drizzle-orm';

describe('POST /webhook/violation', () => {
  it('accepts a valid webhook and enqueues it', async () => {
    // Pause worker so we can inspect the raw initial state before processing
    await worker.pause();

    const payload = {
      adId: 'ad_4409',
      tenantId: 'tenant_zcorp',
      violationType: 'BRAND_VIOLATION',
      severity: 'HIGH',
      detectedAt: new Date().toISOString(),
    };
    const expectedJobId = `takedown:${payload.tenantId}:${payload.adId}`;

    const res = await request(app).post('/webhook/violation').send(payload);

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe(expectedJobId);

    const [dbJob] = await db
      .select()
      .from(adTakedowns)
      .where(eq(adTakedowns.jobId, expectedJobId));

    expect(dbJob).toBeDefined();
    expect(dbJob.jobId).toBe(expectedJobId);
    expect(dbJob.status).toBe('PENDING');

    const bullJob = await takedownQueue.getJob(expectedJobId);
    expect(bullJob).toBeDefined();
    expect(bullJob?.id).toBe(expectedJobId);
    expect(bullJob?.data.jobId).toBe(expectedJobId);

    await worker.resume();
  });

  it('returns 400 for invalid payload', async () => {
    const res = await request(app).post('/webhook/violation').send({ adId: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation Error');
    expect(Array.isArray(res.body.details)).toBe(true);
  });
});
