import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { errorHandler, notFound } from './middleware/error';

import authRoutes from './routes/auth';
import photoRoutes from './routes/photos';
import albumRoutes from './routes/albums';
import mapRoutes from './routes/map';
import searchRoutes from './routes/search';
import moderationRoutes from './routes/moderation';
import adminRoutes from './routes/admin';
import transferRoutes from './routes/transfer';

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin.split(','), credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(pinoHttp({ logger }));
  app.use(rateLimit({ windowMs: 60_000, max: 300 }));

  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  app.use('/api/auth', authRoutes);
  app.use('/api/photos', photoRoutes);
  app.use('/api/albums', albumRoutes);
  app.use('/api/map', mapRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/moderation', moderationRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/transfer', transferRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
