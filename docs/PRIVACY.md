# Privacy

OpenAdBlock has no backend. There is no account, no identifier, no analytics and no crash
reporting. This document describes every byte that leaves your browser and everything that
is stored in it.

## Network requests OpenAdBlock makes

Exactly one kind: downloading the filter lists you are subscribed to, from the URLs shown
in **Settings → Filter lists**.

Those requests are made with:

```js
fetch(url, {
  cache: 'no-cache',
  credentials: 'omit',      // no cookies sent
  redirect: 'follow',
  referrerPolicy: 'no-referrer'   // no referrer sent
})
```

No query parameters are added, no version or installation identifier, nothing about your
browser beyond what Firefox sends on any plain request. The list publisher learns that
*someone* at your IP address fetched a public text file, and nothing else. Disable a list
and it is never fetched again.

There is no "phone home", no update ping, no uninstall beacon and no first-run call.

## What is stored, and where

All of it is in your own Firefox profile, in `browser.storage.local`:

| What | Where | Leaves your machine? |
| --- | --- | --- |
| Preferences (switches, theme, intervals) | `settings` | no |
| Your allowlist | `settings.allowlist` | no |
| Your own filters | `settings.customFilters` | no |
| Which lists you subscribe to | `settings.subscriptions` | no |
| Lifetime blocked count and start date | `stats` | no |
| Counts per blocked domain, capped at 400 entries | `stats.domains` | no |
| Downloaded filter list text | `listBody:<id>` | no |
| Per-tab blocked counts | memory only | no |
| Activity log | memory only, gone when Firefox closes | no |

The per-domain tally records *which ad and tracking domains were blocked* and how often —
for example `doubleclick.net: 412`. It does not record the pages you visited, URLs, titles,
times or any sequence. It exists to populate the "most blocked domains" list in settings
and can be cleared with **Reset counters**.

The activity log does hold request URLs while it is open, because that is the point of a
log: you need to see what was blocked and by which filter. It is a bounded in-memory ring
buffer, it is never written to disk, and it is discarded when the browser closes. You can
switch it off entirely in **Settings → General**.

## Permissions, and why each is needed

| Permission | Why |
| --- | --- |
| `<all_urls>` | a blocker has to see requests on every site to decide whether to cancel them, and inject hiding CSS |
| `webRequest`, `webRequestBlocking` | cancel a request before it is sent |
| `webNavigation` | know when a page commits, to inject the right stylesheet and reset counters |
| `storage`, `unlimitedStorage` | keep your settings and the downloaded lists (EasyList alone is several MB) |
| `tabs` | read the current tab's URL for the popup, and inject the element picker |
| `alarms` | refresh filter lists on a schedule |
| `contextMenus` | the right-click "Block an element" entry |

Not requested: `history`, `bookmarks`, `cookies`, `downloads`, `nativeMessaging`, `proxy`,
`management`, `clipboardRead`. [A unit test asserts those are
absent](../test/manifest.test.js) so it cannot regress unnoticed.

The manifest also declares Firefox's data collection consent key as
`data_collection_permissions: { required: ["none"] }`, which is what the browser shows on
the install prompt and the add-on listing. A test pins that to `none` as well, so the
declaration and this document cannot drift apart.

## Third parties

The filter lists are maintained by other people and downloaded from their servers. Their
privacy practices are their own; the links are in **Settings → Filter lists** and in the
[README](../README.md). OpenAdBlock sends them nothing except the plain HTTP GET described
above.

## Verifying this

The whole extension is a few thousand lines of plain JavaScript with no bundler, no
minification and no dependencies. What is in `src/` is what Firefox runs. Every network
call the extension can make is in
[`src/lib/subscriptions.js`](../src/lib/subscriptions.js) — one `fetch`, which you can read
in a minute.

If you find anything in this repository that contradicts this document, please open an
issue; it is a bug, not a policy.
