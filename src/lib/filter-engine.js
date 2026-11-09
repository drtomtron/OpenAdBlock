/*
 * OpenAdBlock - network filter matching engine
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A keyword-indexed matcher in the style of adblockpluscore: every filter is
 * filed under one delimited keyword from its pattern, so matching a request
 * only tests the handful of filters that share a keyword with the URL.
 *
 * Pure module - no WebExtension APIs, unit tested under Node.
 */

import { hostMatchesDomain, hostSuffixes } from './domain.js';

/** Token alphabet, matching the way URLs are split below. */
const URL_TOKEN_RE = /[a-z0-9%]{3,}/g;

/**
 * Keyword candidates inside a filter pattern. A candidate must be delimited on
 * both sides *within the pattern*, which guarantees it is also a complete
 * token of any URL it can match - otherwise the index could miss a filter.
 */
const PATTERN_TOKEN_RE = /[^a-z0-9%*][a-z0-9%]{3,}(?=[^a-z0-9%*])/g;

/**
 * Split a URL into lowercase keyword tokens.
 * @param {string} url
 * @returns {string[]}
 */
export function tokenizeUrl(url) {
  const tokens = [];
  const lower = url.toLowerCase();
  URL_TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = URL_TOKEN_RE.exec(lower)) !== null) tokens.push(match[0]);
  return tokens;
}

/**
 * Keyword candidates for a filter pattern.
 * @param {string} pattern
 * @returns {string[]}
 */
export function patternTokens(pattern) {
  const tokens = [];
  const lower = pattern.toLowerCase();
  PATTERN_TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = PATTERN_TOKEN_RE.exec(lower)) !== null) {
    tokens.push(match[0].slice(1));
    // Allow overlapping matches: step back so the delimiter can start the next.
    PATTERN_TOKEN_RE.lastIndex = match.index + match[0].length;
  }
  return tokens;
}

/**
 * Compile (and memoise) a filter's regular expression.
 * @param {object} filter
 * @returns {RegExp}
 */
function filterRegex(filter) {
  let re = filter._re;
  if (re === undefined) {
    try {
      re = new RegExp(filter.regexSource, filter.matchCase ? '' : 'i');
    } catch {
      re = /(?!)/; // never matches
    }
    filter._re = re;
  }
  return re;
}

/**
 * Types a filter applies to when it carries no explicit type option.
 * Following Adblock Plus, a type-less filter never blocks a top level
 * document: only `$document` / `$popup` filters may do that.
 * @param {object} filter
 * @param {string} type
 * @returns {boolean}
 */
function typeApplies(filter, type) {
  if (filter.types) return filter.types.has(type);
  return type !== 'main_frame';
}

/**
 * Evaluate a filter's `$domain=` restriction against the document host.
 * Exclusions win over inclusions, as in Adblock Plus.
 * @param {object} filter
 * @param {string} documentHost
 * @returns {boolean}
 */
function domainApplies(filter, documentHost) {
  const { includeDomains, excludeDomains } = filter;
  if (excludeDomains.length > 0) {
    for (const domain of excludeDomains) {
      if (hostMatchesDomain(documentHost, domain)) return false;
    }
  }
  if (includeDomains.length === 0) return true;
  if (documentHost === '') return false;
  for (const domain of includeDomains) {
    if (hostMatchesDomain(documentHost, domain)) return true;
  }
  return false;
}

/**
 * Full predicate for "does this filter match this request".
 * @param {object} filter
 * @param {{url: string, type: string, documentHost: string, thirdParty: boolean}} request
 * @returns {boolean}
 */
export function filterMatches(filter, request) {
  if (!typeApplies(filter, request.type)) return false;
  if (filter.thirdParty !== null && filter.thirdParty !== request.thirdParty) return false;
  if (!domainApplies(filter, request.documentHost)) return false;
  return filterRegex(filter).test(request.url);
}

/**
 * A keyword bucket index over a set of network filters.
 */
class FilterIndex {
  constructor() {
    /** @type {Map<string, object[]>} */
    this.buckets = new Map();
    /** @type {object[]} filters with no usable keyword - always tested */
    this.unindexed = [];
    this.size = 0;
  }

  /**
   * Build the index. Each filter is filed under its rarest candidate keyword so
   * that buckets stay small and evenly sized.
   * @param {object[]} filters
   */
  build(filters) {
    const candidates = new Array(filters.length);
    const frequency = new Map();

    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i];
      const tokens = filter.isRegex ? [] : patternTokens(filter.pattern);
      candidates[i] = tokens;
      for (const token of tokens) {
        frequency.set(token, (frequency.get(token) || 0) + 1);
      }
    }

    for (let i = 0; i < filters.length; i++) {
      const tokens = candidates[i];
      let best = '';
      let bestCount = Infinity;
      for (const token of tokens) {
        const count = frequency.get(token);
        if (count < bestCount) {
          best = token;
          bestCount = count;
        }
      }
      if (best === '') {
        this.unindexed.push(filters[i]);
      } else {
        const bucket = this.buckets.get(best);
        if (bucket) bucket.push(filters[i]);
        else this.buckets.set(best, [filters[i]]);
      }
      this.size++;
    }
  }

  /**
   * First filter in the index that matches the request, or null.
   * @param {{url: string, type: string, documentHost: string, thirdParty: boolean, tokens: string[]}} request
   * @returns {object|null}
   */
  find(request) {
    for (const token of request.tokens) {
      const bucket = this.buckets.get(token);
      if (bucket === undefined) continue;
      for (const filter of bucket) {
        if (filterMatches(filter, request)) return filter;
      }
    }
    for (const filter of this.unindexed) {
      if (filterMatches(filter, request)) return filter;
    }
    return null;
  }

  /**
   * Every matching filter in the index (used by the request log and tests).
   * @param {object} request
   * @returns {object[]}
   */
  findAll(request) {
    const out = [];
    for (const token of request.tokens) {
      const bucket = this.buckets.get(token);
      if (bucket === undefined) continue;
      for (const filter of bucket) {
        if (filterMatches(filter, request)) out.push(filter);
      }
    }
    for (const filter of this.unindexed) {
      if (filterMatches(filter, request)) out.push(filter);
    }
    return out;
  }
}

/**
 * Matching outcome.
 * @typedef {{action: 'block'|'allow'|'none', filter: object|null}} MatchResult
 */

/**
 * The network blocking engine: blocking filters, exception filters and
 * document-scoped exceptions (`$document`, `$elemhide`, `$generichide`).
 */
export class FilterEngine {
  constructor() {
    this.blocking = new FilterIndex();
    this.allowing = new FilterIndex();
    /** @type {Map<string, object[]>} document scope exceptions by domain */
    this.documentExceptions = new Map();
    /** @type {object[]} document scope exceptions with no domain restriction */
    this.globalDocumentExceptions = [];
    this.counts = { blocking: 0, allowing: 0, documentExceptions: 0 };
  }

  /**
   * Build an engine from parsed filters.
   * @param {object[]} filters output of parseFilter / parseFilterList
   * @returns {FilterEngine}
   */
  static build(filters) {
    const engine = new FilterEngine();
    const blocking = [];
    const allowing = [];

    for (const filter of filters) {
      if (!filter || filter.kind !== 'network') continue;
      if (filter.isDocumentScoped) {
        engine.addDocumentException(filter);
        continue;
      }
      if (filter.isException) allowing.push(filter);
      else blocking.push(filter);
    }

    engine.blocking.build(blocking);
    engine.allowing.build(allowing);
    engine.counts.blocking = blocking.length;
    engine.counts.allowing = allowing.length;
    return engine;
  }

  /**
   * File a `@@...$document,elemhide` style exception by its domains.
   * @param {object} filter
   */
  addDocumentException(filter) {
    this.counts.documentExceptions++;
    const hosts = filter.includeDomains.length > 0
      ? filter.includeDomains
      : hostsFromPattern(filter.pattern);
    // A wildcard domain cannot be filed under a hostname key, so it goes in
    // the always-checked list where domainApplies can match it properly.
    if (hosts.some((host) => host.includes('*'))) {
      this.globalDocumentExceptions.push(filter);
      return;
    }
    if (hosts.length === 0) {
      this.globalDocumentExceptions.push(filter);
      return;
    }
    for (const host of hosts) {
      const list = this.documentExceptions.get(host);
      if (list) list.push(filter);
      else this.documentExceptions.set(host, [filter]);
    }
  }

  /**
   * Decide what to do with a request.
   *
   * @param {{url: string, type: string, documentHost: string, thirdParty: boolean}} request
   * @returns {MatchResult}
   */
  match(request) {
    const context = {
      url: request.url,
      type: request.type,
      documentHost: request.documentHost || '',
      thirdParty: Boolean(request.thirdParty),
      tokens: tokenizeUrl(request.url)
    };

    const blocked = this.blocking.find(context);
    if (blocked === null) return { action: 'none', filter: null };
    // `$important` deliberately outranks exception filters.
    if (blocked.important) return { action: 'block', filter: blocked };
    const allowed = this.allowing.find(context);
    if (allowed !== null) return { action: 'allow', filter: allowed };
    return { action: 'block', filter: blocked };
  }

  /**
   * Document-level exception scopes that apply to a page.
   * @param {string} url page URL
   * @param {string} host page host
   * @returns {Set<string>} some of 'document', 'elemhide', 'generichide', 'genericblock'
   */
  documentScopesFor(url, host) {
    const scopes = new Set();
    const candidates = [...this.globalDocumentExceptions];
    for (const suffix of hostSuffixes(host)) {
      const list = this.documentExceptions.get(suffix);
      if (list) candidates.push(...list);
    }
    if (candidates.length === 0) return scopes;

    for (const filter of candidates) {
      // Document exceptions are matched against the page URL itself.
      if (!domainApplies(filter, host)) continue;
      if (!filterRegex(filter).test(url)) continue;
      for (const scope of filter.docScopes) scopes.add(scope);
    }
    return scopes;
  }
}

/**
 * Pull hostnames out of a `||host^` style pattern so that document exceptions
 * can be indexed even when they carry no `$domain=` option.
 * @param {string} pattern
 * @returns {string[]}
 */
function hostsFromPattern(pattern) {
  if (!pattern.startsWith('||')) return [];
  const rest = pattern.slice(2);
  let end = rest.length;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '/' || ch === '^' || ch === '*' || ch === '?' || ch === '|') {
      end = i;
      break;
    }
  }
  const host = rest.slice(0, end).toLowerCase();
  return host === '' || host.includes('*') ? [] : [host];
}
