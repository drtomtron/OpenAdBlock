# Features, compared

OpenAdBlock was scoped by looking at what [Adblock Plus](https://adblockplus.org/) and
[AdBlock](https://getadblock.com/) advertise and offer. This page records what was adopted,
what was done differently, and what was left out on purpose.

Neither product's source was used; the shared ground is the public EasyList filter syntax.

## Blocking

| Capability | Adblock Plus | AdBlock | OpenAdBlock |
| --- | --- | --- | --- |
| Filter-list based blocking | yes | yes | **yes** |
| Banners, interstitials, pop-up and pop-under scripts | yes | yes | **yes** |
| Video ad requests (YouTube, Twitch, Facebook) | yes | yes | **via the same lists**, see below |
| Third-party tracker blocking | EasyPrivacy | yes | **EasyPrivacy, on by default** |
| Malware host blocking | yes | yes | **optional URLhaus list** |
| Anti-circumvention list | yes | yes | **on by default** |
| Social media button blocking | opt-in list | yes | **opt-in list** |
| Cookie consent notices | Premium | Premium | **free, opt-in list** |
| Newsletter and app-install prompts | opt-in list | yes | **opt-in list** |
| Element hiding, including procedural selectors | yes | yes | **yes** |
| Collapse blocked placeholders | yes | yes | **yes** |
| Scriptlets / snippets | yes | yes | **not yet** ([roadmap](ROADMAP.md)) |
| Request redirection (`$redirect`) | yes | yes | **not yet, and never silently approximated** |

**On video ads.** Blocking them is mostly a filter-list problem, not an engine problem: the
anti-circumvention list carries the rules, and OpenAdBlock subscribes to it by default.
Where those rules rely on scriptlets, OpenAdBlock cannot run them yet, so expect some
platform ads to get through until scriptlet support lands. We would rather say that plainly
than claim parity.

## Control

| Capability | Adblock Plus | AdBlock | OpenAdBlock |
| --- | --- | --- | --- |
| Per-site allowlist switch | yes | yes | **yes, with subdomain or exact-host scope** |
| Pause everywhere | yes | yes | **yes, 30 minutes** |
| Element picker | yes | yes | **yes, with a filter preview before saving** |
| Custom filters | yes | yes | **yes, with per-line error reporting** |
| Subscribe to a list by URL | yes | yes | **yes, https only** |
| Regional lists | yes | yes | **yes, suggested from the browser language** |
| Blocked counter badge | yes | yes | **yes, per page or lifetime** |
| Activity / request log | developer tools | yes | **yes, in the options page** |
| Backup and restore settings | sync | sync | **JSON export and import** |
| Themes | Premium | yes | **free: light, dark, system** |
| Settings sync across devices | account-based | account-based | **no, by design** |

## Where OpenAdBlock differs on purpose

**Acceptable Ads is off.** Both reference products enable it on install. Here it is an
unchecked box that subscribes to the same public exception list. The project runs no
allowlisting programme and takes no money from anyone, so there is nothing to disclose and
nothing to opt out of twice.

**No account, no sync, no telemetry.** There is no server to sync to and no identifier to
sync with. Backup is a file you own. See [PRIVACY.md](PRIVACY.md).

**No paid tier.** Everything the extension can do is in the extension. Cookie notice
blocking and themes are free here.

**No VPN, no browser, no mobile apps.** Out of scope.

**Unsupported filter options are reported, not guessed at.** A `$redirect` filter is
counted as unsupported rather than demoted to a block, because a block and a redirect to a
stub script behave very differently on a real page.

## Current gaps

Honest list of what is missing in 0.1.0:

- No scriptlet or snippet support, which costs some anti-circumvention coverage.
- No `$redirect` / `$removeparam` / `$csp` handling.
- Not yet signed by Mozilla, so installation is temporary or from source.
- UI strings are English only; the i18n plumbing is in place but unused.
- No automated end-to-end browser tests; the unit suite covers the engine, not the
  integration.
- Filters are stored as plain objects, so memory use is higher than uBlock Origin's.

See [ROADMAP.md](ROADMAP.md) for the order these are being worked on.
