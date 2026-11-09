/*
 * OpenAdBlock - Adblock Plus filter syntax parser
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Parses the filter syntax used by EasyList and compatible subscriptions:
 *   - network filters            ||ads.example.com^$script,third-party
 *   - exception filters          @@||example.com/ads.js
 *   - element hiding             example.com##.ad-banner
 *   - element hiding exceptions  example.com#@#.ad-banner
 *   - extended selectors         example.com#?#div:has-text(Sponsored)
 *   - hosts-file lines           0.0.0.0 ads.example.com
 *
 * This module is pure: it has no dependency on the WebExtension APIs so that
 * it can be unit tested under plain Node.
 */

import { normalizeHost } from './domain.js';

/** Request types Firefox reports through webRequest. */
export const ALL_REQUEST_TYPES = Object.freeze([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'imageset',
  'object', 'object_subrequest', 'xmlhttprequest', 'xslt', 'xbl', 'ping',
  'beacon', 'xml_dtd', 'font', 'media', 'websocket', 'csp_report',
  'web_manifest', 'speculative', 'json', 'other'
]);

/**
 * Filter option name -> Firefox webRequest resource types.
 * Several option names are aliases kept for list compatibility.
 */
export const TYPE_OPTIONS = Object.freeze({
  script: ['script'],
  image: ['image', 'imageset'],
  stylesheet: ['stylesheet'],
  css: ['stylesheet'],
  object: ['object', 'object_subrequest'],
  'object-subrequest': ['object_subrequest'],
  xmlhttprequest: ['xmlhttprequest'],
  xhr: ['xmlhttprequest'],
  subdocument: ['sub_frame'],
  frame: ['sub_frame'],
  websocket: ['websocket'],
  webrtc: ['other'],
  media: ['media'],
  font: ['font'],
  ping: ['ping', 'beacon', 'csp_report'],
  beacon: ['ping', 'beacon'],
  other: ['other', 'xslt', 'xbl', 'xml_dtd', 'web_manifest', 'speculative', 'json'],
  document: ['main_frame'],
  doc: ['main_frame'],
  // `$popup` needs tab-opener context that webRequest does not give us, so a
  // popup-only filter is parsed but matches nothing. Blocking a top level
  // navigation on a guess would break ordinary browsing; see
  // docs/ARCHITECTURE.md ("Known limitations").
  popup: []
});

/** Options that scope an exception to a document rather than a request. */
export const DOC_SCOPE_OPTIONS = Object.freeze([
  'document', 'elemhide', 'generichide', 'genericblock'
]);

/**
 * Options we knowingly do not implement yet. Filters carrying one of these are
 * reported as unsupported instead of being silently misapplied - a filter that
 * rewrites or redirects a request must not degrade into a plain block.
 */
const UNSUPPORTED_OPTIONS = new Set([
  'csp', 'rewrite', 'redirect', 'redirect-rule', 'removeparam', 'queryprune',
  'replace', 'header', 'sitekey', 'empty', 'mp4', 'inline-script', 'inline-font',
  'cname', 'method', 'to', 'from', 'denyallow', 'strict1p', 'strict3p',
  'badfilter', 'permissions', 'urltransform', 'ipaddress', 'uritransform'
]);

/** Procedural (extended) selector operators the content script implements. */
const SUPPORTED_PROCEDURAL = new Set([
  'has-text', '-abp-contains', 'contains', 'has', '-abp-has', 'upward', 'not'
]);

/** Everything else that looks procedural but we cannot evaluate yet. */
const PROCEDURAL_RE = new RegExp(
  ':(-abp-[a-z-]+|has|has-text|contains|upward|xpath' +
  '|matches-css(?:-before|-after)?|matches-attr|matches-path|min-text-length' +
  '|watch-attr|remove|style|others|shadow|nth-ancestor|if|if-not)\\(',
  'i'
);

const COSMETIC_SEPARATORS = ['#@?#', '#@$#', '#@%#', '#?#', '#$#', '#%#', '#@#', '##'];

const SEPARATOR_CLASS = '(?:[^a-zA-Z0-9_\\-.%]|$)';
const DOMAIN_ANCHOR = '^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?';
const REGEX_SPECIALS = /[.+?${}()|[\]\\/]/;

const HOSTS_LINE_RE = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1|::)[ \t]+([^\s#]+)/;
const PLAIN_HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Escape one character for use inside a regular expression.
 * @param {string} ch
 * @returns {string}
 */
function escapeRegexChar(ch) {
  return REGEX_SPECIALS.test(ch) ? '\\' + ch : ch;
}

/**
 * Translate an Adblock Plus URL pattern into a regular expression source.
 * Handles `*` (wildcard), `^` (separator), `||` (domain anchor) and the
 * leading/trailing `|` anchors.
 * @param {string} pattern
 * @returns {string} regular expression source
 */
export function patternToRegexSource(pattern) {
  let src = '';
  let start = 0;
  let end = pattern.length;

  if (pattern.startsWith('||')) {
    src += DOMAIN_ANCHOR;
    start = 2;
  } else if (pattern.startsWith('|')) {
    src += '^';
    start = 1;
  }

  let anchorEnd = false;
  if (end > start && pattern.endsWith('|')) {
    anchorEnd = true;
    end -= 1;
  }

  for (let i = start; i < end; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      src += '.*';
    } else if (ch === '^') {
      src += SEPARATOR_CLASS;
    } else {
      src += escapeRegexChar(ch);
    }
  }

  if (anchorEnd) src += '$';
  return src;
}

/**
 * Split a comma separated option list, keeping commas that appear inside
 * parentheses or after `=` in a value such as `domain=a.com|b.com`.
 * @param {string} text
 * @returns {string[]}
 */
function splitOptions(text) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.filter((part) => part !== '');
}

/** @param {string} tail @returns {boolean} true when `tail` looks like an option list */
function looksLikeOptions(tail) {
  if (tail === '') return false;
  return splitOptions(tail).every((opt) => /^~?[a-z0-9_-]+(=.*)?$/i.test(opt));
}

/**
 * Split filter text into its pattern and raw option string.
 * @param {string} text
 * @returns {{pattern: string, options: string}}
 */
function splitPatternAndOptions(text) {
  if (text.startsWith('/')) {
    // Possible regular expression filter: /re/ or /re/$options
    const lastSlash = text.lastIndexOf('/');
    if (lastSlash > 0) {
      const tail = text.slice(lastSlash + 1);
      if (tail === '') return { pattern: text, options: '' };
      if (tail.startsWith('$') && looksLikeOptions(tail.slice(1))) {
        return { pattern: text.slice(0, lastSlash + 1), options: tail.slice(1) };
      }
    }
  }
  let idx = text.lastIndexOf('$');
  while (idx !== -1) {
    const tail = text.slice(idx + 1);
    // An empty pattern is legitimate: `$document,domain=example.com` applies to
    // every request on a domain.
    if (looksLikeOptions(tail)) return { pattern: text.slice(0, idx), options: tail };
    if (idx === 0) break;
    idx = text.lastIndexOf('$', idx - 1);
  }
  return { pattern: text, options: '' };
}

/**
 * Parse a `domain=` style value into include/exclude lists.
 * @param {string} value
 * @returns {{include: string[], exclude: string[]}}
 */
function parseDomainList(value) {
  const include = [];
  const exclude = [];
  for (const raw of value.split(/[|,]/)) {
    const entry = raw.trim();
    if (entry === '' || entry === '~') continue;
    if (entry.startsWith('~')) {
      const host = normalizeHost(entry.slice(1));
      if (host) exclude.push(host);
    } else {
      const host = normalizeHost(entry);
      if (host) include.push(host);
    }
  }
  return { include, exclude };
}

/**
 * Parse the option part of a network filter.
 * @param {string} optionText
 * @returns {{ok: true, value: object} | {ok: false, reason: string}}
 */
function parseNetworkOptions(optionText) {
  const result = {
    types: null,
    excludedTypes: null,
    thirdParty: null,
    matchCase: false,
    important: false,
    docScopes: null,
    isPopup: false,
    includeDomains: [],
    excludeDomains: []
  };
  if (optionText === '') return { ok: true, value: result };

  const included = new Set();
  const excluded = new Set();
  let sawTypeOption = false;

  for (const option of splitOptions(optionText)) {
    let name = option;
    let value = null;
    const eq = option.indexOf('=');
    if (eq !== -1) {
      name = option.slice(0, eq);
      value = option.slice(eq + 1);
    }
    let negated = false;
    if (name.startsWith('~')) {
      negated = true;
      name = name.slice(1);
    }
    name = name.trim().toLowerCase();

    if (name === 'domain' || name === 'domains') {
      if (value === null || value === '') return { ok: false, reason: 'empty domain option' };
      const parsed = parseDomainList(value);
      result.includeDomains.push(...parsed.include);
      result.excludeDomains.push(...parsed.exclude);
      continue;
    }
    if (name === 'third-party' || name === '3p') {
      result.thirdParty = !negated;
      continue;
    }
    if (name === 'first-party' || name === '1p') {
      result.thirdParty = negated;
      continue;
    }
    if (name === 'match-case') {
      result.matchCase = !negated;
      continue;
    }
    if (name === 'important') {
      result.important = true;
      continue;
    }
    if (name === 'all') {
      continue; // no type restriction
    }
    if (DOC_SCOPE_OPTIONS.includes(name) && name !== 'document') {
      result.docScopes = result.docScopes || new Set();
      result.docScopes.add(name);
      continue;
    }
    if (name === 'document') {
      result.docScopes = result.docScopes || new Set();
      result.docScopes.add('document');
      sawTypeOption = true;
      (negated ? excluded : included).add('main_frame');
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(TYPE_OPTIONS, name)) {
      if (name === 'popup') result.isPopup = true;
      sawTypeOption = true;
      for (const type of TYPE_OPTIONS[name]) {
        (negated ? excluded : included).add(type);
      }
      continue;
    }
    if (UNSUPPORTED_OPTIONS.has(name)) {
      return { ok: false, reason: 'unsupported option: ' + name };
    }
    return { ok: false, reason: 'unknown option: ' + name };
  }

  if (included.size > 0) {
    for (const type of excluded) included.delete(type);
    result.types = included;
  } else if (excluded.size > 0) {
    result.types = new Set(ALL_REQUEST_TYPES.filter((type) => !excluded.has(type)));
  } else if (sawTypeOption) {
    // A type option was given but maps to nothing we can act on (`$popup`).
    // An empty set matches no request, which is the safe reading.
    result.types = new Set();
  }
  if (excluded.size > 0) result.excludedTypes = excluded;

  return { ok: true, value: result };
}

/**
 * Find the element-hiding separator in a filter, if any.
 * @param {string} text
 * @returns {{index: number, separator: string} | null}
 */
function findCosmeticSeparator(text) {
  let i = text.indexOf('#');
  while (i !== -1) {
    const rest = text.slice(i);
    for (const separator of COSMETIC_SEPARATORS) {
      if (rest.startsWith(separator)) return { index: i, separator };
    }
    i = text.indexOf('#', i + 1);
  }
  return null;
}

/**
 * Parse the domain prefix of an element hiding filter.
 * @param {string} prefix
 * @returns {{include: string[], exclude: string[]}}
 */
function parseCosmeticDomains(prefix) {
  if (prefix.trim() === '') return { include: [], exclude: [] };
  return parseDomainList(prefix);
}

/**
 * Classify a selector as plain CSS or procedural, and reject operators we
 * cannot evaluate.
 * @param {string} selector
 * @returns {{ok: true, procedural: boolean} | {ok: false, reason: string}}
 */
function classifySelector(selector) {
  if (selector.trim() === '') return { ok: false, reason: 'empty selector' };
  let procedural = false;
  let match;
  const re = new RegExp(PROCEDURAL_RE.source, 'gi');
  while ((match = re.exec(selector)) !== null) {
    const op = match[1].toLowerCase();
    const bare = op.startsWith('-abp-') ? op : op;
    if (!SUPPORTED_PROCEDURAL.has(bare)) {
      return { ok: false, reason: 'unsupported selector operator: :' + op };
    }
    if (bare !== 'not' && bare !== 'has') procedural = true;
    if (bare === 'has' || bare === '-abp-has') procedural = true;
  }
  return { ok: true, procedural };
}

/**
 * Parse a single filter line.
 *
 * @param {string} raw one line of a filter list
 * @returns {object} a parsed filter, or `{kind: 'comment'}` / `{kind: 'invalid'}`
 */
export function parseFilter(raw) {
  if (typeof raw !== 'string') return { kind: 'invalid', raw: String(raw), reason: 'not a string' };
  const trimmed = raw.trim();

  if (trimmed === '') return { kind: 'comment', raw };
  if (trimmed.startsWith('!') || trimmed.startsWith('# ') || trimmed === '#') {
    return { kind: 'comment', raw };
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return { kind: 'comment', raw }; // [Adblock Plus 2.0] style header
  }

  // hosts-file syntax, e.g. "0.0.0.0 ads.example.com"
  const hostsMatch = HOSTS_LINE_RE.exec(trimmed);
  if (hostsMatch) {
    const host = normalizeHost(hostsMatch[1]);
    if (host === '' || host === 'localhost' || host === 'localhost.localdomain') {
      return { kind: 'comment', raw };
    }
    return buildNetworkFilter(raw, '||' + host + '^', '', false);
  }

  // A bare hostname is accepted as a domain block, matching hosts-list usage.
  if (PLAIN_HOST_RE.test(trimmed) && !trimmed.includes('#')) {
    return buildNetworkFilter(raw, '||' + normalizeHost(trimmed) + '^', '', false);
  }

  let body = trimmed;
  let isException = false;
  if (body.startsWith('@@')) {
    isException = true;
    body = body.slice(2);
  }

  const cosmetic = findCosmeticSeparator(body);
  if (cosmetic) {
    const prefix = body.slice(0, cosmetic.index);
    // Guard against network filters that merely contain a '#'. A '*' is
    // allowed here because `example.*##.ad` is the any-public-suffix form,
    // which lists use heavily; the other characters never appear in a domain
    // list but do appear in URLs.
    if (!/[/?=&$]/.test(prefix)) {
      const selector = body.slice(cosmetic.index + cosmetic.separator.length);
      return buildCosmeticFilter(raw, prefix, cosmetic.separator, selector);
    }
  }

  if (body === '') return { kind: 'invalid', raw, reason: 'empty filter' };
  const { pattern, options } = splitPatternAndOptions(body);
  return buildNetworkFilter(raw, pattern, options, isException);
}

/**
 * @param {string} raw
 * @param {string} pattern
 * @param {string} optionText
 * @param {boolean} isException
 * @returns {object}
 */
function buildNetworkFilter(raw, pattern, optionText, isException) {
  const parsed = parseNetworkOptions(optionText);
  if (!parsed.ok) return { kind: 'invalid', raw, reason: parsed.reason, unsupported: true };
  const options = parsed.value;

  // A filter with no pattern has to be narrowed by something, or it would apply
  // to every request in the browser.
  if (pattern === '' || pattern === '*') {
    const narrowed = options.includeDomains.length > 0 ||
      (options.docScopes && options.docScopes.size > 0) ||
      (options.types && options.types.size > 0);
    if (!narrowed) return { kind: 'invalid', raw, reason: 'pattern matches everything' };
  }

  const isRegex = pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/');

  // A URL never contains a literal space, so a pattern with one can only be a
  // typo or a line of prose pasted into the filter box. Saying so is more
  // useful than storing a filter that can never match.
  if (!isRegex && /\s/.test(pattern)) {
    return { kind: 'invalid', raw, reason: 'pattern contains whitespace' };
  }

  let regexSource;
  if (isRegex) {
    regexSource = pattern.slice(1, -1);
    try {
      new RegExp(regexSource);
    } catch {
      return { kind: 'invalid', raw, reason: 'invalid regular expression' };
    }
  } else {
    regexSource = patternToRegexSource(pattern);
  }

  const docScopes = options.docScopes;
  const isDocumentScoped = Boolean(isException && docScopes && docScopes.size > 0);

  return {
    kind: 'network',
    raw,
    pattern,
    isException,
    isRegex,
    regexSource,
    matchCase: options.matchCase,
    important: options.important,
    thirdParty: options.thirdParty,
    types: options.types,
    isPopup: options.isPopup,
    docScopes: docScopes ? [...docScopes] : null,
    isDocumentScoped,
    includeDomains: options.includeDomains,
    excludeDomains: options.excludeDomains
  };
}

/**
 * @param {string} raw
 * @param {string} prefix domain list before the separator
 * @param {string} separator one of COSMETIC_SEPARATORS
 * @param {string} selector
 * @returns {object}
 */
function buildCosmeticFilter(raw, prefix, separator, selector) {
  if (separator === '#$#' || separator === '#@$#' || separator === '#%#' || separator === '#@%#') {
    return { kind: 'invalid', raw, reason: 'snippet filters are not supported yet', unsupported: true };
  }
  const body = selector.trim();
  if (body.startsWith('+js(')) {
    return { kind: 'invalid', raw, reason: 'scriptlet filters are not supported yet', unsupported: true };
  }
  const classified = classifySelector(body);
  if (!classified.ok) {
    return { kind: 'invalid', raw, reason: classified.reason, unsupported: true };
  }

  const domains = parseCosmeticDomains(prefix);
  const isException = separator === '#@#' || separator === '#@?#';
  const isProcedural = classified.procedural || separator === '#?#' || separator === '#@?#';

  if (domains.include.length === 0 && isProcedural && !isException) {
    return { kind: 'invalid', raw, reason: 'generic procedural filters are not supported' };
  }

  return {
    kind: 'cosmetic',
    raw,
    selector: body,
    isException,
    isProcedural,
    includeDomains: domains.include,
    excludeDomains: domains.exclude
  };
}

/**
 * Parse a whole subscription body.
 *
 * @param {string} text the downloaded filter list
 * @returns {{meta: object, filters: object[], stats: object}}
 */
export function parseFilterList(text) {
  const meta = { title: '', homepage: '', version: '', expiresHours: 0, redirect: '' };
  const filters = [];
  const stats = { lines: 0, network: 0, cosmetic: 0, comments: 0, invalid: 0, unsupported: 0 };

  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    stats.lines++;
    const trimmed = line.trim();
    if (trimmed.startsWith('!')) {
      readMetaField(meta, trimmed);
      stats.comments++;
      continue;
    }
    const filter = parseFilter(line);
    if (filter.kind === 'comment') {
      stats.comments++;
    } else if (filter.kind === 'invalid') {
      stats.invalid++;
      if (filter.unsupported) stats.unsupported++;
    } else {
      if (filter.kind === 'network') stats.network++;
      else stats.cosmetic++;
      filters.push(filter);
    }
  }
  return { meta, filters, stats };
}

/**
 * Read `! Title:` style metadata out of a comment line.
 * @param {object} meta
 * @param {string} line
 */
function readMetaField(meta, line) {
  const match = /^!\s*([A-Za-z ]+)\s*:\s*(.+)$/.exec(line);
  if (!match) return;
  const key = match[1].trim().toLowerCase();
  const value = match[2].trim();
  if (key === 'title' && !meta.title) meta.title = value;
  else if (key === 'homepage' && !meta.homepage) meta.homepage = value;
  else if (key === 'version' && !meta.version) meta.version = value;
  else if (key === 'redirect' && !meta.redirect) meta.redirect = value;
  else if (key === 'expires' && !meta.expiresHours) {
    const num = /(\d+)\s*(hour|day)/i.exec(value);
    if (num) {
      const amount = Number(num[1]);
      meta.expiresHours = /day/i.test(num[2]) ? amount * 24 : amount;
    }
  }
}
