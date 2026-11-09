# Filter syntax

OpenAdBlock reads Adblock Plus filter syntax, the format EasyList and most public lists are
written in. This page documents exactly what the parser in
[`src/lib/filter-parser.js`](../src/lib/filter-parser.js) accepts, so you know what will
work when you write your own filters under **Settings → My filters**.

## Network filters

Block requests whose URL matches a pattern.

| Pattern | Meaning |
| --- | --- |
| `/banner.gif` | the text appears anywhere in the URL |
| `\|\|ads.example.com^` | that host or any subdomain of it, any scheme |
| `\|https://example.com/x` | the URL starts here |
| `/ads.js\|` | the URL ends here |
| `/ad*/banner` | `*` matches any run of characters |
| `^` | a separator: anything that is not a letter, digit, `_`, `-`, `.` or `%`, or the end of the URL |
| `/^https?:\/\/ad[0-9]+\./` | a regular expression, when wrapped in slashes |

Prefix with `@@` to make it an exception that allows the request instead:

```
||ads.example.com^           block everything from that host
@@||ads.example.com/ok.js    except this one file
```

### Options

Append `$` and a comma separated list.

**Request types** — `script`, `image`, `stylesheet`, `object`, `xmlhttprequest`,
`subdocument`, `document`, `websocket`, `media`, `font`, `ping`, `other`. Aliases `xhr`,
`css`, `frame`, `doc`, `beacon`, `webrtc` and `object-subrequest` are accepted. Prefix with
`~` to exclude a type.

```
||example.com/x$script,image     only scripts and images
||example.com/x$~script          everything except scripts
```

A filter with **no** type option applies to every type *except* a top-level document, so
`||ads.example.com^` will not stop you from visiting that site directly.

**Party** — `third-party` (alias `3p`) matches only requests to a different registrable
domain than the page; `first-party` (alias `1p`, or `~third-party`) only same-site ones.

**Domains** — `$domain=` restricts the filter to the pages it runs on. An entry covers its
subdomains, and `~` excludes.

```
/sponsor$domain=news.test|~free.news.test
```

**Others**

| Option | Effect |
| --- | --- |
| `match-case` | the pattern becomes case sensitive (matching is case insensitive by default) |
| `important` | this filter beats exception filters |
| `all` | no type restriction |
| `document` | on a blocking filter, blocks the page itself; on an exception, disables OpenAdBlock for the page |
| `elemhide` | exception only: stop applying element hiding rules to the page |
| `generichide` | exception only: apply only domain-specific hiding rules |
| `genericblock` | exception only: ignore blocking filters that have no `$domain=` |

### Hosts-file lines

Lines in hosts format are converted automatically, so hosts-style blocklists work:

```
0.0.0.0 ads.example.com      becomes  ||ads.example.com^
ads.example.com              becomes  ||ads.example.com^
```

Entries pointing at `localhost` are ignored.

## Element hiding filters

Hide page elements that a blocked request leaves behind, or that are served inline.

```
example.com##.sponsored-block        hide on example.com and its subdomains
example.com,other.org##.promo        several domains
~safe.example.com##.promo            everywhere except there
##.banner-ad                         everywhere (generic)
example.com#@#.promo                 exception: do not hide this here
```

The part after `##` is an ordinary CSS selector, so anything Firefox understands works —
`#id`, `.class`, `[data-ad-slot]`, `div > span`, `:nth-of-type(2)`.

### Procedural selectors

For things CSS alone cannot express, use `#?#` (or write the operator in a `##` filter):

| Operator | Example | Meaning |
| --- | --- | --- |
| `:has-text(...)` | `div.card:has-text(Sponsored)` | element whose text contains the string |
| `:has-text(/re/i)` | `div:has-text(/spon(sored)?/i)` | same, with a regular expression |
| `:has(...)` | `div.card:has(.ad-label)` | element containing a match |
| `:upward(n)` | `.ad-label:upward(3)` | move up n ancestors and hide that instead |
| `:upward(sel)` | `.ad-label:upward(div.card)` | nearest matching ancestor |

`:-abp-contains()`, `:-abp-has()` and `:contains()` are accepted as aliases.

A generic procedural filter (no domain) is rejected, because evaluating one on every page
is expensive. Give it a domain.

## What is not supported yet

These parse, are counted and are then skipped. The options page shows the count per list,
and nothing is silently turned into a plain block.

- **Scriptlets and snippets**: `##+js(...)`, `#$#`, `#%#`
- **Request rewriting**: `$redirect`, `$redirect-rule`, `$rewrite`, `$removeparam`,
  `$queryprune`, `$replace`, `$urltransform`
- **Header and policy options**: `$csp`, `$header`, `$permissions`, `$sitekey`, `$empty`,
  `$mp4`, `$inline-script`, `$inline-font`
- **Routing options**: `$denyallow`, `$method`, `$to`, `$from`, `$strict1p`, `$strict3p`,
  `$ipaddress`, `$cname`
- **`$badfilter`** (disabling another list's filter)
- **Advanced procedural operators**: `:matches-css()`, `:matches-attr()`, `:xpath()`,
  `:min-text-length()`, `:watch-attr()`, `:remove()`, `:style()`, `:nth-ancestor()`
- **`$popup`**: parsed but inert, see
  [ARCHITECTURE.md](ARCHITECTURE.md#safety-properties)

## Comments

```
! This is a comment
[Adblock Plus 2.0]
! Title: My list
! Expires: 4 days
```

`! Title:`, `! Homepage:`, `! Version:`, `! Expires:` and `! Redirect:` are read as
metadata when a subscription is downloaded.

## Worth knowing

- Matching is **case insensitive** unless you add `$match-case`.
- `*` alone, and any filter whose pattern is empty and carries no `$domain=`, type or
  document scope, is rejected as too broad.
- Element hiding is not a substitute for blocking: the request has still been made. Prefer
  a network filter where one works.
- Your own filters are checked line by line when you save them, and anything unparseable is
  reported with its line number and the reason.
