# Changelog

All notable changes to OpenAdBlock are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

Nothing yet. See [docs/ROADMAP.md](docs/ROADMAP.md) for what is planned.

## [0.1.0] - 2026-11-09

First working version: a complete blocker, tested engine, and packaging.

### Added

**Blocking engine**

- Adblock Plus filter syntax parser: network filters, exception filters, element hiding,
  element hiding exceptions, procedural selectors and hosts-file lines.
- Keyword-indexed request matcher with Adblock Plus matching semantics, including
  `$important` outranking exceptions and document-scoped exceptions
  (`$document`, `$elemhide`, `$generichide`, `$genericblock`).
- Request blocking through Firefox's blocking `webRequest` API, so cancelled requests are
  never sent.
- Element hiding applied as a user-origin stylesheet, with a cached per-host sheet and a
  shared generic sheet.
- Procedural selector evaluation in the page for `:has-text()`, `:has()` and `:upward()`,
  with native `:has()` used where the browser supports it.
- Collapsing of the space left by blocked images, frames and media.

**Filter lists**

- Catalogue of nine built-in lists plus eight regional supplements, with EasyList,
  EasyPrivacy and the ABP anti-circumvention list on by default.
- A regional supplement is suggested from the browser's UI language on first run.
- Subscribe to any `https` Adblock Plus compatible list by URL.
- Anonymous downloads (no cookies, no referrer), size limits, HTML-response rejection, and
  a failed download never discards the stored copy.
- Hourly due-check honouring each list's own `! Expires:` value and the user's preferred
  interval, with backoff after a failure.

**Control**

- Toolbar popup: per-site blocking switch, pause everywhere for 30 minutes, page and
  lifetime counters, element picker, reload prompt.
- Element picker with selector widening and a preview of the exact filter to be saved.
- Options page: general settings, filter lists, allowlist, custom filters with per-line
  error reporting, activity log, backup and restore, statistics, engine internals.
- Allowlist entries cover subdomains by default, or one exact host with an `=` prefix.
- Blocked-count badge, switchable between the current page and the lifetime total.
- Light, dark and system themes.
- Right-click menu entries for the element picker and settings.
- Welcome page on first run explaining what is on by default.

**Project**

- 147 tests: unit coverage of the parser, matcher, cosmetic index, allowlist, counters, log
  and manifest integrity, plus an integration suite that runs the whole background page
  against a stubbed WebExtension API.
- Dependency-free linter checking syntax, file hygiene, licence headers, and the extension
  CSP rules.
- Dependency-free, reproducible packaging script that writes a loadable zip using only
  Node's standard library.
- GitHub Actions CI running lint, tests and build on Node 20 and 22.
- Architecture, filter syntax, feature comparison, privacy and roadmap documentation.

### Deliberate decisions

- Acceptable Ads is **off** by default, unlike Adblock Plus and AdBlock.
- No account, no sync, no telemetry, no paid tier.
- A filter option the engine cannot honour (`$redirect`, `$removeparam`, `$csp`, and
  others) is counted as unsupported rather than approximated as a plain block.
- `$popup`-only filters are inert: popup blocking needs tab-opener context that
  `webRequest` does not provide, and guessing could cancel ordinary navigation.
- A filter with no request-type option never blocks a top-level document.

### Known gaps

- No scriptlet or snippet support, which costs some anti-circumvention coverage.
- Not yet signed by Mozilla; installation is from source or as a temporary add-on.
- UI strings are English only.

[Unreleased]: https://github.com/drtomtron/OpenAdBlock/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/drtomtron/OpenAdBlock/releases/tag/v0.1.0
