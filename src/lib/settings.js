/*
 * OpenAdBlock - settings and persistence
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Everything is kept in browser.storage.local. Filter list bodies are stored
 * under their own keys so that saving a preference never rewrites megabytes of
 * filter text.
 */

import { DEFAULT_LISTS, findListDefinition } from './default-lists.js';

export const SETTINGS_KEY = 'settings';
export const STATS_KEY = 'stats';
export const LIST_PREFIX = 'listBody:';
export const SCHEMA_VERSION = 1;

/** @type {Readonly<object>} */
export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  /** Master switch. */
  enabled: true,
  /** Epoch milliseconds; blocking is suspended until then. */
  pausedUntil: 0,
  /** Subscribe to the Acceptable Ads exception list. Off by default. */
  acceptableAds: false,
  /** Hide elements matched by element hiding filters. */
  hideCosmetic: true,
  /** Collapse the empty space left by a blocked image or frame. */
  collapsePlaceholders: true,
  /** Show the blocked count on the toolbar button. */
  showBadge: true,
  /** 'tab' counts the current page, 'total' counts everything since install. */
  badgeScope: 'tab',
  /** 'system' | 'light' | 'dark' */
  theme: 'system',
  /** Keep a bounded in-memory log of recent decisions. */
  logEnabled: true,
  logLimit: 1000,
  /** How often to refresh subscriptions, in hours. */
  updateIntervalHours: 24,
  /** Hostnames where blocking is switched off. */
  allowlist: [],
  /** User written filters, one per line. */
  customFilters: '',
  /** @type {object[]} subscription records */
  subscriptions: [],
  /** Set once the first run page has been shown. */
  onboarded: false
});

/** @type {object|null} */
let cache = null;

/**
 * Build the subscription records for a fresh install.
 * @returns {object[]}
 */
export function defaultSubscriptions() {
  return DEFAULT_LISTS.map((list) => subscriptionRecord(list, list.enabledByDefault));
}

/**
 * @param {import('./default-lists.js').ListDefinition} definition
 * @param {boolean} enabled
 * @returns {object}
 */
export function subscriptionRecord(definition, enabled) {
  return {
    id: definition.id,
    url: definition.url,
    title: definition.title,
    homepage: definition.homepage || '',
    category: definition.category || 'ads',
    description: definition.description || '',
    enabled: Boolean(enabled),
    userAdded: Boolean(definition.userAdded),
    lastUpdate: 0,
    lastAttempt: 0,
    lastError: '',
    expiresHours: 0,
    counts: { network: 0, cosmetic: 0, invalid: 0, unsupported: 0 }
  };
}

/**
 * Load settings from storage, filling in defaults and new built-in lists.
 * @returns {Promise<object>}
 */
export async function loadSettings() {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const saved = stored[SETTINGS_KEY];
  const fresh = !saved;

  const settings = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  settings.allowlist = Array.isArray(settings.allowlist) ? [...settings.allowlist] : [];
  settings.subscriptions = Array.isArray(settings.subscriptions) ? [...settings.subscriptions] : [];

  if (fresh || settings.subscriptions.length === 0) {
    settings.subscriptions = defaultSubscriptions();
  } else {
    // Add built-in lists introduced by a later version, disabled by default so
    // an upgrade never changes what a user has chosen to run.
    const known = new Set(settings.subscriptions.map((item) => item.id));
    for (const list of DEFAULT_LISTS) {
      if (!known.has(list.id)) settings.subscriptions.push(subscriptionRecord(list, false));
    }
    settings.subscriptions = settings.subscriptions.map(repairSubscription);
  }

  // The Acceptable Ads toggle and its subscription are two views of one thing.
  const acceptable = settings.subscriptions.find((item) => item.id === 'acceptable-ads');
  if (acceptable) acceptable.enabled = Boolean(settings.acceptableAds);

  settings.schemaVersion = SCHEMA_VERSION;
  cache = settings;
  if (fresh) await persist();
  return settings;
}

/**
 * Fill in any field missing from a stored subscription record.
 * @param {object} record
 * @returns {object}
 */
function repairSubscription(record) {
  const definition = findListDefinition(record.id);
  return {
    ...subscriptionRecord(
      {
        id: record.id,
        url: record.url || (definition ? definition.url : ''),
        title: record.title || (definition ? definition.title : record.id),
        homepage: record.homepage || (definition ? definition.homepage : ''),
        category: record.category || (definition ? definition.category : 'ads'),
        description: record.description || (definition ? definition.description : ''),
        userAdded: record.userAdded
      },
      record.enabled
    ),
    lastUpdate: Number(record.lastUpdate) || 0,
    lastAttempt: Number(record.lastAttempt) || 0,
    lastError: record.lastError || '',
    expiresHours: Number(record.expiresHours) || 0,
    counts: record.counts || { network: 0, cosmetic: 0, invalid: 0, unsupported: 0 }
  };
}

/**
 * The in-memory settings. `loadSettings` must have run first.
 * @returns {object}
 */
export function getSettings() {
  if (cache === null) throw new Error('settings have not been loaded yet');
  return cache;
}

/**
 * Merge a patch into the settings and save.
 * @param {object} patch
 * @returns {Promise<object>} the updated settings
 */
export async function updateSettings(patch) {
  const settings = getSettings();
  Object.assign(settings, patch);
  await persist();
  return settings;
}

/** Write the current settings to storage. @returns {Promise<void>} */
export async function persist() {
  if (cache === null) return;
  await browser.storage.local.set({ [SETTINGS_KEY]: cache });
}

/**
 * Is blocking suspended right now?
 * @param {object} [settings]
 * @param {number} [now]
 * @returns {boolean}
 */
export function isPaused(settings = cache, now = Date.now()) {
  if (!settings) return false;
  return Number(settings.pausedUntil) > now;
}

/**
 * Is blocking active at all (master switch plus pause)?
 * @param {object} [settings]
 * @param {number} [now]
 * @returns {boolean}
 */
export function isBlockingActive(settings = cache, now = Date.now()) {
  if (!settings) return false;
  return Boolean(settings.enabled) && !isPaused(settings, now);
}

/** @returns {Promise<object>} the persisted statistics blob */
export async function loadStatsData() {
  const stored = await browser.storage.local.get(STATS_KEY);
  return stored[STATS_KEY] || { total: 0, since: Date.now(), domains: {} };
}

/**
 * @param {object} data output of BlockStats#toJSON
 * @returns {Promise<void>}
 */
export async function saveStatsData(data) {
  await browser.storage.local.set({ [STATS_KEY]: data });
}

/**
 * Read a stored filter list body.
 * @param {string} id
 * @returns {Promise<string>}
 */
export async function readListBody(id) {
  const key = LIST_PREFIX + id;
  const stored = await browser.storage.local.get(key);
  return typeof stored[key] === 'string' ? stored[key] : '';
}

/**
 * @param {string} id
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function writeListBody(id, text) {
  await browser.storage.local.set({ [LIST_PREFIX + id]: text });
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function removeListBody(id) {
  await browser.storage.local.remove(LIST_PREFIX + id);
}

/**
 * Replace the whole settings object, used by backup import.
 * @param {object} settings
 * @returns {Promise<object>}
 */
export async function replaceSettings(settings) {
  cache = { ...DEFAULT_SETTINGS, ...settings, schemaVersion: SCHEMA_VERSION };
  cache.subscriptions = (cache.subscriptions || []).map(repairSubscription);
  if (cache.subscriptions.length === 0) cache.subscriptions = defaultSubscriptions();
  await persist();
  return cache;
}
