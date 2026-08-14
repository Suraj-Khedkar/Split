import assert from 'node:assert/strict';
import test from 'node:test';

import { encryptPayload, vapidHeader } from '../push.js';

/**
 * RFC 8291 §5, "Push Message Encryption Example".
 *
 * Verbatim from the spec. Nothing else here can tell us the encryption is
 * right: a push service accepts a malformed body just as happily as a correct
 * one, and the failure surfaces as a notification that never appears on a
 * phone we are not holding.
 */
const VECTOR = {
  plaintext: 'When I grow up, I want to be a watermelon',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  serverPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  expected:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('aes128gcm encryption matches the RFC 8291 test vector', () => {
  const body = encryptPayload(VECTOR.plaintext, VECTOR.uaPublic, VECTOR.authSecret, {
    serverPrivate: VECTOR.serverPrivate,
    salt: VECTOR.salt,
  });
  assert.equal(body.toString('base64url'), VECTOR.expected);
});

test('the body carries salt, record size and the server key in the header', () => {
  const body = encryptPayload('hi', VECTOR.uaPublic, VECTOR.authSecret);
  assert.equal(body.length > 16 + 4 + 1 + 65, true);
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(body[20], 65, 'uncompressed P-256 point is 65 bytes');
  assert.equal(body[21], 0x04, 'and starts with the uncompressed marker');
});

test('a fresh salt and ephemeral key are used every time', () => {
  const a = encryptPayload('same', VECTOR.uaPublic, VECTOR.authSecret);
  const b = encryptPayload('same', VECTOR.uaPublic, VECTOR.authSecret);
  assert.notEqual(a.toString('base64url'), b.toString('base64url'));
});

test('the VAPID header is scoped to the endpoint origin, not its path', () => {
  // A throwaway pair; only the shape of the output is under test.
  const keys = {
    publicKey:
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    privateKey: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  };
  const header = vapidHeader(
    'https://fcm.googleapis.com/fcm/send/abc123',
    keys,
    'mailto:nobody@example.com'
  );

  assert.match(header, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  const [, jwt] = header.match(/^vapid t=([^,]+)/);
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:nobody@example.com');
  assert.equal(claims.exp > Math.floor(Date.now() / 1000), true);
});
