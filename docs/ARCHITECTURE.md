# Architecture

How OpenAdBlock is put together, and where its limits are.

## Why Manifest V2

Firefox supports blocking `webRequest` in both Manifest V2 and V3, and Mozilla has
committed to keeping V2 working. Chrome's V3 replacement, `declarativeNetRequest`, hands
matching to the browser and caps the number of rules, which is why Chrome ad blockers lost
capability in the move. OpenAdBlock targets V2 so it can:

- cancel a request before it is sent, rather than report it afterwards,
- run an unbounded number of filters,
- decide each request with full context (document host, request type, first vs third party).

A `background.page` is used instead of a script list so the background can be written as ES
modules. That is what lets `src/lib/` be imported by Node for the unit tests without a
bundler.

## Request path

```
network request
   |
   v
webRequest.onBeforeRequest  (background/blocker.js, "blocking")
   |
   +-- not http/https/ws? ................................. let through
   +-- master switch off, or paused? ...................... let through
   +-- main_frame? -> refresh the tab's page record
   +-- page allowlisted, or has a $document exception? .... let through
   |
   v
FilterEngine.match({url, type, documentHost, thirdParty})
   |
   +-- blocking index: first match?  no .................... let through
   +-- match has $important? ............................... BLOCK
   +-- exception index: match? ............................. let through (logged)
   +-- page has $genericblock and the filter has no $domain? let through
   |
   v
count, log, ask the content script to collapse the element, BLOCK
```

Two caches make this cheap. A per-tab `PageInfo` record (host, allowlist state, document
exception scopes) is computed once per navigation in `refreshPage`, not per request. And
the matcher only tests filters that share a keyword with the URL.

## The keyword index

A naive blocker tests every filter against every URL: 100,000 regular expressions per
request. Instead, each filter is filed under one keyword taken from its pattern, as
adblockpluscore does.

Keyword candidates come from `PATTERN_TOKEN_RE`:

```
/[^a-z0-9%*][a-z0-9%]{3,}(?=[^a-z0-9%*])/g
```

A candidate must be delimited on both sides **inside the pattern**. That is the important
part: it guarantees the keyword is also a complete token of any URL the filter can match,
so looking the URL's tokens up in the index can never miss a filter that would have
matched. Tokens at the very start or end of a pattern are rejected, because they might be
only part of a URL token.

Filters are then filed under their *rarest* candidate — a two-pass count over all patterns
— so no bucket becomes a hot spot. A filter with no usable candidate (short patterns, all
regular expression filters) goes into a small always-tested list.

At match time the URL is tokenized the same way, the buckets for those tokens are
concatenated with the always-tested list, and only those filters run their regular
expression.

## Compiling filters

`FilterStore.rebuild()` is the only writer of engine state:

1. read every enabled subscription body out of `browser.storage.local`
2. `parseFilterList` each one, plus the user's own filters
3. `FilterEngine.build()` for network filters, `CosmeticIndex.build()` for hiding rules
4. pre-render the shared generic stylesheet, clear the per-host cache

It is awaited on startup and after any change to lists, custom filters or the Acceptable
Ads toggle. Concurrent calls share a single rebuild so a burst of UI changes does not pile
up.

## Element hiding

Hiding rules are split three ways:

| Kind | Example | Applied |
| --- | --- | --- |
| generic | `##.banner-ad` | one shared stylesheet, injected into every page |
| specific | `example.com##.promo` | per host, resolved through every suffix of the hostname |
| procedural | `example.com#?#div:has-text(Ad)` | evaluated by the content script |

Plain CSS is injected with `tabs.insertCSS({cssOrigin: 'user'})` from
`webNavigation.onCommitted`. A user-origin stylesheet beats page author rules, costs no DOM
work, and cannot be undone by the page. Only procedural rules are sent to the content
script, which keeps the message small — the generic stylesheet can be a megabyte of text.

Per-host stylesheets are cached (64 entries, FIFO). Most hosts have no generic exceptions,
so they reuse the prebuilt generic sheet verbatim and only their specific selectors are
joined.

## Procedural selectors

`content/cosmetic.js` compiles a selector into a CSS prefix plus a chain of operators, then
evaluates it on `DOMContentLoaded` and again on mutations (debounced to 300 ms, capped at
400 runs so a busy page cannot spin forever).

Supported: `:has-text()` / `:-abp-contains()` / `:contains()`, `:has()` / `:-abp-has()`,
`:upward()`. `:has()` is handed to the browser when it supports it natively.

A selector that mixes CSS *between* operators (`div:has(.x) > .y`) is rejected at compile
time rather than evaluated approximately. Applying a filter in a way its author did not
intend is worse than not applying it.

## Safety properties

These are deliberate, and tested:

- **A type-less filter never blocks a top-level document.** `||ads.example.com^` must not
  stop you from visiting `ads.example.com` directly. Only `$document` filters can block a
  main frame.
- **`$popup` filters are inert.** Popup blocking needs tab-opener context that `webRequest`
  does not provide. Rather than guess — and risk cancelling an ordinary navigation — a
  popup-only filter parses to an empty type set and matches nothing.
- **An empty pattern must be narrowed.** `$third-party` on its own would block most of the
  web, so a filter with no pattern is only accepted when it carries a `$domain=`, a
  document scope or a type restriction.
- **Options we cannot honour are rejected, not approximated.** `$redirect`, `$removeparam`,
  `$csp`, `$rewrite` and friends change *how* a request is made. Treating them as plain
  blocks would break pages, so those filters are counted as unsupported and skipped. The
  options page shows the count per list.
- **An unknown document host counts as first party**, so an unattributable request is never
  blocked by a `$third-party` filter.
- **List data is never trusted as markup.** Titles and descriptions come from downloaded
  files, so the options page builds every node with `textContent`. The linter fails the
  build on an `innerHTML` assignment in `src/`.

## Known limitations

- **Public suffix list.** `domain.js` carries roughly 150 second-level suffixes rather than
  the full PSL. A missing entry only affects the first-party/third-party decision for that
  TLD, never plain hostname matching.
- **Keyword tokenization.** `/ads.js` does not match `/myads.js`, because `ads` is not a
  complete token of that URL. adblockpluscore behaves the same way, and list authors write
  patterns accordingly.
- **No scriptlets or snippets.** `##+js(...)` and `#$#` filters are parsed and counted, not
  executed. They need a page-context injection mechanism, which is the next significant
  feature.
- **`$genericblock` under-blocks slightly.** When a page has that exception, a matching
  generic filter is skipped instead of re-running the match against domain-specific filters
  only.
- **Memory.** Parsed filters are plain objects, roughly 60–90 MB of background-page heap for
  the default lists. uBlock Origin compiles to typed arrays to avoid this; doing the same
  here is on the roadmap.
- **Rebuild cost.** A full rebuild of the default lists takes a few hundred milliseconds. It
  happens on startup and on settings changes, never per request.

## Storage layout

| Key | Contents |
| --- | --- |
| `settings` | preferences, allowlist, custom filters, subscription records |
| `stats` | lifetime total, start date, capped per-domain tally |
| `listBody:<id>` | the raw text of one downloaded filter list |

List bodies are separate keys so saving a checkbox never rewrites megabytes of filter
text. Per-tab counters and the activity log are in memory only and are never persisted.

## Message flow

The background page owns all state. The popup, options page and content scripts hold none
and ask for what they need, which keeps validation in one place
(`background/messaging.js`). Message names live in `lib/messages.js`, and the options page
may only write the keys listed in `WRITABLE_SETTINGS`.
