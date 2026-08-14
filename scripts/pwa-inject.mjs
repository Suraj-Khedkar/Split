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
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#F6F7F9" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0E0F12" />
    <meta name="description" content="Share expenses with friends, track your own, and settle up." />

    <!-- iOS ignores the manifest when installing; these drive it instead. -->
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="SplitTrack" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="icon" href="/icon-192.png" />

    <style id="pwa-boot">
      /* Paint the app background before React mounts: a flash of the wrong
         colour on launch is the clearest "this is a website" tell in a
         standalone app. Follows the system theme, as the app itself does. */
      html, body, #root { background-color: #F6F7F9; }
      @media (prefers-color-scheme: dark) {
        html, body, #root { background-color: #0E0F12; }
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

         And NO height override either. Expo's own reset (the #expo-reset style
         block above) already sets html, body and #root to height:100%, and with
         viewport-fit=cover that is exactly the screen in a standalone PWA,
         safe areas included.

         Every viewport unit tried here made it worse. 100svh is the *small*
         viewport - what you get with Safari's toolbars showing - and iOS keeps
         computing it that way even once installed to the Home Screen, so #root
         ended up a chunk short of the screen and left an unpainted band along
         the bottom of every route, tab bar or not. 100dvh tracks the visual
         viewport, so the keyboard drags it around. Percentages are the only
         ones that resolve against the layout viewport, which is the thing that
         actually matches the screen. */

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
        background-color: #0E0F12;
        z-index: 2147483647;
        pointer-events: none;
      }

      /* No bottom counterpart to the strip above, deliberately. One was tried
         while #root was mis-sized, and it is wrong once the root fills the
         screen: the tab bar already covers the home indicator on the tab
         routes, and on a stack route - a group, an expense - there is no tab
         bar, so a painted strip put a card-coloured band where the page
         background belongs. */
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
