/*
 * OpenAdBlock - per-site allowlist
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * An allowlist entry is a hostname. It covers that host and every subdomain,
 * which is what "don't block on this site" means to a user. Prefixing an entry
 * with '=' makes it exact, for the rare case where only one host should be
 * exempt.
 *
 * Pure module - unit tested under Node.
 */

import { hostFromUrl, hostMatchesDomain, normalizeHost } from './domain.js';

/**
 * A hostname (or an IPv6 literal in brackets). Anything else - a scheme such as
 * `about:blank`, a space, an empty label - is not something we can allowlist.
 */
const VALID_HOST = /^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/i;

/**
 * Turn user input (a URL, a host, `*.host` or `=host`) into a stored entry.
 * @param {string} input
 * @returns {string} normalized entry, or '' when the input is unusable
 */
export function normalizeAllowlistEntry(input) {
  let text = String(input || '').trim();
  if (text === '') return '';

  let exact = false;
  if (text.startsWith('=')) {
    exact = true;
    text = text.slice(1).trim();
  }
  if (text.includes('://')) text = hostFromUrl(text);
  if (text.startsWith('*.')) text = text.slice(2);
  if (text.startsWith('.')) text = text.slice(1);

  // Drop anything after a path separator, so "example.com/news" becomes the host.
  const slash = text.indexOf('/');
  if (slash !== -1) text = text.slice(0, slash);

  const host = normalizeHost(text);
  if (host === '' || !VALID_HOST.test(host)) return '';
  return exact ? '=' + host : host;
}

/**
 * Does one allowlist entry cover this host?
 * @param {string} host
 * @param {string} entry
 * @returns {boolean}
 */
export function allowlistEntryMatches(host, entry) {
  const hostname = normalizeHost(host);
  if (hostname === '' || !entry) return false;
  if (entry.startsWith('=')) return hostname === normalizeHost(entry.slice(1));
  return hostMatchesDomain(hostname, entry);
}

/**
 * The entry that exempts this host, or null.
 * @param {string} host
 * @param {string[]} entries
 * @returns {string|null}
 */
export function findAllowlistMatch(host, entries) {
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (allowlistEntryMatches(host, entry)) return entry;
  }
  return null;
}

/**
 * @param {string} host
 * @param {string[]} entries
 * @returns {boolean}
 */
export function isAllowlisted(host, entries) {
  return findAllowlistMatch(host, entries) !== null;
}

/**
 * Add an entry, keeping the list sorted and free of duplicates.
 * @param {string[]} entries
 * @param {string} input
 * @returns {string[]} a new array
 */
export function addAllowlistEntry(entries, input) {
  const entry = normalizeAllowlistEntry(input);
  if (entry === '') return Array.isArray(entries) ? [...entries] : [];
  const next = new Set(Array.isArray(entries) ? entries : []);
  next.add(entry);
  return [...next].sort(compareEntries);
}

/**
 * Remove an entry.
 * @param {string[]} entries
 * @param {string} input
 * @returns {string[]} a new array
 */
export function removeAllowlistEntry(entries, input) {
  const entry = normalizeAllowlistEntry(input);
  const list = Array.isArray(entries) ? entries : [];
  return list.filter((item) => item !== entry && item !== input);
}

/**
 * The equivalent filter text for an allowlist entry, shown in the UI so users
 * can see what the toggle actually does.
 * @param {string} entry
 * @returns {string}
 */
export function allowlistFilterText(entry) {
  if (!entry) return '';
  if (entry.startsWith('=')) return '@@|https://' + entry.slice(1) + '^$document';
  return '@@||' + entry + '^$document';
}

/**
 * Sort exact entries next to their domain, and alphabetically otherwise.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareEntries(a, b) {
  const left = a.startsWith('=') ? a.slice(1) : a;
  const right = b.startsWith('=') ? b.slice(1) : b;
  if (left === right) return a.length - b.length;
  return left < right ? -1 : 1;
}
