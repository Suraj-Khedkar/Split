/**
 * Inject PWA metadata into the exported index.html.
 *
 * expo-router only honours app/+html.tsx when web.output is "static", which
 * pre-renders every route — that breaks a client-only auth guard, since the
 * prerendered HTML has no session and the redirect never runs. Keeping
 * output "single" and patching the one generated file afterwards is the
 * smaller, more predictable trade.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.argv[2] ?? 'dist/index.html');
let html = readFileSync(file, 'utf8');

if (html.includes('manifest.webmanifest')) {
  console.log('pwa-inject: already present, nothing to do');
  process.exit(0);
}

const HEAD = `
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#FFFFFF" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#121212" />
    <meta name="description" content="Share expenses with friends and settle up." />

    <!-- iOS ignores the manifest when installing; these drive it instead. -->
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Split" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="icon" href="/icon-192.png" />

    <style id="pwa-boot">
      /* Paint the app background before React mounts: a flash of the wrong
         colour on launch is the clearest "this is a website" tell in a
         standalone app. Follows the system theme, as the app itself does. */
      html, body, #root { background-color: #FFFFFF; }
      @media (prefers-color-scheme: dark) {
        html, body, #root { background-color: #121212; }
      }
      body { overscroll-behavior-y: none; }

      /* iOS text inflation off: Safari scales small text up on its own, which
         silently overflows fixed-height chrome like the tab bar. */
      html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }

      /* Deliberately NO safe-area padding on #root.
         react-native-safe-area-context measures env(safe-area-inset-*) from
         its own probe element on <body>, and react-navigation then pads the
         header and the tab bar by what it reports. Padding #root as well
         applied every inset twice: a blank strip between the notch and the
         screen title, and a tab bar whose content box was left too short for
         its own labels, which clipped them mid-glyph. The app owns the insets;
         #root only has to fill the screen.

         svh, not the reset's height:100% and not dvh. iOS Safari resolves
         percentage heights against the LARGE viewport - the one you get with
         the toolbar retracted - so the bottom of the app, tab bar included,
         renders underneath the toolbar until you scroll. svh is the small
         viewport, with the chrome showing: laying out to it keeps the tab bar
         above the toolbar at all times. dvh is wrong here because it follows
         the chrome as it animates, which moves the clipping rather than
         removing it. In a standalone PWA there is no chrome and all three
         units are equal, so this costs nothing there. */
      #root { height: 100svh; min-height: 100svh; }

      /* The status bar is translucent and iOS always draws its text white, so
         the strip behind it has to stay dark even in light mode - a white
         header showing through makes the clock and battery invisible. Painted
         here rather than in the app so it covers every route, including the
         sign-in screen, which has no header of its own. */
      body::before {
        content: '';
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: env(safe-area-inset-top);
        background-color: #121212;
        z-index: 2147483647;
        pointer-events: none;
      }
    </style>
    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
          navigator.serviceWorker.register('/sw.js').catch(function () {
            /* the offline shell is a nicety; never break the app over it */
          });
        });
      }
    </script>
`;

// viewport-fit=cover lets the app paint under the notch; without it iOS
// leaves white bars at the top and bottom in standalone mode.
html = html.replace(
  /<meta name="viewport"[^>]*>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />'
);
html = html.replace('</head>', `${HEAD}  </head>`);

writeFileSync(file, html);
console.log('pwa-inject: manifest, apple meta tags and service worker added');
