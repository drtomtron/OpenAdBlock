/*
 * OpenAdBlock - shared background state
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One module holds the singletons so the other background modules can import
 * them without importing each other.
 */

import { FilterStore } from '../lib/filter-store.js';
import { RequestLog } from '../lib/request-log.js';
import { BlockStats } from '../lib/stats.js';

/**
 * @typedef {object} PageInfo
 * @property {string} url          top level document URL
 * @property {string} host         top level document host
 * @property {boolean} allowlisted the user switched blocking off here
 * @property {Set<string>} scopes  document exception scopes from filter lists
 */

export const state = {
  store: new FilterStore(),
  stats: new BlockStats(),
  log: new RequestLog(),
  /** @type {Map<number, PageInfo>} tabId -> current top level page */
  pages: new Map(),
  /** Tabs where the element picker is running. */
  pickerTabs: new Set()
};

/**
 * Replace the statistics object after loading it from storage.
 * @param {BlockStats} stats
 */
export function setStats(stats) {
  state.stats = stats;
}

/**
 * The page record for a tab, created empty when unknown.
 * @param {number} tabId
 * @returns {PageInfo}
 */
export function getPage(tabId) {
  let page = state.pages.get(tabId);
  if (page === undefined) {
    page = { url: '', host: '', allowlisted: false, scopes: new Set() };
    if (tabId >= 0) state.pages.set(tabId, page);
  }
  return page;
}

/**
 * Forget a tab.
 * @param {number} tabId
 */
export function forgetPage(tabId) {
  state.pages.delete(tabId);
  state.pickerTabs.delete(tabId);
  state.stats.removeTab(tabId);
  state.log.clear(tabId);
}
