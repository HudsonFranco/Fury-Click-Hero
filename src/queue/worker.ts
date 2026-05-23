import { Worker, Job } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import { redisConnection } from '../config/queue';
import { db } from '../config/database';
import { adTakedowns } from '../db/schema';
import { logger } from '../logger';

type TakedownJobData = {
  jobId: string;
};

async function setJobProcessing(jobId: string) {
  await db.update(adTakedowns)
    .set({
      status: 'PROCESSING',
      attempts: sql`${adTakedowns.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(adTakedowns.jobId, jobId));
}

async function failJob(jobId: string, errorMessage: string) {
  await db.update(adTakedowns)
    .set({
      status: 'FAILED',
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(adTakedowns.jobId, jobId));
}

async function completeJob(jobId: string, payload: unknown) {
  await db.update(adTakedowns)
    .set({
      status: 'COMPLETED',
      result: payload,
      updatedAt: new Date(),
    })
    .where(eq(adTakedowns.jobId, jobId));
}

async function fetchExternalData(): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch('https://jsonplaceholder.typicode.com/posts/1', {
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function processTakedown(job: Job<TakedownJobData>) {
  const { jobId } = job.data;
  const [, tenantId, adId] = jobId.split(':');
  
  logger.info({ tenantId, adId, jobId }, 'Starting takedown job');

  await setJobProcessing(jobId);

  const response = await fetchExternalData();

  if (response.status >= 500) {
    logger.error({ tenantId, adId, jobId, status: response.status }, 'External API 5xx error');
    throw new Error(`HTTP 5xx error: ${response.status}`);
  }

  if (response.status >= 400 && response.status < 500) {
    logger.warn({ tenantId, adId, jobId, status: response.status }, 'External API 4xx error');
    await failJob(jobId, `HTTP Error: ${response.status}`);
    return;
  }

  const payload = await response.json();
  await completeJob(jobId, payload);
  
  logger.info({ tenantId, adId, jobId }, 'Takedown completed');
}

const workerRedisConnection = redisConnection.duplicate();

const worker = new Worker<TakedownJobData>(
  'takedownQueue',
  processTakedown,
  {
    connection: workerRedisConnection,
  }
);

worker.on('failed', async (job: Job<TakedownJobData> | undefined, err: Error) => {
  if (job) {
    const { jobId } = job.data;
    const [, tenantId, adId] = jobId.split(':');
    logger.error({ tenantId, adId, jobId, err: err.message }, 'Job failed');
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      await failJob(jobId, err.message);
    }
  } else {
    logger.error({ err: err.message }, 'Job failed (Unknown Job)');
  }
});

export { worker, workerRedisConnection };
