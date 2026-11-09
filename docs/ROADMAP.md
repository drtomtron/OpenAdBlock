# Roadmap

Ordered by how much it improves real blocking, not by how interesting it is to build.
Nothing here has a date. Pull requests are welcome on any of it — say so on the issue
first so two people do not write the same thing.

## 0.2 — close the biggest blocking gap

- **Scriptlet support** (`##+js(...)`, `#$#`). The single largest coverage gap: a good part
  of the anti-circumvention list relies on scriptlets to defeat ad-block detection and
  platform video ads. Needs a vetted library of scriptlets injected into page context at
  `document_start`, with the injection surface kept deliberately small.
- **`$redirect` / `$redirect-rule`** with a small set of bundled neutered resources (an
  empty script, a 1×1 GIF, a stub analytics object). Today these filters are counted as
  unsupported.
- **`$removeparam`** for stripping tracking parameters from URLs.
- **`$badfilter`** so one list can disable another's filter, which lists already assume.

## 0.3 — distribution and polish

- **Signing and an AMO listing**, so installing does not mean building from source. Needs a
  privacy policy page on AMO (the content is already in [PRIVACY.md](PRIVACY.md)) and a
  reviewer-friendly build (already true: no bundler, no minification).
- **Localisation.** The `_locales` plumbing and `default_locale` are in place but every UI
  string is still hard-coded English. Move the popup and options strings to
  `messages.json`.
- **A nicer first-run flow**: offer the annoyance and cookie lists explicitly instead of
  leaving them off and undiscovered.
- **Per-site rule counts in the popup**, so it is obvious when a site is doing nothing
  because a list exception allows it.

## 0.4 — engine quality

- **Compiled filter storage.** Parsed filters are plain objects today, which is the main
  reason memory use is higher than uBlock Origin's. Moving the hot fields into typed arrays
  with a string table would cut it substantially and speed up startup.
- **Persist the compiled engine** so a browser restart does not re-parse every list.
- **Full public suffix list**, generated into a compact structure at build time, replacing
  the ~150 entry approximation in `domain.js`.
- **`:matches-css()`, `:matches-attr()`, `:xpath()`, `:remove()`, `:style()`** procedural
  operators.
- **Better `$genericblock`**: re-match against domain-specific filters instead of skipping
  the generic match.

## 0.5 — verification

- **End-to-end tests** driving a real Firefox with `web-ext` against a local fixture site:
  assert that a known ad request is cancelled, that the allowlist switch restores it, and
  that hiding rules apply.
- **A filter corpus regression test**: run the parser over current EasyList and
  EasyPrivacy in CI and fail if the unsupported-filter count jumps, which catches syntax
  the lists have started using.
- **Performance budget** in CI: parse and index the default lists, fail if the time or the
  heap moves more than a set margin.

## Considered and declined

- **Settings sync.** Would need an account or a server. Backup and restore is a file you
  own; that is enough.
- **An allowlisting programme**, paid or free. The reason Acceptable Ads is off by default.
- **Telemetry**, including "anonymous" counts. There is no number worth a background
  request.
- **A Chrome build.** Manifest V3's `declarativeNetRequest` is a different engine, not a
  port, and would halve what this one can do. Someone may want to do it anyway; it should
  be a separate target, not a compromise in this one.
- **A VPN, a browser, or mobile apps.** Out of scope.
