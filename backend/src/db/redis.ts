import IORedis from 'ioredis';
import { env } from '../config/env.js';

export const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const redisPub = new IORedis(env.REDIS_URL);
export const redisSub = new IORedis(env.REDIS_URL);
