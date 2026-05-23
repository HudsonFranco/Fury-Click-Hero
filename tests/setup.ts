import { beforeEach, afterAll } from 'vitest';
import { db, pool } from '../src/config/database';
import { takedownQueue, redisConnection } from '../src/config/queue';
import { worker, workerRedisConnection } from '../src/queue/worker';
import { sql } from 'drizzle-orm';

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE ad_takedowns CASCADE`);
  await takedownQueue.obliterate({ force: true });
});

afterAll(async () => {
  await worker.close();
  await takedownQueue.close();
  await workerRedisConnection.quit();
  await redisConnection.quit();
  await pool.end();
});
