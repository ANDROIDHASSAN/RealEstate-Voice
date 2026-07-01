import pino from 'pino';

/** Structured logging. PII rule: log ids, never phone/email bodies. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['req.headers.authorization', '*.phone', '*.email', '*.passwordHash'],
});
