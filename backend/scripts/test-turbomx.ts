/**
 * TurboMX live send test — exercises the direct port-25 delivery path end-to-end.
 * Run: npx tsx scripts/test-turbomx.ts
 */
import { promises as dns } from 'node:dns';
import nodemailer from 'nodemailer';

// ── Config ────────────────────────────────────────────────────────────────────
const FROM_NAME  = 'LeadForge TurboMX Test';
const FROM_EMAIL = 'test@leadforge.ai';
const TO_EMAIL   = 'gurkaandrei469@gmail.com';
const HELO_HOST  = 'leadforge.ai';

const DKIM_OPTIONS = {
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
// ─────────────────────────────────────────────────────────────────────────────

const BOLD  = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const CYAN  = '\x1b[36m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

function log(icon: string, msg: string, detail = '') {
  console.log(`${icon}  ${msg}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}

async function resolveMxHosts(domain: string): Promise<string[]> {
  log('🔍', `Resolving MX records for ${BOLD}${domain}${RESET}`);
  const records = await dns.resolveMx(domain);
  const sorted = records.sort((a, b) => a.priority - b.priority);
  for (const r of sorted) log('   ', `${CYAN}${r.exchange}${RESET}`, `priority ${r.priority}`);
  return sorted.map((r) => r.exchange);
}

async function sendViaTurboMx(mxHosts: string[]): Promise<void> {
  const subject = `TurboMX test — ${new Date().toISOString()}`;
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <h2 style="color:#6366f1;margin:0 0 12px">LeadForge TurboMX ✓</h2>
      <p>This email was delivered <strong>directly to your MX server on port 25</strong> — no relay, no third-party SMTP service.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px">
        <tr><td style="padding:6px 10px;background:#f8f8ff;font-weight:600;width:40%">From</td><td style="padding:6px 10px">${FROM_EMAIL}</td></tr>
        <tr><td style="padding:6px 10px;background:#f8f8ff;font-weight:600">To</td><td style="padding:6px 10px">${TO_EMAIL}</td></tr>
        <tr><td style="padding:6px 10px;background:#f8f8ff;font-weight:600">EHLO hostname</td><td style="padding:6px 10px;font-family:monospace">${HELO_HOST}</td></tr>
        <tr><td style="padding:6px 10px;background:#f8f8ff;font-weight:600">MX hosts tried</td><td style="padding:6px 10px;font-family:monospace">${mxHosts.join('<br>')}</td></tr>
        <tr><td style="padding:6px 10px;background:#f8f8ff;font-weight:600">Sent at</td><td style="padding:6px 10px">${new Date().toUTCString()}</td></tr>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#94a3b8">Sent by LeadForge AI — TurboMX direct delivery engine</p>
    </div>
  `;

  let lastError = '';

  for (const mxHost of mxHosts) {
    log('📡', `Trying MX host ${BOLD}${mxHost}${RESET} on port 25…`);
    try {
      const transport = nodemailer.createTransport({
        host: mxHost,
        port: 25,
        secure: false,
        name: HELO_HOST,
        connectionTimeout: 12_000,
        greetingTimeout: 12_000,
        socketTimeout: 30_000,
        tls: { rejectUnauthorized: false },
        debug: true,
        logger: {
          level() {},
          trace(...args: any[]) { process.stdout.write(`${DIM}    [smtp] ${args.join(' ')}${RESET}\n`); },
          debug(...args: any[]) { process.stdout.write(`${DIM}    [smtp] ${args.join(' ')}${RESET}\n`); },
          info(...args: any[])  { process.stdout.write(`${DIM}    [smtp] ${args.join(' ')}${RESET}\n`); },
          warn(...args: any[])  { process.stdout.write(`${DIM}    [smtp] ${args.join(' ')}${RESET}\n`); },
          error(...args: any[]) { process.stdout.write(`${DIM}    [smtp] ${args.join(' ')}${RESET}\n`); },
        } as any,
      });

      const info = await transport.sendMail({
        from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
        to: TO_EMAIL,
        subject,
        html,
        text: `TurboMX test sent at ${new Date().toUTCString()}. No relay used — direct port 25 to ${mxHost}.`,
        dkim: DKIM_OPTIONS,
      });

      console.log();
      log('✅', `${GREEN}${BOLD}Delivered!${RESET}`);
      log('   ', `Provider message ID : ${info.messageId}`);
      log('   ', `Accepted by         : ${mxHost}`);
      log('   ', `Envelope response   : ${info.response}`);
      console.log();
      console.log(`${GREEN}Check ${TO_EMAIL} — the email should arrive shortly.${RESET}`);
      console.log(`${DIM}Note: without SPF/DKIM on ${HELO_HOST} it may land in spam.${RESET}`);
      return;
    } catch (err: any) {
      lastError = err.message ?? String(err);
      log('⚠️ ', `${RED}${mxHost} failed:${RESET} ${lastError.slice(0, 120)}`);
    }
  }

  console.log();
  log('❌', `${RED}${BOLD}All MX hosts failed.${RESET}`);
  log('   ', lastError);
  process.exit(1);
}

async function main() {
  console.log();
  console.log(`${BOLD}━━━ LeadForge TurboMX Send Test ━━━${RESET}`);
  console.log(`${DIM}From : ${FROM_EMAIL}${RESET}`);
  console.log(`${DIM}To   : ${TO_EMAIL}${RESET}`);
  console.log(`${DIM}EHLO : ${HELO_HOST}${RESET}`);
  console.log();

  const recipientDomain = TO_EMAIL.split('@')[1];
  const mxHosts = await resolveMxHosts(recipientDomain);
  console.log();

  await sendViaTurboMx(mxHosts);
}

main().catch((err) => {
  console.error(`${RED}Fatal:${RESET}`, err.message ?? err);
  process.exit(1);
});
