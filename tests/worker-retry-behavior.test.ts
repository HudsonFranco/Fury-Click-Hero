import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';
import { db } from '../src/config/database';
import { adTakedowns } from '../src/db/schema';
import { takedownQueue } from '../src/config/queue';
import { worker } from '../src/queue/worker';
import { eq } from 'drizzle-orm';

const waitForStatus = async (
  jobId: string,
  status: string,
  timeoutMs = 15000
): Promise<any> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [job] = await db.select().from(adTakedowns).where(eq(adTakedowns.jobId, jobId));
    if (job && job.status === status) return job;
    await new Promise(res => setTimeout(res, 500));
  }
  throw new Error(`Timeout waiting for status ${status}`);
};

describe('BullMQ retry & backoff', () => {
  beforeAll(async () => {
    await worker.pause();
  });

  afterAll(async () => {
    await worker.resume();
    vi.restoreAllMocks();
  });

  it('retries on 5xx errors until it fails', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 500 }));

    const payload = {
      adId: 'ad_error',
      tenantId: 'tenant_xyz',
      violationType: 'BRAND_VIOLATION',
      severity: 'HIGH',
      detectedAt: new Date().toISOString(),
    };
    const jobId = `takedown:${payload.tenantId}:${payload.adId}`;

    const res = await request(app).post('/webhook/violation').send(payload);
    expect(res.status).toBe(200);

    await worker.resume();
    const finalJob = await waitForStatus(jobId, 'FAILED');
    expect(finalJob.attempts).toBe(3);
    expect(finalJob.status).toBe('FAILED');
    await worker.pause();
  });

  it('aborts on timeout and triggers retry', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('AbortError'); });

    const payload = {
      adId: 'ad_slow',
      tenantId: 'tenant_xyz',
      violationType: 'BRAND_VIOLATION',
      severity: 'HIGH',
      detectedAt: new Date().toISOString(),
    };
    const jobId = `takedown:${payload.tenantId}:${payload.adId}`;

    const res = await request(app).post('/webhook/violation').send(payload);
    expect(res.status).toBe(200);

    await worker.resume();
    const finalJob = await waitForStatus(jobId, 'FAILED');
    expect(finalJob.attempts).toBe(3);
    expect(finalJob.status).toBe('FAILED');
    await worker.pause();
  });

  it('fails immediately on 4xx errors without retrying', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 400 }));

    const payload = {
      adId: 'ad_badreq',
      tenantId: 'tenant_xyz',
      violationType: 'BRAND_VIOLATION',
      severity: 'HIGH',
      detectedAt: new Date().toISOString(),
    };
    const jobId = `takedown:${payload.tenantId}:${payload.adId}`;

    const res = await request(app).post('/webhook/violation').send(payload);
    expect(res.status).toBe(200);

    await worker.resume();
    const finalJob = await waitForStatus(jobId, 'FAILED');
    expect(finalJob.attempts).toBe(1);
    expect(finalJob.status).toBe('FAILED');
    await worker.pause();
  });

  it('completes job and saves the payload', async () => {
    const mockPayload = { foo: 'bar' };
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(mockPayload), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const payload = {
      adId: 'ad_good',
      tenantId: 'tenant_xyz',
      violationType: 'BRAND_VIOLATION',
      severity: 'HIGH',
      detectedAt: new Date().toISOString(),
    };
    const jobId = `takedown:${payload.tenantId}:${payload.adId}`;

    const res = await request(app).post('/webhook/violation').send(payload);
    expect(res.status).toBe(200);

    await worker.resume();
    const finalJob = await waitForStatus(jobId, 'COMPLETED');
    expect(finalJob.attempts).toBe(1);
    expect(finalJob.status).toBe('COMPLETED');
    expect(finalJob.result).toEqual(mockPayload);
    await worker.pause();
  });
});
