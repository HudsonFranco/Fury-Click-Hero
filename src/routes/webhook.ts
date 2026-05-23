import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../config/database';
import { adTakedowns } from '../db/schema';
import { takedownQueue } from '../config/queue';
import { logger } from '../logger';

export const webhookRoutes = Router();

const violationSchema = z.object({
  adId: z.string().min(1).max(255),
  tenantId: z.string().min(1).max(255),
  violationType: z.enum(['PROHIBITED_TERM', 'BRAND_VIOLATION', 'COMPLIANCE_FAIL']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  detectedAt: z.string().datetime(),
});

webhookRoutes.post('/webhook/violation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = violationSchema.parse(req.body);
    const jobId = `takedown:${data.tenantId}:${data.adId}`;

    logger.info({ tenantId: data.tenantId, adId: data.adId, jobId }, 'Received webhook violation');

    await db.insert(adTakedowns)
      .values({
        jobId,
        adId: data.adId,
        tenantId: data.tenantId,
        violationType: data.violationType,
        severity: data.severity,
        status: 'PENDING',
        attempts: 0,
      })
      .onConflictDoNothing();

    const [job] = await db
      .select()
      .from(adTakedowns)
      .where(eq(adTakedowns.jobId, jobId))
      .limit(1);

    if (job.status === 'PROCESSING' || job.status === 'COMPLETED') {
      res.status(200).json({ message: 'Job already in progress or completed', jobId });
      return;
    }

    if (job.status === 'FAILED') {
      const updated = await db.update(adTakedowns)
        .set({
          status: 'PENDING',
          attempts: 0,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(adTakedowns.jobId, jobId),
            eq(adTakedowns.status, 'FAILED')
          )
        )
        .returning({ updatedId: adTakedowns.jobId });

      if (updated.length === 0) {
        res.status(200).json({ message: 'Job already in progress or completed', jobId });
        return;
      }
    }

    await takedownQueue.add('processViolation', { jobId }, { jobId });

    res.status(200).json({ message: 'Job accepted', jobId });
  } catch (error) {
    next(error);
  }
});

webhookRoutes.get('/jobs/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const [job] = await db
      .select()
      .from(adTakedowns)
      .where(eq(adTakedowns.jobId, id))
      .limit(1);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.status(200).json({
      jobId: job.jobId,
      status: job.status,
      attempts: job.attempts,
      result: job.result || {},
      error: job.errorMessage,
    });
  } catch (error) {
    next(error);
  }
});

webhookRoutes.get('/status', (req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});
