import { z } from 'zod';
import { defineEnv, loadEnv } from '@forinda/kickjs-config';

const envSchema = defineEnv((base) =>
  base.extend({
    MONGODB_URI: z.string().url(),
    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    RESEND_API_KEY: z.string().min(1),
    MAIL_FROM_NAME: z.string().default('Vibed'),
    MAIL_FROM_EMAIL: z.string().email(),
    APP_URL: z.string().url(),
    APP_NAME: z.string().default('Vibed'),
  }),
);

const _env = loadEnv(envSchema);

export const env = _env as {
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  LOG_LEVEL: string;
  MONGODB_URI: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_EXPIRES_IN: string;
  JWT_REFRESH_EXPIRES_IN: string;
  RESEND_API_KEY: string;
  MAIL_FROM_NAME: string;
  MAIL_FROM_EMAIL: string;
  APP_URL: string;
  APP_NAME: string;
};

export type Env = typeof env;
