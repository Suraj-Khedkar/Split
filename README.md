# Split &amp; Track

A shared-expense tracker built with Expo (React Native) — **one codebase, running
on Android, iOS and the web**. Add expenses to a group, split them four different
ways, and see who owes whom with the fewest possible payments. Groups sync
between everyone in them through a small self-hosted server.

## Run it

You need nothing installed on your phone but the **Expo Go** app
([iOS](https://apps.apple.com/app/expo-go/id982107779) ·
[Android](https://play.google.com/store/apps/details?id=host.exp.exponent)).

```bash
cd ~/Documents/splitwise-clone && npm start
```

Scan the QR code from the terminal — Camera app on iOS, Expo Go on Android.

`npm start` serves over **Tailscale**, so the phone connects from any network as
long as both devices are on your tailnet. The IP is read at runtime, so it keeps
working if Tailscale reassigns it.

Other commands:

```bash
npm run start:lan  # same Wi-Fi instead of Tailscale
npm run start:tunnel  # any network, via Expo's relay (slower)
npm run android    # open on an Android emulator
npm run ios        # open on an iOS simulator (macOS only)
npm test           # split/balance math test suite
npm run typecheck  # tsc --noEmit
```

> Node 24 was installed via nvm and is already on your PATH in new terminals.

## Install it as a real app

The Expo Go route above is for development. To get a **standalone app with its
own icon on the home screen**, build it with EAS (free account, builds run in
Expo's cloud so no Android Studio or Xcode needed locally):

```bash
npx eas login          # once
npm run build:android  # produces an installable APK
```

When it finishes, EAS gives you a link. Open it **on the phone**, download the
APK, tap it, allow "install from unknown sources". That is a normal installed
Android app — it runs with no laptop and no Expo Go.

### iOS is different

Apple does not allow installing an app without a signing identity. Your options:

| Route | Requires | Notes |
|---|---|---|
| `npm run build:ios` + TestFlight | Apple Developer Program, $99/yr | The normal way; installs like any App Store app |
| Xcode free provisioning | Your Mac (`brahma`) + free Apple ID | Free, but the app **expires after 7 days** and must be re-installed |
| Expo Go | nothing | What you have now — real native code, but runs inside the Expo Go container |

There is no way around this: it is Apple's restriction, not an Expo one.

## Public URL (Tailscale Funnel)

The web build is live on the internet at:

**https://pinaka.tail2f85bc.ts.net:10000/**

Funnel only permits three ports — **443, 8443, 10000** — so services share it by
taking a port each. On this machine:

| Port | Service | Funnelled |
|---|---|---|
| 443 | Nextcloud | yes → `127.0.0.1:443` |
| 8443 | Immich | yes → `127.0.0.1:2283` |
| 10000 | Split &amp; Track | yes → `:3000` (app) and `:4000` (`/api`) |

All three are public. The nginx container in `~/Documents/personal-cloud`
fronts Nextcloud and Immich, and its 443 binding is deliberately *not*
`0.0.0.0`: Funnel must bind 443 on the tailnet address itself, and a wildcard
bind silently takes it, so `tailscale funnel --https=443` fails. It listens on
`127.0.0.1` (for Funnel) and `192.168.1.10` (for the LAN) instead — set by
`HTTPS_BIND` / `HTTPS_LAN_BIND` in that project's `.env`.

To rebuild and publish after changing code:

```bash
npm run web:publish
```

The static server runs as a systemd user service (`splitwise-web.service`) bound
to `127.0.0.1:3000`; Funnel is the only thing exposing it.

```bash
systemctl --user status splitwise-web     # check
systemctl --user restart splitwise-web    # after a rebuild
sudo loginctl enable-linger suraj         # keep it running when logged out
```

> Note: this URL is **public**, and sign-up is open — anyone who finds it can
> create an account on your server. They see nothing of yours: expenses are
> scoped to the groups you are a member of, and there is no directory of users.
> Closing sign-up would mean an invite-only flow, which does not exist yet.

## Using it as an app

### iPhone / iPad — install as a PWA (free)

Open **https://pinaka.tail2f85bc.ts.net:10000/** in **Safari** → Share → **Add to
Home Screen**. It launches full screen with its own icon, no browser chrome, and
its own app-switcher card. Camera scanning works from there.

Two iOS caveats:

- iOS clears a web app's storage after ~7 days of no use. Your data is safe on
  the server; you would just have to sign in again.
- It must be added from Safari. Chrome on iOS works too but is still WebKit.

### Android — install the APK (free)

```bash
npx eas login          # once; a free Expo account
npm run build:android  # builds in Expo's cloud
```

EAS returns a link — open it **on the phone**, download, tap, allow "install
from unknown sources". A real installed app, no laptop and no Expo Go.

Android can also install the PWA (Chrome → menu → Install app), which is
instant and needs no account.

### Browser

The same URL keeps working normally on any desktop browser.

## Signed in on several devices

One account can be signed in on the phone, the PC and the browser at once —
sessions are independent and none of them log the others out. A change on any
device appears on the others within a fraction of a second over the WebSocket.

The server skips pushing a change back to the *device* that made it, not the
*user*, which is what makes phone-and-laptop-at-once work.

## What works

- **Accounts** — email and password, or **Continue with Google**
- **Groups** — trip / home / couple / other, with member selection
- **Invite codes** — share a code, they sign up and join
- **Expenses** — description, amount, category, who paid, who's involved
- **Four split methods** — equally, exact amounts, percentages, or shares
- **Balances** — per group, per friend, and one overall figure
- **Simplify debts** — the fewest transfers that clear everyone
- **Settle up** — records a payment that flows through the same ledger
- **Activity feed** — every expense, showing what it did to *your* balance
- **Receipt scanning** — photograph a bill; OCR pulls out merchant, total, lines
- **Splitwise import** — their CSV export, with balances landing exactly
- **Live sync** — a change on one device reaches the others over a WebSocket
- **Light and dark theme**, following the system setting automatically
- Data persists on-device between launches and survives being offline

## How it's built

```
app/                      screens (expo-router: file path = URL)
  (tabs)/                 Groups · Friends · Activity · Account
  auth/index.tsx          sign in, sign up, Continue with Google
  oauthredirect.tsx       where Google returns; hands the code to the opener
  group/[id].tsx          group detail: balances, suggested payments, expenses
  expense/new.tsx         add expense with live split preview
  expense/scan.tsx        photograph a receipt, pick the lines to keep
  settle/[groupId].tsx    record a payment
src/
  lib/money.ts            parsing, formatting, exact-sum splitting
  lib/split.ts            the four split methods + validation
  lib/balances.ts         net balances and debt simplification
  lib/googleAuth.ts       AuthSession wrapper; PKCE, never sees the secret
  store/useStore.ts       zustand store, persisted to AsyncStorage
  theme/                  colours, spacing, typography
server/                   dependency-free Node + node:sqlite API
  index.js                routes, /sync, and the change-notification socket
  auth.js                 scrypt password hashing and sessions
  google.js               Google code exchange and ID token checks
  ocr.js                  receipt OCR behind a provider switch
```

Three decisions worth knowing:

**Money is integer minor units (paise), never floats.** Splitting ₹10.00 three
ways is the classic floating-point trap; a cent lost on every expense becomes a
visibly wrong balance. `splitEvenly(1000, 3)` returns `[334, 333, 333]` — summing
to exactly 1000. Percentages and shares use the largest-remainder method for the
same reason. Formatting to a decimal string happens only at the display layer.

**Settlements are just expenses.** A payment is stored as an expense the payer
covered entirely on the payee's behalf, so balance math has one code path
instead of two that can drift apart.

**The app never holds the Google client secret.** Google requires one at the
token endpoint for Web clients, and there is no safe way to ship a secret in a
client bundle — so the app runs PKCE, receives a one-time authorization code,
and posts that to `/api/auth/google`, which does the exchange. The secret lives
only in `~/.config/splitwise/google.env`, loaded by a systemd drop-in.

Debt simplification is greedy largest-creditor/largest-debtor matching. Each
step fully settles at least one person, so it finishes in at most n−1 transfers
rather than the n² you get from settling every pair. (True minimisation is
NP-hard; this matches what users expect to see.)

The math is covered by `npm test` — 19 cases including 200 randomised ledgers
asserting balances always net to zero and that applying the suggested payments
leaves everyone flat.

## Not built yet

- **No Google sign-in in the Android app.** Google refuses a custom-scheme
  redirect for a "Web application" client, so the APK needs an Android OAuth
  client of its own (package `com.suraj.splitwiseclone` plus the SHA-1 from
  `npx eas credentials`). Set `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` in `.env`
  and rebuild — the code path is already there, and the button stays hidden on
  native until it is set rather than offering a flow that always fails.
- No multi-currency conversion (a group has one currency), recurring expenses,
  comments, or push notifications.
- No password reset. A forgotten password currently means a new account.

There is no sample data: the ledger starts empty and fills from the server.
**Account → Reset local data** clears this device's copy and re-downloads it.

## Known noise

On startup you may see:

> ERROR  An unknown error occurred while installing React Native DevTools …
> chrome-sandbox is owned by root and has mode 4755

**Harmless — ignore it.** It is Expo trying to unpack its bundled Chrome-based
debugger, which needs a setuid sandbox that Linux won't grant to a user-owned
binary. Metro, the QR code, and the app on your phone are all unaffected.

Only if you want the in-browser debugger (the `j` key):

```bash
sudo chown root:root "$HOME/.cache/dotslash/64/ed7915e5fef86802e862c274e17f780fa75388/React Native DevTools-linux-x64/chrome-sandbox"
sudo chmod 4755 "$HOME/.cache/dotslash/64/ed7915e5fef86802e862c274e17f780fa75388/React Native DevTools-linux-x64/chrome-sandbox"
```
