/**
 * Google sign-in: authorization-code exchange and ID token checks.
 *
 * The exchange happens here rather than in the app because Google requires a
 * client secret at the token endpoint for "Web application" clients, and there
 * is no way to ship a secret in a client bundle safely. The app does the PKCE
 * dance, gets a one-time code, and hands it over.
 *
 * Config, all from the environment:
 *   GOOGLE_CLIENT_ID       web client id (public; the app has it too)
 *   GOOGLE_CLIENT_SECRET   web client secret (never leaves the server)
 *   GOOGLE_ANDROID_CLIENT_ID  optional; Android clients have no secret
 */
const WEB_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const WEB_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const ANDROID_CLIENT_ID = process.env.GOOGLE_ANDROID_CLIENT_ID ?? '';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export const googleEnabled = () => Boolean(WEB_CLIENT_ID && WEB_CLIENT_SECRET);

/** Every client id this server will accept a code for. */
export function knownClientIds() {
  return [WEB_CLIENT_ID, ANDROID_CLIENT_ID].filter(Boolean);
}

/**
 * Decode a JWT payload without verifying its signature.
 *
 * Safe *only* because the token came back on the response to our own TLS call
 * to Google's token endpoint, authenticated with the client secret - Google
 * documents that tokens obtained that way need no local signature check. An
 * ID token arriving from anywhere else would have to be verified against the
 * JWKS instead.
 */
function decodePayload(idToken) {
  const part = String(idToken).split('.')[1];
  if (!part) throw new Error('Malformed ID token');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/**
 * Trade an authorization code for the caller's Google identity.
 *
 * Throws with a user-safe message; the route turns that into a 400.
 */
export async function exchangeCode({ code, codeVerifier, redirectUri, clientId }) {
  const useClientId = clientId || WEB_CLIENT_ID;
  if (!knownClientIds().includes(useClientId)) {
    throw new Error('Unrecognised Google client');
  }

  const body = new URLSearchParams({
    code,
    client_id: useClientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  if (codeVerifier) body.set('code_verifier', codeVerifier);
  // Android and iOS client types are public clients and have no secret; only
  // the web client authenticates itself here.
  if (useClientId === WEB_CLIENT_ID) body.set('client_secret', WEB_CLIENT_SECRET);

  const resp = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.id_token) {
    // redirect_uri_mismatch and invalid_grant are the two that actually happen,
    // and both are configuration problems worth seeing in the log verbatim.
    console.error('google token exchange failed:', resp.status, JSON.stringify(json).slice(0, 300));
    throw new Error('Google rejected the sign-in. Try again.');
  }

  const claims = decodePayload(json.id_token);

  if (!ISSUERS.has(claims.iss)) throw new Error('Unexpected token issuer');
  // aud must be the client we asked for, or the code was minted for someone
  // else's app and replayed at ours.
  if (claims.aud !== useClientId) throw new Error('Token was not issued for this app');
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    throw new Error('Google sign-in expired. Try again.');
  }
  if (!claims.email) throw new Error('That Google account has no email address');
  // email_verified false means Google itself does not vouch for the address,
  // which is the whole reason for preferring Google over a password here.
  if (claims.email_verified === false) {
    throw new Error('That Google account has an unverified email address');
  }

  return {
    sub: String(claims.sub),
    email: String(claims.email).toLowerCase(),
    name: String(claims.name || claims.given_name || claims.email).trim(),
  };
}
