# OpenAdBlock

A free, open-source ad and tracker blocker for Firefox. No account, no telemetry, no
allowlisting deals, and no paid tier.

OpenAdBlock covers the feature set people actually use in Adblock Plus and AdBlock —
filter-list blocking, element hiding, per-site allowlisting, pausing, custom filters, an
element picker, counters and an activity log — in roughly 5,000 lines of commented,
dependency-free JavaScript that one person can read through in an evening.

> **Status: 0.1.0, early but working.** The engine, UI and packaging are complete and
> tested. It has not yet been through an addons.mozilla.org review. See
> [the roadmap](docs/ROADMAP.md) for what is still missing.

---

## What it does

**Blocking**

- Blocks ads, pop-up and pop-under scripts, banners, interstitials and video ad requests
  using [Adblock Plus filter syntax](docs/FILTER_SYNTAX.md), the format EasyList is
  written in.
- Blocks third-party trackers, analytics beacons and fingerprinting scripts via
  EasyPrivacy.
- Blocks requests before they leave the browser, using Firefox's blocking `webRequest`
  API, so a blocked ad costs no bandwidth and runs no code.
- Optional lists for cookie consent notices, social media buttons, newsletter and app
  install prompts, and hosts known to serve malware.

**Hiding**

- Element hiding (`example.com##.sponsored`) is applied as a *user stylesheet* by the
  browser itself, which is faster and harder for a page to undo than editing the DOM.
- Procedural selectors — `:has-text()`, `:has()`, `:upward()` — are evaluated in the page
  for the cases plain CSS cannot express.
- Blocked images and frames are collapsed so they leave no gap.

**Control**

- One switch in the toolbar popup turns blocking off for the current site.
- Pause everywhere for 30 minutes, then resume.
- **Block an element…** opens a picker: hover, click, widen the selection, see exactly
  which filter will be written, then save it.
- Write your own filters, with per-line error reporting for anything unparseable.
- Subscribe to any Adblock Plus compatible list by URL.
- An in-memory activity log showing what was blocked or allowed, and by which filter.
- Blocked counters per page and since install, plus the domains blocked most often.
- Export and import your settings as JSON.
- Light, dark or system theme.

**Acceptable Ads is off by default.** Adblock Plus and AdBlock both ship it on. In
OpenAdBlock it is a plain checkbox that subscribes to the same public exception list, and
nobody can pay to be on it, because the project does not run the list.

See [docs/FEATURES.md](docs/FEATURES.md) for a feature-by-feature comparison with Adblock
Plus and AdBlock, including the things OpenAdBlock deliberately does not do.

## Install

### From source, for everyday use

```bash
git clone https://github.com/drtomtron/OpenAdBlock.git
cd OpenAdBlock
npm run build
```

That writes `dist/openadblock-<version>.zip` using nothing but Node's standard library.
Then in Firefox:

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…**
3. Pick `src/manifest.json` (or the built zip)

A temporary add-on is removed when Firefox restarts. For a permanent install the package
has to be signed by Mozilla; that is tracked in [the roadmap](docs/ROADMAP.md).

### Requirements

- Firefox 115 or later
- Node.js 20 or later, only for building and testing

## Develop

```bash
npm test     # 147 tests, Node's built-in runner
npm run lint # syntax, hygiene, licence headers, extension CSP rules
npm run build # package into dist/
npm run check # lint + test, the same thing CI runs
```

There are **no runtime dependencies and no build step** — no bundler, no transpiler, no
`node_modules`. The files in `src/` are what Firefox loads. `npm install` is not needed
for anything.

The core modules (`src/lib/`) are pure ES modules with no WebExtension APIs, which is why
they can be unit tested under plain Node. Anything that touches `browser.*` lives in
`src/background/`, `src/content/` or the UI folders.

`test/background.test.js` runs the real background page against a stubbed `browser` API, so
the wiring — startup, list download, navigation, blocking decisions, every message handler
— is covered too, not just the engine in isolation.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how a request travels from
`webRequest` to a blocking decision, how the filter index is built, and — importantly —
what the engine deliberately does *not* implement yet and why.

## Project layout

```
src/
  manifest.json          Manifest V2: Firefox keeps blocking webRequest, which an
                         ad blocker needs to cancel a request before it is sent
  lib/                   pure, testable core
    filter-parser.js       Adblock Plus syntax -> filter objects
    filter-engine.js       keyword-indexed request matching
    cosmetic-index.js      element hiding rules by domain
    domain.js              hostnames, eTLD+1, third-party decisions
    allowlist.js           per-site exemptions
    subscriptions.js       downloading and refreshing filter lists
    settings.js            storage and defaults
    filter-store.js        compiles subscriptions into the live engines
    stats.js, request-log.js, default-lists.js, messages.js
  background/            webRequest blocking, navigation, messaging, alarms
  content/               procedural selectors, collapsing, element picker
  popup/ options/ pages/ user interface
test/                    unit tests (node --test)
tools/                   lint.mjs and build.mjs, no dependencies
docs/                    architecture, filter syntax, features, privacy, roadmap
```

## Privacy

OpenAdBlock has no server. It makes exactly one kind of network request of its own:
downloading the filter lists you have subscribed to, directly from their publishers, with
no cookies, no referrer and no identifiers. Everything else — your allowlist, your
filters, your counters, the activity log — stays in your browser profile. The log is held
in memory only and is gone when Firefox closes.

The extension asks for `<all_urls>` because a blocker has to see requests on every site to
decide whether to cancel them. It does **not** request access to history, bookmarks,
cookies, downloads or native messaging, and [a test asserts
that](test/manifest.test.js).

Full detail: [docs/PRIVACY.md](docs/PRIVACY.md).

## Filter lists

OpenAdBlock ships with no filters of its own. It subscribes to lists maintained by other
people, each under its own licence, and downloads them from their publishers:

| List | Maintainer | On by default |
| --- | --- | --- |
| EasyList | [easylist.to](https://easylist.to/) | yes |
| EasyPrivacy | [easylist.to](https://easylist.to/) | yes |
| ABP anti-circumvention | [abp-filters](https://github.com/abp-filters/abp-filters-anti-cv) | yes |
| Regional supplement for your browser language | easylist.to and others | yes, when one matches |
| Fanboy social, cookie notices, annoyances | [easylist.to](https://easylist.to/), [fanboy.co.nz](https://www.fanboy.co.nz/) | no |
| Peter Lowe's ad and tracking servers | [pgl.yoyo.org](https://pgl.yoyo.org/adservers/) | no |
| URLhaus malicious hosts | [malware-filter](https://gitlab.com/malware-filter/urlhaus-filter) | no |
| Acceptable Ads | [acceptableads.com](https://acceptableads.com/) | no |

Please report a site that breaks, or an ad that gets through, to the relevant list's own
issue tracker when the cause is a filter — that fixes it for every blocker at once. Open
an issue here when the cause is OpenAdBlock's engine.

## Contributing

Bug reports, filter engine fixes and UI work are all welcome. Start with
[CONTRIBUTING.md](CONTRIBUTING.md), which covers the house style (no dependencies, tests
for engine changes, no telemetry ever) and how to run the suite.

## Licence

[GNU General Public License v3.0 or later](LICENSE), the same licence Adblock Plus and
AdBlock use.

## Not affiliated

OpenAdBlock is an independent project. It is not affiliated with, endorsed by or derived
from the source code of Adblock Plus (eyeo GmbH), AdBlock (BetaFish Inc.) or uBlock
Origin. Those products were studied as references for *what features users expect*; the
implementation here is original, and the compatibility that matters is with the public
EasyList filter syntax.
