/*
 * OpenAdBlock - element hiding (cosmetic filter) index
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Splits element hiding filters into:
 *   - generic rules      ##.banner-ad            applied everywhere
 *   - specific rules     example.com##.promo     applied to one domain tree
 *   - exceptions         example.com#@#.promo    cancel a rule on a domain
 *   - procedural rules   example.com#?#div:has-text(Sponsored)
 *
 * Pure module - no WebExtension APIs, unit tested under Node.
 */

import { hostMatchesDomain, hostSuffixes, normalizeHost } from './domain.js';

/** Maximum selectors per generated CSS rule, so one rule never gets huge. */
const SELECTORS_PER_RULE = 500;

/** The declaration applied to hidden elements. */
export const HIDE_DECLARATION = '{display:none!important}';

export class CosmeticIndex {
  constructor() {
    /** @type {string[]} deduplicated generic selectors */
    this.generic = [];
    /** @type {Map<string, Array<{selector: string, procedural: boolean, exclude: string[]}>>} */
    this.specific = new Map();
    /** @type {Map<string, Set<string>>} */
    this.exceptions = new Map();
    /** @type {Set<string>} exceptions with no domain restriction */
    this.globalExceptions = new Set();
    /** @type {Map<string, Set<string>>} generic selectors disabled on a domain */
    this.genericExclusions = new Map();
    /**
     * Rules whose domain uses the any-public-suffix form (`example.*`). They
     * cannot be filed under a hostname key, so they are matched by scanning.
     * Filter lists hold only a few hundred of these, and lookups are cached.
     * @type {{rules: Array<{domain: string, entry: object}>,
     *         exceptions: Array<{domain: string, selector: string}>,
     *         genericExclusions: Array<{domain: string, selector: string}>}}
     */
    this.wildcard = { rules: [], exceptions: [], genericExclusions: [] };
    this.counts = { generic: 0, specific: 0, exceptions: 0, procedural: 0 };
  }

  /**
   * @param {object[]} filters output of parseFilter / parseFilterList
   * @returns {CosmeticIndex}
   */
  static build(filters) {
    const index = new CosmeticIndex();
    const genericSeen = new Set();

    for (const filter of filters) {
      if (!filter || filter.kind !== 'cosmetic') continue;

      if (filter.isException) {
        index.counts.exceptions++;
        if (filter.includeDomains.length === 0) {
          index.globalExceptions.add(filter.selector);
        } else {
          for (const domain of filter.includeDomains) {
            if (domain.includes('*')) {
              index.wildcard.exceptions.push({ domain, selector: filter.selector });
            } else {
              addToSetMap(index.exceptions, domain, filter.selector);
            }
          }
        }
        continue;
      }

      if (filter.isProcedural) index.counts.procedural++;

      if (filter.includeDomains.length === 0) {
        // Generic rule. `~example.com##.ad` disables it on that domain only.
        if (!genericSeen.has(filter.selector)) {
          genericSeen.add(filter.selector);
          index.generic.push(filter.selector);
          index.counts.generic++;
        }
        for (const domain of filter.excludeDomains) {
          if (domain.includes('*')) {
            index.wildcard.genericExclusions.push({ domain, selector: filter.selector });
          } else {
            addToSetMap(index.genericExclusions, domain, filter.selector);
          }
        }
        continue;
      }

      for (const domain of filter.includeDomains) {
        const entry = {
          selector: filter.selector,
          procedural: filter.isProcedural,
          exclude: filter.excludeDomains
        };
        if (domain.includes('*')) index.wildcard.rules.push({ domain, entry });
        else {
          const list = index.specific.get(domain);
          if (list) list.push(entry);
          else index.specific.set(domain, [entry]);
        }
        index.counts.specific++;
      }
    }

    return index;
  }

  /**
   * Selectors that apply to one hostname.
   *
   * @param {string} host page hostname
   * @param {{genericHide?: boolean, elemHide?: boolean}} [options]
   *   `elemHide: false` disables element hiding entirely (an `$elemhide`
   *   exception), `genericHide: true` keeps only domain specific rules.
   * @returns {{plain: string[], procedural: string[], generic: string[]}}
   */
  getForHost(host, options = {}) {
    const result = { plain: [], procedural: [], generic: [] };
    if (options.elemHide === false) return result;

    const hostname = normalizeHost(host);
    const suffixes = hostSuffixes(hostname);

    const excluded = new Set(this.globalExceptions);
    for (const suffix of suffixes) {
      const set = this.exceptions.get(suffix);
      if (set) for (const selector of set) excluded.add(selector);
    }
    for (const item of this.wildcard.exceptions) {
      if (hostMatchesDomain(hostname, item.domain)) excluded.add(item.selector);
    }

    const seen = new Set();
    const take = (entry) => {
      if (seen.has(entry.selector)) return;
      if (excluded.has(entry.selector)) return;
      if (entry.exclude.length > 0 && entry.exclude.some((d) => hostMatchesDomain(hostname, d))) {
        return;
      }
      seen.add(entry.selector);
      if (entry.procedural) result.procedural.push(entry.selector);
      else result.plain.push(entry.selector);
    };

    for (const suffix of suffixes) {
      const entries = this.specific.get(suffix);
      if (entries === undefined) continue;
      for (const entry of entries) take(entry);
    }
    for (const item of this.wildcard.rules) {
      if (hostMatchesDomain(hostname, item.domain)) take(item.entry);
    }

    if (options.genericHide !== true) {
      const genericOff = new Set();
      for (const suffix of suffixes) {
        const set = this.genericExclusions.get(suffix);
        if (set) for (const selector of set) genericOff.add(selector);
      }
      for (const item of this.wildcard.genericExclusions) {
        if (hostMatchesDomain(hostname, item.domain)) genericOff.add(item.selector);
      }
      if (genericOff.size === 0 && excluded.size === 0) {
        result.generic = this.generic;
      } else {
        result.generic = this.generic.filter(
          (selector) => !genericOff.has(selector) && !excluded.has(selector)
        );
      }
    }

    return result;
  }

  /**
   * True when no host-specific tweak applies to the generic set, meaning the
   * shared generic stylesheet can be reused as-is.
   * @param {string} host
   * @returns {boolean}
   */
  usesDefaultGeneric(host) {
    const hostname = normalizeHost(host);
    if (this.globalExceptions.size > 0) return false;
    for (const suffix of hostSuffixes(hostname)) {
      if (this.exceptions.has(suffix) || this.genericExclusions.has(suffix)) return false;
    }
    for (const item of this.wildcard.exceptions) {
      if (hostMatchesDomain(hostname, item.domain)) return false;
    }
    for (const item of this.wildcard.genericExclusions) {
      if (hostMatchesDomain(hostname, item.domain)) return false;
    }
    return true;
  }
}

/**
 * Turn selectors into CSS text, split so that no single rule carries more than
 * SELECTORS_PER_RULE selectors.
 * @param {string[]} selectors
 * @returns {string} stylesheet text ('' when there is nothing to hide)
 */
export function buildStylesheet(selectors) {
  if (!selectors || selectors.length === 0) return '';
  const rules = [];
  for (let i = 0; i < selectors.length; i += SELECTORS_PER_RULE) {
    rules.push(selectors.slice(i, i + SELECTORS_PER_RULE).join(',') + HIDE_DECLARATION);
  }
  return rules.join('\n');
}

/**
 * @param {Map<string, Set<string>>} map
 * @param {string} key
 * @param {string} value
 */
function addToSetMap(map, key, value) {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}
