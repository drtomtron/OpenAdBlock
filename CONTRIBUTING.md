# Contributing to OpenAdBlock

Thanks for looking. Bug reports, engine fixes, UI work and documentation are all welcome.

## Getting set up

```bash
git clone https://github.com/drtomtron/OpenAdBlock.git
cd OpenAdBlock
npm run check      # lint + tests, no install needed
```

There is deliberately **no `npm install`**: the project has no dependencies, no bundler and
no build step. Node 20+ is the only requirement, and only for the tests and the packaging
script.

To run the extension while you work on it:

1. `about:debugging#/runtime/this-firefox` in Firefox
2. **Load Temporary Add-on…** → pick `src/manifest.json`
3. After editing, press **Reload** on the add-on card. Background changes need a reload;
   content script changes also need the page reloaded.
4. **Inspect** on the add-on card opens devtools for the background page, where errors
   from the blocker show up.

## House rules

**No runtime dependencies.** An ad blocker sees every request on every site. The smaller
and more readable the supply chain, the easier it is to trust and to review on AMO. A
dependency needs a very good reason.

**No telemetry, ever.** No counters sent anywhere, no "anonymous" pings, no remote config.
This is not negotiable; see [docs/PRIVACY.md](docs/PRIVACY.md).

**The core stays pure.** Modules in `src/lib/` must not touch `browser.*`. That is what
lets them be unit tested under plain Node. Anything that needs the WebExtension APIs goes
in `src/background/`, `src/content/` or a UI folder.

**Never approximate a filter option.** If the engine cannot honour an option, reject the
filter and count it as unsupported. A `$redirect` filter demoted to a plain block breaks
pages in ways a user cannot diagnose.

**Treat list data as untrusted.** Filter list titles and descriptions come from downloaded
files. Build DOM nodes with `textContent`; the linter fails on `innerHTML` assignment in
`src/`.

**Engine changes need tests.** Anything touching the parser, the matcher or the cosmetic
index needs a case in `test/`. Every bug found while writing 0.1.0 was found by a test
written alongside the code — including two in the parser and one in the allowlist.

For wiring changes, `test/background.test.js` runs the real background page against a
stubbed `browser` API; add a case there rather than testing by hand only.

## Style

The linter (`npm run lint`) enforces the mechanical parts: LF endings, no tabs, no trailing
whitespace, 120-column code lines, an SPDX header in every source file, no `console.log` in
shipped code, no `eval`, no inline script or event-handler attributes in HTML. Beyond that:

- Two-space indent, semicolons, single quotes.
- JSDoc on exported functions, with types. There is no TypeScript build, so the JSDoc is
  the type documentation.
- Comments explain *why*, not *what*. A comment that restates the code is noise; a comment
  that records a safety property or a trade-off is valuable.
- British or American spelling, consistently within a file.

## Commits and pull requests

- One logical change per pull request.
- Present-tense commit subjects: `Reject $popup-only filters instead of blocking navigation`.
- Run `npm run check` before pushing. CI runs the same thing on Node 20 and 22.
- Mention which filter lists or sites you tested against for a blocking change.

## Reporting a problem with a site

Most "this site is broken" and "this ad gets through" reports are **filter list** issues
rather than engine issues, and reporting them upstream fixes them for every blocker at
once:

- EasyList / EasyPrivacy / Fanboy lists: <https://github.com/easylist/easylist/issues>
- ABP anti-circumvention: <https://github.com/abp-filters/abp-filters-anti-cv/issues>

Open an issue here when:

- a filter is in a list you have enabled and OpenAdBlock is not applying it,
- the activity log shows a decision you cannot explain,
- the problem persists with only EasyList enabled and no custom filters.

Please include the Firefox version, which lists are enabled, the filter involved if you
know it, and the relevant lines from **Settings → Activity log**.

## Security

Please do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Licence

Contributions are accepted under the project's licence, [GPL-3.0-or-later](LICENSE). By
opening a pull request you confirm you have the right to contribute the code under those
terms. Do not paste code from Adblock Plus, AdBlock, uBlock Origin or any other project
into this one, even where licences would allow it — this implementation is original and
should stay that way.
