import pino from 'pino';
import { env } from '../config/env';

// In AWS, pino's JSON output is ingested directly by CloudWatch Logs.
export const logger = pino({
  level: env.nodeEnv === 'production' ? 'info' : 'debug',
  base: { service: 'pic2map-api' },
});
