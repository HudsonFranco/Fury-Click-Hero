import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from './config/database';
import { takedownQueue, redisConnection } from './config/queue';
import { worker, workerRedisConnection } from './queue/worker';
import { logger } from './logger';
import { webhookRoutes } from './routes/webhook';

export const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(webhookRoutes);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Validation Error', details: err.errors });
    return;
  }

  logger.error({ err }, 'Internal Server Error');
  res.status(500).json({ error: 'Internal Server Error' });
});

let server: ReturnType<typeof app.listen> | null = null;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    logger.info({ port: PORT }, 'Server is running');
  });
}

export async function shutdown() {
  logger.info('Shutting down gracefully...');

  const close = async (fn: () => Promise<void>) => {
    try { await fn(); } catch { /* already closed */ }
  };

  if (server) server.close();
  await close(() => worker.close());
  await close(() => takedownQueue.close());
  await close(async () => {
    if (redisConnection.status !== 'end' && redisConnection.status !== 'close') {
      await redisConnection.quit();
    }
  });
  await close(async () => {
    if (workerRedisConnection.status !== 'end' && workerRedisConnection.status !== 'close') {
      await workerRedisConnection.quit();
    }
  });
  await close(() => pool.end());

  logger.info('Shutdown complete');
  if (process.env.NODE_ENV !== 'test') {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export const setTestServer = (s: ReturnType<typeof app.listen>) => {
  server = s;
};
