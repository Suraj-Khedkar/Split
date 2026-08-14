/**
 * Outbound email, behind a provider switch — same shape as ocr.js.
 *
 *   MAIL_PROVIDER=log     (default) writes the message to the server log and
 *                         returns success. Nothing is sent. This is the right
 *                         default for a self-hosted box: the feature works from
 *                         the first boot with nothing configured, and you can
 *                         always fish a verification link out of the log rather
 *                         than being locked out by a mail misconfiguration.
 *   MAIL_PROVIDER=smtp    a real SMTP server over implicit TLS (port 465).
 *                         MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, MAIL_FROM.
 *                         Works with a Gmail app password.
 *   MAIL_PROVIDER=resend  Resend's HTTP API. RESEND_API_KEY, MAIL_FROM.
 *
 * Written against node:tls directly rather than pulling in nodemailer, for the
 * same reason the rest of the server has no dependencies: this is exposed to
 * the public internet through Funnel, and every package is another thing to
 * keep patched.
 *
 * A word on deliverability, because it is the part that actually bites: mail
 * sent straight from a home connection is very often dropped or binned by the
 * receiving side, regardless of how correct this code is. Residential IP
 * ranges carry poor reputation and there is no SPF or DKIM record pointing at
 * one. Use a relay — an app password on an existing mailbox is the least
 * effort — rather than trying to send directly.
 */
import { connect } from 'node:tls';

const PROVIDER = (process.env.MAIL_PROVIDER ?? 'log').toLowerCase();
const FROM = process.env.MAIL_FROM ?? 'Split & Track <no-reply@localhost>';

function logMail({ to, subject, text }) {
  console.log(
    `\n--- email (MAIL_PROVIDER=log, nothing sent) ---\nto: ${to}\nsubject: ${subject}\n\n${text}\n--- end ---\n`
  );
}

/**
 * Minimal SMTP conversation over implicit TLS.
 *
 * Implicit TLS (465) rather than STARTTLS (587) on purpose: the connection is
 * encrypted from the first byte, so there is no plaintext negotiation to get
 * wrong and no chance of leaking credentials to a downgrade.
 */
function smtpSend({ to, subject, text, html }) {
  const host = process.env.MAIL_HOST;
  const port = Number(process.env.MAIL_PORT ?? 465);
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;
  if (!host || !user || !pass) {
    throw new Error('MAIL_HOST, MAIL_USER and MAIL_PASS are required for MAIL_PROVIDER=smtp');
  }

  return new Promise((resolve, reject) => {
    const socket = connect({ host, port, servername: host });
    let buffer = '';
    // Each step waits for the code it expects, then sends the next line.
    const steps = [
      { expect: 220, line: `EHLO localhost` },
      { expect: 250, line: 'AUTH LOGIN' },
      { expect: 334, line: Buffer.from(user).toString('base64') },
      { expect: 334, line: Buffer.from(pass).toString('base64') },
      { expect: 235, line: `MAIL FROM:<${user}>` },
      { expect: 250, line: `RCPT TO:<${to}>` },
      { expect: 250, line: 'DATA' },
      { expect: 354, line: body() },
      { expect: 250, line: 'QUIT' },
    ];
    let step = 0;

    function body() {
      // Dot-stuffing: a line that is just "." would end the message early.
      const stuff = (s) => s.replace(/\r?\n\./g, '\n..');
      const headers = [
        `From: ${FROM}`,
        `To: <${to}>`,
        `Subject: ${subject}`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
      ];

      if (!html) {
        return [...headers, 'Content-Type: text/plain; charset=utf-8', '', stuff(text), '.'].join(
          '\r\n'
        );
      }

      // multipart/alternative, plain part first. Order is significant: clients
      // render the LAST part they understand, so the rich version has to come
      // second or a capable client would show the fallback.
      const boundary = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      return [
        ...headers,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        stuff(text),
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        '',
        stuff(html),
        `--${boundary}--`,
        '.',
      ].join('\r\n');
    }

    const done = (err) => {
      socket.removeAllListeners();
      socket.end();
      err ? reject(err) : resolve();
    };

    socket.setTimeout(15000, () => done(new Error('SMTP timed out')));
    socket.on('error', done);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      // Responses can be multi-line; the last one has a space after the code.
      const lines = buffer.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || last[3] === '-') return;
      buffer = '';

      const code = Number(last.slice(0, 3));
      const current = steps[step];
      if (!current) return done();
      if (code !== current.expect) {
        return done(new Error(`SMTP ${current.line.split(' ')[0]} failed: ${last}`));
      }
      socket.write(`${current.line}\r\n`);
      step += 1;
      if (step >= steps.length) done();
    });
  });
}

async function resendSend({ to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is required for MAIL_PROVIDER=resend');
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, ...(html ? { html } : {}) }),
  });
  if (!resp.ok) throw new Error(`Resend rejected the message (${resp.status})`);
}

/** True when a real provider is configured AND usable, so callers can adjust
 *  their wording. A half-configured provider counts as not configured. */
export function mailConfigured() {
  return PROVIDER !== 'log' && providerReady();
}

/**
 * True when the selected provider has everything it needs to actually send.
 *
 * Half-configured is the dangerous state: MAIL_PROVIDER=smtp with no password
 * would throw, the caller would swallow it, and the user would get neither an
 * email nor a link in the log — locked out with nothing to go on.
 */
function providerReady() {
  if (PROVIDER === 'smtp') {
    return Boolean(process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS);
  }
  if (PROVIDER === 'resend') return Boolean(process.env.RESEND_API_KEY);
  return true;
}

export async function sendMail({ to, subject, text, html }) {
  if (!providerReady()) {
    console.warn(
      `MAIL_PROVIDER=${PROVIDER} is missing its credentials — falling back to the log so nobody is stranded.`
    );
    return logMail({ to, subject, text });
  }
  if (PROVIDER === 'smtp') return smtpSend({ to, subject, text, html });
  if (PROVIDER === 'resend') return resendSend({ to, subject, text, html });
  return logMail({ to, subject, text });
}
