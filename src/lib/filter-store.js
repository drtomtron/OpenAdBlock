/*
 * OpenAdBlock - compiles subscriptions into the live matching engines
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CosmeticIndex, buildStylesheet } from './cosmetic-index.js';
import { FilterEngine } from './filter-engine.js';
import { parseFilterList } from './filter-parser.js';
import { getSettings, readListBody } from './settings.js';

/** How many per-host stylesheets to keep around. */
const STYLESHEET_CACHE_SIZE = 64;

export class FilterStore {
  constructor() {
    this.engine = FilterEngine.build([]);
    this.cosmetic = CosmeticIndex.build([]);
    /** Stylesheet for the generic rules that apply to every site. */
    this.genericCss = '';
    this.ready = false;
    this.rebuilding = null;
    this.stats = {
      lists: 0,
      network: 0,
      cosmetic: 0,
      invalid: 0,
      unsupported: 0,
      customFilters: 0,
      buildMs: 0,
      builtAt: 0
    };
    /** @type {Map<string, {css: string, procedural: string[]}>} */
    this.cache = new Map();
  }

  /**
   * Re-read every enabled list and rebuild the engines. Concurrent calls share
   * one rebuild so that a burst of setting changes does not pile up.
   * @returns {Promise<void>}
   */
  async rebuild() {
    if (this.rebuilding) return this.rebuilding;
    this.rebuilding = this.doRebuild().finally(() => {
      this.rebuilding = null;
    });
    return this.rebuilding;
  }

  /** @returns {Promise<void>} */
  async doRebuild() {
    const started = Date.now();
    const settings = getSettings();
    const filters = [];
    const stats = {
      lists: 0, network: 0, cosmetic: 0, invalid: 0, unsupported: 0,
      customFilters: 0, buildMs: 0, builtAt: 0
    };

    for (const record of settings.subscriptions) {
      if (!record.enabled) continue;
      let body = '';
      try {
        body = await readListBody(record.id);
      } catch {
        body = '';
      }
      if (body === '') continue;
      const parsed = parseFilterList(body);
      filters.push(...parsed.filters);
      stats.lists++;
      stats.network += parsed.stats.network;
      stats.cosmetic += parsed.stats.cosmetic;
      stats.invalid += parsed.stats.invalid;
      stats.unsupported += parsed.stats.unsupported;
    }

    if (settings.customFilters && settings.customFilters.trim() !== '') {
      const parsed = parseFilterList(settings.customFilters);
      filters.push(...parsed.filters);
      stats.customFilters = parsed.filters.length;
      stats.network += parsed.stats.network;
      stats.cosmetic += parsed.stats.cosmetic;
      stats.invalid += parsed.stats.invalid;
    }

    this.engine = FilterEngine.build(filters);
    this.cosmetic = CosmeticIndex.build(filters);
    this.genericCss = buildStylesheet(this.cosmetic.generic);
    this.cache.clear();

    stats.buildMs = Date.now() - started;
    stats.builtAt = Date.now();
    this.stats = stats;
    this.ready = true;
  }

  /**
   * Element hiding payload for one document.
   *
   * @param {string} host
   * @param {{elemHide?: boolean, genericHide?: boolean}} [scopes]
   * @returns {{css: string, procedural: string[]}}
   */
  cosmeticFor(host, scopes = {}) {
    const elemHide = scopes.elemHide !== false;
    const genericHide = scopes.genericHide === true;
    if (!elemHide) return { css: '', procedural: [] };

    const key = host + '|' + (genericHide ? 'g' : '-');
    const cached = this.cache.get(key);
    if (cached) return cached;

    const selectors = this.cosmetic.getForHost(host, { elemHide, genericHide });
    let css = buildStylesheet(selectors.plain);
    if (!genericHide) {
      const genericCss = this.cosmetic.usesDefaultGeneric(host)
        ? this.genericCss
        : buildStylesheet(selectors.generic);
      css = genericCss && css ? genericCss + '\n' + css : genericCss || css;
    }

    const payload = { css, procedural: selectors.procedural };
    if (this.cache.size >= STYLESHEET_CACHE_SIZE) {
      // Simple FIFO eviction: the oldest key is the first one inserted.
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, payload);
    return payload;
  }

  /**
   * Counts for the options page.
   * @returns {object}
   */
  getStats() {
    return {
      ...this.stats,
      blockingFilters: this.engine.counts.blocking,
      exceptionFilters: this.engine.counts.allowing,
      documentExceptions: this.engine.counts.documentExceptions,
      genericSelectors: this.cosmetic.counts.generic,
      specificSelectors: this.cosmetic.counts.specific,
      proceduralSelectors: this.cosmetic.counts.procedural,
      ready: this.ready
    };
  }
}
