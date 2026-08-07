import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * Google sign-in, over the generic AuthSession flow.
 *
 * `expo-auth-session/providers/google` is deprecated in SDK 57 and its
 * replacement, @react-native-google-signin/google-signin, has no web support -
 * which rules it out here, because the browser and the installed PWA are how
 * most people reach this app and the only way iOS users reach it at all. The
 * generic flow covers all three surfaces from one code path.
 *
 * The app never sees a client secret: it runs PKCE, receives a one-time
 * authorization code, and posts that to our own server, which does the
 * exchange. See server/google.js.
 */

// Closes the popup and resolves the pending prompt when the redirect lands.
WebBrowser.maybeCompleteAuthSession();

const extra = (Constants.expoConfig?.extra ?? {}) as {
  googleClientId?: string;
  googleAndroidClientId?: string;
};

/**
 * EXPO_PUBLIC_ first, app.json second.
 *
 * A web export does not carry the app config's `extra` into the bundle -
 * Constants.expoConfig.extra comes back without it, so reading the id from
 * there alone left the button permanently hidden in the browser. EXPO_PUBLIC_
 * values are inlined by the bundler and survive on every platform; the
 * app.json copy is kept as a fallback so a native build still works if the
 * env file is missing.
 */
const WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || extra.googleClientId || '';
const ANDROID_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || extra.googleAndroidClientId || '';

/**
 * Google refuses a custom-scheme redirect for a "Web application" client, so
 * the native build genuinely cannot borrow the web credentials - it needs an
 * Android client of its own. Until one is configured the button stays hidden
 * there rather than offering a flow that always fails.
 */
export function googleClientIdForPlatform(): string {
  if (Platform.OS === 'web') return WEB_CLIENT_ID;
  return ANDROID_CLIENT_ID;
}

export interface GoogleCodeResult {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
}

export function useGoogleSignIn(onCode: (result: GoogleCodeResult) => void) {
  const discovery = AuthSession.useAutoDiscovery('https://accounts.google.com');
  const clientId = googleClientIdForPlatform();

  // On web this resolves to <origin>/oauthredirect, which the static server
  // answers with index.html via its SPA fallback; on native it is
  // splitwiseclone://oauthredirect.
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: 'splitwiseclone',
    path: 'oauthredirect',
  });

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId,
      redirectUri,
      scopes: ['openid', 'profile', 'email'],
      usePKCE: true,
      responseType: AuthSession.ResponseType.Code,
    },
    discovery
  );

  // A code is single-use; React re-running this effect must not post it twice.
  const consumed = useRef('');
  useEffect(() => {
    if (response?.type !== 'success') return;
    const code = response.params?.code;
    if (!code || consumed.current === code) return;
    consumed.current = code;
    onCode({
      code,
      codeVerifier: request?.codeVerifier ?? '',
      redirectUri,
      clientId,
    });
  }, [response, request, redirectUri, clientId, onCode]);

  return {
    /** False when unconfigured for this platform, or still building the request. */
    available: Boolean(clientId) && Boolean(request),
    promptAsync,
    // 'dismiss' and 'cancel' are the user backing out, which is not an error.
    error:
      response?.type === 'error'
        ? response.error?.message || 'Google sign-in failed'
        : '',
  };
}
