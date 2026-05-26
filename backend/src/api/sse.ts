import type { Request, Response } from 'express';
import { redisSub } from '../db/redis.js';

export function jobProgressSSE(req: Request, res: Response) {
  const { jobId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const channel = `job:${jobId}:progress`;
  const handler = (ch: string, msg: string) => {
    if (ch === channel) res.write(`data: ${msg}\n\n`);
  };
  redisSub.subscribe(channel);
  redisSub.on('message', handler);

  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);

  req.on('close', () => {
    clearInterval(ping);
    redisSub.off('message', handler);
    redisSub.unsubscribe(channel);
    res.end();
  });
}
