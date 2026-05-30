import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { promises as dns } from 'node:dns';
import { createTransport } from 'nodemailer';
import https from 'node:https';

const r = Router();

// Note: real admin requires platform-level role beyond team role; placeholder gate.
r.get('/teams', authenticate, requireRole('OWNER'), async (_req, res, next) => {
  try {
    const teams = await prisma.team.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { _count: { select: { memberships: true, leads: true } } },
    });
    res.json({ teams });
  } catch (e) { next(e); }
});

r.get('/jobs', authenticate, requireRole('OWNER'), async (_req, res, next) => {
  try {
    const jobs = await prisma.extractionJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ jobs });
  } catch (e) { next(e); }
});

r.get('/audit', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    const rows = await prisma.auditLog.findMany({
      where: { teamId: req.auth!.teamId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ logs: rows });
  } catch (e) { next(e); }
});

// Temporary TurboMX live test — secret-gated, no Clerk needed
// DELETE this endpoint after the test
r.get('/turbomx-test', async (req, res) => {
  if (req.query.secret !== 'lf-turbomx-2026') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const log: string[] = [];
  const out = (msg: string) => { log.push(msg); console.log('[turbomx-test]', msg); };

  try {
    // Get public IP
    const publicIp: string = await new Promise((resolve, reject) => {
      https.get('https://api.ipify.org', (r) => {
        let d = '';
        r.on('data', (c: string) => d += c);
        r.on('end', () => resolve(d.trim()));
      }).on('error', reject);
    });
    out(`Public IP: ${publicIp}`);

    // PTR record
    try {
      const ptr = await dns.reverse(publicIp);
      out(`PTR record: ${ptr[0]}`);
    } catch {
      out(`PTR record: none`);
    }

    // MX lookup
    const mxRecords = await dns.resolveMx('gmail.com');
    const mxHosts = mxRecords.sort((a, b) => a.priority - b.priority).map(r => r.exchange);
    out(`MX hosts: ${mxHosts.slice(0, 3).join(', ')}`);

    const HELO = `${process.env.FLY_APP_NAME || process.env.RAILWAY_SERVICE_NAME || 'leadforge'}.railway.app`;
    out(`EHLO hostname: ${HELO}`);

    const DKIM = {
      domainName: 'leadforge.ai',
      keySelector: 'mail',
      privateKey: `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCzL99Vw8ujyFuD
yhPoSLMeiBxJcrXehZu7u6JxGzAPuPvALNTHqS2hYn9h9hFsLP3P4R3pxWwz9e9k
qnwnUow0NUxDmu+/XEzJSE7o1m7Pe5+Tzpje+T8jiis6trwD7ZzWNFn574zk9xIY
nk06Nf8ciUxa9kF5jdj+SQulTdjw2qYg2s1IujXIliItQh19GIrot6uMF3Xjtf2C
K4TPOwGa7rkQh+xNGjseifN4194FBWs9+mpEHMjUUng7L15OuTp8vRCtUxdJM6US
nFDehRoRMFNqtI5Pjrem5AgyiWjeYv5tZ3NTOY72k8ZJgOPZgTp9s+qEq3YfEUNz
YhfECUxZAgMBAAECggEACkCJRllEfnjJMPolN3C+vCwiH4WuUtlRdrqelFrE3jFs
SKuH+msl5DTu1YZZqtchfSeufss/4fKGoZDWN6hpGIJFfHIR7jX0DWl+B6O1MAPX
toI8jDgLMm0GWilNtT/UGGFjFddsjUZ275enEtc3YxpBQcxoefGcDQ3VhRNg1S7k
uY9t2n7UA+Nqa6F3AhuXYsJJA3W4IvFH/rShaz7Vjew1QDe5gsPovLjkaXJEAQko
+LYoXIW7i/aEeZDtHlklQgVJYtHsXbFYzLdfj8nsUMwWBShPrsqajgbA37hE+4Fu
OBwO8ucqUXCBgx0kGTyHAoRuc7J7Ktfj7CvnSw4s8QKBgQDwcMkvJR/2bDwB57FS
RQSW3yH86ViJOrP5g8H5aeZsCYDr8k+uEr+DSO+HRhq1u+PUkS32Mrk2dAlbQ+z0
RHTvIy/pHRlaC+WFnmnEXIeAeV0d6qAt25sTDsyXp5F8z2yeWo0oadZASE9yL0/V
k1xcZvQqzZKfSZrVpxc5nDZHnQKBgQC+yFc0dUF1RSH2R+ULVWTvwgMGbdpIq15w
OtBPKjwFDSHwOgf4VCfSE4d02IEdaOO7pF6Y+tRsAT7dd2zslONOQF35G54Ku4P6
rF/FnkSYs6z3SYehzkHKpbPKfnb5qPryEng56hXqnrCimK3d18XFAcgr2bdDkfWu
uJ54XR0A7QKBgB/ldmrwq9rO5O8Dw3w8d61kEGgytHIP/YweNH9X0x+F6zphvLxE
9G8AH/Z8EFMHh+PNFqHQfM2CezNGQYruAe0vZ82u9IwDhAFD0JgiBj++2eF8HJ+4
wEu47N85dY1vHuOq84rm72s7rH5jVF3q3JfNeJqtBsRmyUmKjwQveuvpAoGBALj+
0TjH3pJVWApVSq9Dvd2TNpW8XecLbUbMcQPiw1JumpMz4liVWgul7jqKWiDnfbSN
PUGAMA0O5COiU1fRQ9y0I6uTcRudGuwuy6t3vbKIv9cGUOPAeiGDriRTnxCWH8gt
yrD14QyhlkwEWsv8GAThpnWG5uM5nI8w7FFwkNg9AoGASD+uWybKQI/OofrXf+HV
DyyOOUQx0Y8IgrmTuROFj00J+RwKgoErZgOmMlBq1qkIPopXAiZWlwlGc3ncqPjT
NA2XIh51Um9VeRUQmBUyrVDex3qIQAey0DKtFr4aSa2ysXFIeCdWzlapPdS1fTmS
mMoqfiiHfRsHF2ik8wxtj0s=
-----END PRIVATE KEY-----`,
    };

    let delivered = false;
    let lastError = '';

    for (const mxHost of mxHosts) {
      out(`Trying ${mxHost}:25 ...`);
      try {
        const t = createTransport({
          host: mxHost, port: 25, secure: false, name: HELO,
          connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
          tls: { rejectUnauthorized: false },
        });
        const info = await t.sendMail({
          from: '"LeadForge TurboMX" <test@leadforge.ai>',
          to: 'gurkaandrei469@gmail.com',
          subject: `TurboMX from Railway — ${new Date().toISOString()}`,
          html: `<div style="font-family:sans-serif;padding:24px"><h2 style="color:#6366f1">LeadForge TurboMX ✓</h2><p>Delivered directly on port 25 from Railway server IP <strong>${publicIp}</strong>.<br>EHLO: <code>${HELO}</code><br>MX: <code>${mxHost}</code><br>DKIM: rsa-sha256 · leadforge.ai</p></div>`,
          text: `TurboMX delivered from Railway ${publicIp} via ${mxHost} at ${new Date().toUTCString()}`,
          dkim: DKIM,
        });
        out(`✅ DELIVERED via ${mxHost} — ${info.messageId}`);
        out(`Response: ${info.response}`);
        delivered = true;
        break;
      } catch (e: any) {
        lastError = (e.message ?? String(e)).slice(0, 300);
        out(`❌ ${mxHost}: ${lastError}`);
      }
    }

    return res.json({ ok: delivered, publicIp, log, lastError: delivered ? null : lastError });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message, log });
  }
});

export default r;
