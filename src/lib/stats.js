/*
 * OpenAdBlock - blocking counters
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Counts are local and aggregate only: a lifetime total, a per-tab count that
 * drives the toolbar badge, and a capped tally of the most frequently blocked
 * domains. No URLs and no browsing history are stored.
 *
 * Pure module - unit tested under Node.
 */

/** Keep the domain tally bounded so storage stays small. */
const MAX_TRACKED_DOMAINS = 400;
const TRIM_TO_DOMAINS = 300;

export class BlockStats {
  /**
   * @param {{total?: number, since?: number, domains?: Record<string, number>}} [initial]
   */
  constructor(initial = {}) {
    this.total = Number(initial.total) || 0;
    this.since = Number(initial.since) || Date.now();
    /** @type {Map<string, number>} blocked domain -> count */
    this.domains = new Map(Object.entries(initial.domains || {}));
    /** @type {Map<number, number>} tabId -> count for the current page */
    this.tabs = new Map();
  }

  /**
   * Record one blocked request.
   * @param {number} tabId
   * @param {string} [blockedDomain] registrable domain of the blocked request
   * @returns {number} the new count for this tab
   */
  recordBlock(tabId, blockedDomain) {
    this.total++;
    const next = (this.tabs.get(tabId) || 0) + 1;
    if (tabId >= 0) this.tabs.set(tabId, next);
    if (blockedDomain) {
      this.domains.set(blockedDomain, (this.domains.get(blockedDomain) || 0) + 1);
      if (this.domains.size > MAX_TRACKED_DOMAINS) this.trimDomains();
    }
    return next;
  }

  /**
   * @param {number} tabId
   * @returns {number}
   */
  tabCount(tabId) {
    return this.tabs.get(tabId) || 0;
  }

  /**
   * Called when a tab starts loading a new page.
   * @param {number} tabId
   */
  resetTab(tabId) {
    this.tabs.set(tabId, 0);
  }

  /**
   * Called when a tab goes away.
   * @param {number} tabId
   */
  removeTab(tabId) {
    this.tabs.delete(tabId);
  }

  /**
   * Most frequently blocked domains, highest first.
   * @param {number} [limit]
   * @returns {Array<{domain: string, count: number}>}
   */
  topDomains(limit = 10) {
    return [...this.domains.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([domain, count]) => ({ domain, count }));
  }

  /** Reset every counter. */
  reset() {
    this.total = 0;
    this.since = Date.now();
    this.domains.clear();
    this.tabs.clear();
  }

  /**
   * Keep only the busiest domains.
   */
  trimDomains() {
    const kept = [...this.domains.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TRIM_TO_DOMAINS);
    this.domains = new Map(kept);
  }

  /**
   * Persistable shape (per-tab counts are deliberately not persisted).
   * @returns {{total: number, since: number, domains: Record<string, number>}}
   */
  toJSON() {
    return {
      total: this.total,
      since: this.since,
      domains: Object.fromEntries(this.domains)
    };
  }
}

/**
 * Format a count for the toolbar badge: Firefox only shows a few characters.
 * @param {number} count
 * @returns {string}
 */
export function formatBadgeCount(count) {
  if (!count || count < 0) return '';
  if (count < 1000) return String(count);
  if (count < 100000) return Math.floor(count / 1000) + 'k';
  return '99k+';
}
