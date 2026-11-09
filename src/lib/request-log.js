/*
 * OpenAdBlock - in-memory request log
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A bounded ring buffer of recent decisions, so a user can see *why* something
 * was blocked or let through. It lives in memory only: nothing about browsing
 * is ever written to disk or sent anywhere.
 *
 * Pure module - unit tested under Node.
 */

/**
 * @typedef {object} LogEntry
 * @property {number} id
 * @property {number} tabId
 * @property {string} url
 * @property {string} type         webRequest resource type
 * @property {string} action       'block' or 'allow'
 * @property {string} filter       the filter text responsible
 * @property {string} documentHost page the request was made from
 * @property {boolean} thirdParty
 * @property {number} time         epoch milliseconds
 */

export class RequestLog {
  /**
   * @param {number} [limit] maximum entries kept overall
   */
  constructor(limit = 1000) {
    this.limit = Math.max(1, limit);
    /** @type {LogEntry[]} */
    this.entries = [];
    this.nextId = 1;
    this.enabled = true;
  }

  /**
   * Record a decision.
   * @param {Omit<LogEntry, 'id'|'time'> & {time?: number}} entry
   * @returns {LogEntry|null} the stored entry, or null when logging is off
   */
  add(entry) {
    if (!this.enabled) return null;
    /** @type {LogEntry} */
    const stored = {
      id: this.nextId++,
      tabId: entry.tabId ?? -1,
      url: entry.url || '',
      type: entry.type || 'other',
      action: entry.action || 'none',
      filter: entry.filter || '',
      documentHost: entry.documentHost || '',
      thirdParty: Boolean(entry.thirdParty),
      time: entry.time ?? Date.now()
    };
    this.entries.push(stored);
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
    return stored;
  }

  /**
   * Most recent entries first.
   * @param {{tabId?: number, action?: string, limit?: number, search?: string}} [query]
   * @returns {LogEntry[]}
   */
  query(query = {}) {
    const limit = query.limit ?? 200;
    const search = query.search ? query.search.toLowerCase() : '';
    const out = [];
    for (let i = this.entries.length - 1; i >= 0 && out.length < limit; i--) {
      const entry = this.entries[i];
      if (query.tabId !== undefined && entry.tabId !== query.tabId) continue;
      if (query.action && entry.action !== query.action) continue;
      if (search && !entry.url.toLowerCase().includes(search) &&
          !entry.filter.toLowerCase().includes(search)) continue;
      out.push(entry);
    }
    return out;
  }

  /**
   * Drop entries, either for one tab or all of them.
   * @param {number} [tabId]
   */
  clear(tabId) {
    if (tabId === undefined) this.entries = [];
    else this.entries = this.entries.filter((entry) => entry.tabId !== tabId);
  }

  /**
   * Change the cap, trimming anything over it.
   * @param {number} limit
   */
  setLimit(limit) {
    this.limit = Math.max(1, Number(limit) || 1);
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
  }

  /** @returns {number} */
  get size() {
    return this.entries.length;
  }
}
