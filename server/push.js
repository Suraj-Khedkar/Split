/**
 * Web Push, implemented against the RFCs rather than a dependency.
 *
 * Three specs stack up here:
 *   RFC 8030  the push service protocol (POST to an opaque endpoint)
 *   RFC 8291  message encryption — ECDH P-256 to a key the browser gave us
 *   RFC 8292  VAPID — an ES256 JWT proving who is sending
 *
 * Node 24 has every primitive these need (hkdfSync, createECDH, ieee-p1363
 * ECDSA), so this stays in keeping with a server whose only dependency is `ws`
 * — which matters for something reachable from the public internet via Funnel.
 * The encryption is exercised against the RFC 8291 test vector in
 * server/__tests__/push.test.js; getting it subtly wrong would otherwise show
 * up only as notifications that silently never arrive.
 */
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign as signWith,
} from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (str) => Buffer.from(str, 'base64url');

/* ------------------------------ VAPID keys ------------------------------ */

/**
 * The server's identity to push services, generated once and kept in the DB.
 *
 * Persisted rather than read from the environment because a key that changes
 * on restart invalidates every subscription already handed out — the browser
 * binds each one to the applicationServerKey it was created with.
 */
export function vapidKeys(db) {
  const read = () =>
    db.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'vapid_%'").all();

  const rows = Object.fromEntries(read().map((r) => [r.key, r.value]));
  if (rows.vapid_public && rows.vapid_private) {
    return { publicKey: rows.vapid_public, privateKey: rows.vapid_private };
  }

  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const publicKey = b64url(ecdh.getPublicKey());

  // Left-pad to 32 bytes. Node strips leading zero bytes from the raw scalar,
  // so roughly one key in 256 comes back short — and a short `d` makes the JWK
  // import throw, which would only ever bite on some later restart.
  const raw = ecdh.getPrivateKey();
  const privateKey = b64url(
    raw.length === 32 ? raw : Buffer.concat([Buffer.alloc(32 - raw.length), raw])
  );

  const insert = db.prepare(
    'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)'
  );
  insert.run('vapid_public', publicKey);
  insert.run('vapid_private', privateKey);

  // Re-read: another process may have won the insert, and both sides must use
  // the same pair or half the subscriptions stop verifying.
  const after = Object.fromEntries(read().map((r) => [r.key, r.value]));
  return { publicKey: after.vapid_public, privateKey: after.vapid_private };
}

/** Raw P-256 scalar + point as a signing key, via JWK. */
function signingKey(publicKeyB64, privateKeyB64) {
  const pub = fromB64url(publicKeyB64);
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      // Strip the 0x04 uncompressed-point marker, then split x and y.
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
      d: privateKeyB64,
    },
    format: 'jwk',
  });
}

/**
 * The `Authorization: vapid` header value for one push endpoint.
 *
 * The audience is the endpoint's origin, not its full URL — push services
 * reject a token scoped any tighter than that.
 */
export function vapidHeader(endpoint, keys, subject) {
  const audience = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(
    JSON.stringify({
      aud: audience,
      // 12 hours. The spec caps this at 24; shorter limits the damage if a
      // token leaks out of a log somewhere.
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: subject,
    })
  );
  const data = Buffer.from(`${header}.${payload}`);
  // ieee-p1363 is the raw r||s form JWS wants; Node's default DER would be
  // rejected as a malformed signature.
  const signature = signWith('sha256', data, {
    key: signingKey(keys.publicKey, keys.privateKey),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${header}.${payload}.${b64url(signature)}, k=${keys.publicKey}`;
}

/* ---------------------------- payload encryption ---------------------------- */

/** Single-record aes128gcm body, per RFC 8291 §3 and RFC 8188 §2. */
export function encryptPayload(plaintext, p256dhB64, authB64, testOverrides = {}) {
  const uaPublic = fromB64url(p256dhB64);
  const authSecret = fromB64url(authB64);

  const ecdh = createECDH('prime256v1');
  if (testOverrides.serverPrivate) {
    ecdh.setPrivateKey(fromB64url(testOverrides.serverPrivate));
  } else {
    ecdh.generateKeys();
  }
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);
  const salt = testOverrides.salt ? fromB64url(testOverrides.salt) : randomBytes(16);

  // The auth secret is the salt for the first derivation, binding the result
  // to this specific subscription and not merely to the key exchange.
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    uaPublic,
    asPublic,
  ]);
  const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));

  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)
  );

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02 is the delimiter marking this as the last record. Using 0x01 here
  // makes the browser wait for a continuation that never comes.
  const body = Buffer.concat([Buffer.from(plaintext, 'utf8'), Buffer.from([0x02])]);
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);

  return Buffer.concat([
    salt,
    recordSize,
    Buffer.from([asPublic.length]),
    asPublic,
    ciphertext,
  ]);
}

/* -------------------------------- sending -------------------------------- */

/**
 * Deliver one notification.
 *
 * Returns 'sent', 'gone' when the subscription is dead and should be deleted,
 * or 'failed' for anything transient. Never throws: a push service being down
 * must not take an expense-creation request with it.
 */
export async function sendPush(subscription, payloadObject, keys, subject) {
  let response;
  try {
    response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        TTL: '86400',
        Urgency: 'normal',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: vapidHeader(subscription.endpoint, keys, subject),
      },
      body: encryptPayload(
        JSON.stringify(payloadObject),
        subscription.p256dh,
        subscription.auth
      ),
    });
  } catch (err) {
    console.error('push send failed:', err?.message ?? err);
    return 'failed';
  }

  // 404 means the endpoint never existed, 410 that the browser dropped it —
  // both are permanent, and retrying them forever is how the table fills with
  // subscriptions that can never receive anything.
  if (response.status === 404 || response.status === 410) return 'gone';
  if (!response.ok) {
    console.error(`push rejected (${response.status}) by ${new URL(subscription.endpoint).host}`);
    return 'failed';
  }
  return 'sent';
}
