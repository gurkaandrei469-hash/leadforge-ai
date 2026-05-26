import net from 'node:net';
import { env } from '../config/env.js';

interface SmtpResult {
  deliverable: boolean | null;
  isCatchAll: boolean | null;
  smtpCode?: number;
  reason?: string;
}

const PROBE_RANDOM_LOCAL = () => `probe-${Math.random().toString(36).slice(2, 14)}`;

export async function smtpVerify(email: string, mxHosts: string[]): Promise<SmtpResult> {
  if (mxHosts.length === 0) return { deliverable: false, isCatchAll: null, reason: 'no_mx' };
  const [domain] = email.split('@').slice(-1);

  for (const host of mxHosts) {
    const result = await probe(host, email, env.SMTP_VERIFY_FROM, env.SMTP_VERIFY_TIMEOUT_MS);
    if (result.deliverable !== null) {
      // Catch-all detection: probe a random localpart
      const random = `${PROBE_RANDOM_LOCAL()}@${domain}`;
      const catchAll = await probe(host, random, env.SMTP_VERIFY_FROM, env.SMTP_VERIFY_TIMEOUT_MS);
      const isCatchAll = catchAll.deliverable === true;
      return { ...result, isCatchAll };
    }
  }
  return { deliverable: null, isCatchAll: null, reason: 'all_mx_failed' };
}

function probe(host: string, rcpt: string, mailFrom: string, timeoutMs: number): Promise<SmtpResult> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: 25 });
    socket.setTimeout(timeoutMs);
    const lines: string[] = [];
    let stage = 0;
    let lastCode = 0;

    const send = (cmd: string) => socket.write(`${cmd}\r\n`);
    const finish = (result: SmtpResult) => { socket.destroy(); resolve(result); };

    socket.on('data', (buf) => {
      const text = buf.toString();
      lines.push(text);
      lastCode = parseInt(text.slice(0, 3)) || lastCode;

      if (stage === 0 && lastCode === 220) { send(`HELO leadforge.ai`); stage = 1; }
      else if (stage === 1 && lastCode === 250) { send(`MAIL FROM:<${mailFrom}>`); stage = 2; }
      else if (stage === 2 && lastCode === 250) { send(`RCPT TO:<${rcpt}>`); stage = 3; }
      else if (stage === 3) {
        send('QUIT');
        if (lastCode === 250) return finish({ deliverable: true, isCatchAll: null, smtpCode: lastCode });
        if (lastCode === 550 || lastCode === 553 || lastCode === 554)
          return finish({ deliverable: false, isCatchAll: null, smtpCode: lastCode, reason: 'rcpt_rejected' });
        return finish({ deliverable: null, isCatchAll: null, smtpCode: lastCode, reason: 'inconclusive' });
      }
    });

    socket.on('timeout', () => finish({ deliverable: null, isCatchAll: null, reason: 'timeout' }));
    socket.on('error', () => finish({ deliverable: null, isCatchAll: null, reason: 'socket_error' }));
  });
}
