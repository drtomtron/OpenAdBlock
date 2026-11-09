/*
 * OpenAdBlock - subscription downloading and refreshing
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Downloads are plain anonymous GETs: no cookies, no referrer, no identifiers
 * of any kind. A failed download never discards the copy we already have.
 */

import { findListDefinition } from './default-lists.js';
import { parseFilterList } from './filter-parser.js';
import {
  getSettings, persist, readListBody, removeListBody, subscriptionRecord, writeListBody
} from './settings.js';

/** Refuse absurdly large downloads (EasyList is ~5 MB of text). */
const MAX_LIST_BYTES = 40 * 1024 * 1024;
/** Wait at least this long before retrying a list that failed. */
export const RETRY_AFTER_HOURS = 1;
/** Used when a list does not declare `! Expires:`. */
export const FALLBACK_EXPIRY_HOURS = 24 * 4;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Download and parse one filter list.
 *
 * @param {string} url
 * @returns {Promise<{text: string, meta: object, stats: object, filters: object[]}>}
 * @throws {Error} on a network error, a non-200 response or an unusable body
 */
export async function fetchFilterList(url) {
  let response;
  try {
    response = await fetch(url, {
      cache: 'no-cache',
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer'
    });
  } catch (error) {
    throw new Error('network error: ' + (error && error.message ? error.message : 'unreachable'));
  }
  if (!response.ok) {
    throw new Error('server returned HTTP ' + response.status);
  }

  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_LIST_BYTES) {
    throw new Error('list is larger than the ' + Math.round(MAX_LIST_BYTES / 1048576) + ' MB limit');
  }

  const text = await response.text();
  if (text.length > MAX_LIST_BYTES) {
    throw new Error('list is larger than the ' + Math.round(MAX_LIST_BYTES / 1048576) + ' MB limit');
  }
  const head = text.slice(0, 2048).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    throw new Error('the server returned a web page instead of a filter list');
  }

  const parsed = parseFilterList(text);
  if (parsed.filters.length === 0) {
    throw new Error('no usable filters found in the downloaded file');
  }
  return { text, ...parsed };
}

/**
 * Should this subscription be refreshed?
 *
 * @param {object} record subscription record
 * @param {number} intervalHours user preference
 * @param {number} [now]
 * @returns {boolean}
 */
export function isDue(record, intervalHours, now = Date.now()) {
  if (!record || !record.enabled) return false;
  if (!record.lastUpdate) {
    // Never downloaded: try, but respect the retry backoff after a failure.
    return !record.lastAttempt || now - record.lastAttempt > RETRY_AFTER_HOURS * HOUR_MS;
  }
  if (record.lastError && now - record.lastAttempt < RETRY_AFTER_HOURS * HOUR_MS) return false;

  const declared = Number(record.expiresHours) || FALLBACK_EXPIRY_HOURS;
  const preferred = Number(intervalHours) || 24;
  // Honour the list's own expiry, but never refresh more often than asked.
  const hours = Math.max(preferred, Math.min(declared, 24 * 14));
  return now - record.lastUpdate > hours * HOUR_MS;
}

/**
 * Refresh one subscription, keeping the previous copy if the download fails.
 *
 * @param {string} id
 * @param {{force?: boolean}} [options]
 * @returns {Promise<{updated: boolean, error?: string}>}
 */
export async function updateSubscription(id, options = {}) {
  const settings = getSettings();
  const record = settings.subscriptions.find((item) => item.id === id);
  if (!record) return { updated: false, error: 'unknown subscription' };
  if (!record.enabled && !options.force) return { updated: false };

  record.lastAttempt = Date.now();
  try {
    const result = await fetchFilterList(record.url);
    await writeListBody(record.id, result.text);
    record.lastUpdate = Date.now();
    record.lastError = '';
    record.expiresHours = result.meta.expiresHours || 0;
    // Only adopt the remote title for lists the user added by URL; built-in
    // lists keep the name shown in the catalogue.
    if (record.userAdded && result.meta.title) record.title = result.meta.title;
    if (record.userAdded && result.meta.homepage) record.homepage = result.meta.homepage;
    record.counts = {
      network: result.stats.network,
      cosmetic: result.stats.cosmetic,
      invalid: result.stats.invalid,
      unsupported: result.stats.unsupported
    };
    await persist();
    return { updated: true };
  } catch (error) {
    record.lastError = error && error.message ? error.message : String(error);
    await persist();
    return { updated: false, error: record.lastError };
  }
}

/**
 * Refresh every subscription that is due (or all enabled ones when forced).
 *
 * @param {{force?: boolean}} [options]
 * @returns {Promise<{updated: string[], failed: Array<{id: string, error: string}>}>}
 */
export async function updateDueSubscriptions(options = {}) {
  const settings = getSettings();
  const updated = [];
  const failed = [];

  for (const record of [...settings.subscriptions]) {
    if (!record.enabled) continue;
    if (!options.force && !isDue(record, settings.updateIntervalHours)) continue;
    const result = await updateSubscription(record.id, options);
    if (result.updated) updated.push(record.id);
    else if (result.error) failed.push({ id: record.id, error: result.error });
  }
  return { updated, failed };
}

/**
 * Subscribe to a list by URL.
 *
 * @param {string} url
 * @param {string} [title]
 * @returns {Promise<{ok: boolean, id?: string, error?: string}>}
 */
export async function addSubscription(url, title) {
  const settings = getSettings();
  const trimmed = String(url || '').trim();
  if (!/^https:\/\//i.test(trimmed)) {
    return { ok: false, error: 'Only https:// filter list URLs can be added.' };
  }
  if (settings.subscriptions.some((item) => item.url === trimmed)) {
    return { ok: false, error: 'That list is already in your subscriptions.' };
  }

  const id = 'user-' + hashId(trimmed);
  const record = subscriptionRecord(
    {
      id,
      url: trimmed,
      title: (title && title.trim()) || hostLabel(trimmed),
      homepage: '',
      category: 'ads',
      description: 'Added by URL.',
      userAdded: true
    },
    true
  );
  record.userAdded = true;
  settings.subscriptions.push(record);
  await persist();

  const result = await updateSubscription(id, { force: true });
  if (!result.updated) {
    settings.subscriptions = settings.subscriptions.filter((item) => item.id !== id);
    await persist();
    return { ok: false, error: result.error || 'The list could not be downloaded.' };
  }
  return { ok: true, id };
}

/**
 * Remove a subscription and its stored body.
 * @param {string} id
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function removeSubscription(id) {
  const settings = getSettings();
  const record = settings.subscriptions.find((item) => item.id === id);
  if (!record) return { ok: false, error: 'unknown subscription' };
  if (!record.userAdded) {
    // Built-in lists are disabled rather than deleted, so they can come back.
    record.enabled = false;
    await removeListBody(id);
    await persist();
    return { ok: true };
  }
  settings.subscriptions = settings.subscriptions.filter((item) => item.id !== id);
  await removeListBody(id);
  await persist();
  return { ok: true };
}

/**
 * Enable or disable a subscription, downloading it on first enable.
 * @param {string} id
 * @param {boolean} enabled
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function setSubscriptionEnabled(id, enabled) {
  const settings = getSettings();
  let record = settings.subscriptions.find((item) => item.id === id);

  if (!record) {
    // A list from the catalogue the user has not subscribed to yet, such as a
    // regional supplement.
    const definition = findListDefinition(id);
    if (!definition) return { ok: false, error: 'unknown subscription' };
    record = subscriptionRecord(definition, false);
    settings.subscriptions.push(record);
  }

  record.enabled = Boolean(enabled);
  if (record.id === 'acceptable-ads') settings.acceptableAds = record.enabled;
  await persist();

  if (record.enabled) {
    const body = await readListBody(id);
    if (body === '') {
      const result = await updateSubscription(id, { force: true });
      if (!result.updated) return { ok: true, error: result.error };
    }
  }
  return { ok: true };
}

/**
 * Short, stable identifier for a URL.
 * @param {string} text
 * @returns {string}
 */
function hashId(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * A readable default title for a list added by URL.
 * @param {string} url
 * @returns {string}
 */
function hostLabel(url) {
  try {
    const parsed = new URL(url);
    const file = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
    return file.replace(/\.(txt|dat)$/i, '') + ' (' + parsed.hostname + ')';
  } catch {
    return url;
  }
}
