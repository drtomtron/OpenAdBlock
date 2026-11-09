# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[security advisory form](https://github.com/drtomtron/OpenAdBlock/security/advisories/new)
rather than opening a public issue.

Include what the problem is, how to reproduce it, and what an attacker gains. A proof of
concept helps a great deal. You will get an acknowledgement within a week, and credit in
the release notes unless you would rather not be named.

## What is in scope

OpenAdBlock runs with `<all_urls>` access, so the interesting attack surface is anything a
**page** or a **downloaded filter list** could do to the extension:

- A page breaking out of the content script, or reading extension state it should not see.
- A filter list causing script execution, markup injection in the options page or popup, or
  storage corruption.
- A filter that makes the engine block, allow or rewrite something its syntax does not say
  it should — in particular a filter that disables blocking on a site the user did not
  allowlist.
- Catastrophic regular expression backtracking in the parser or matcher, reachable from
  list content.
- Anything that causes the extension to make a network request other than the filter list
  downloads described in [docs/PRIVACY.md](docs/PRIVACY.md).

## What is not in scope

- A site that is not blocked properly, or an ad that gets through. That is a filter list
  issue or a feature gap — open a normal issue, or report it upstream.
- Fingerprinting that is possible because a blocker is installed at all. Any content
  blocker is detectable; the filter lists handle specific detection scripts.
- Features documented as unsupported in [docs/FILTER_SYNTAX.md](docs/FILTER_SYNTAX.md).

## Supported versions

This is a young project; only the latest release is supported. There is no long-term
support branch yet.

## How the project limits the blast radius

- No runtime dependencies, so no transitive supply chain.
- No `eval`, no `new Function`, no remote code: the linter fails the build on any of them.
- No inline script or event handlers in extension pages, so the default extension CSP is
  never relaxed.
- List-supplied strings are rendered with `textContent` only; the linter fails on
  `innerHTML` assignment in `src/`.
- Filter options the engine cannot honour are rejected rather than approximated.
- Downloads are capped in size, require `https`, and are rejected if the response is HTML
  rather than a filter list. A failed download never replaces the copy already stored.
