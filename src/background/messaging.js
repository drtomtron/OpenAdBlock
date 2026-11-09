/*
 * OpenAdBlock - message handling
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The background page is the single owner of state. Every UI surface and
 * content script goes through these handlers, which keeps validation in one
 * place.
 */

import {
  addAllowlistEntry, normalizeAllowlistEntry, removeAllowlistEntry
} from '../lib/allowlist.js';
import { ALL_KNOWN_LISTS } from '../lib/default-lists.js';
import { hostFromUrl } from '../lib/domain.js';
import { parseFilter } from '../lib/filter-parser.js';
import { MSG, WRITABLE_SETTINGS } from '../lib/messages.js';
import {
  getSettings, isBlockingActive, isPaused, persist, replaceSettings, saveStatsData, updateSettings
} from '../lib/settings.js';
import { BlockStats } from '../lib/stats.js';
import {
  addSubscription, removeSubscription, setSubscriptionEnabled, updateDueSubscriptions
} from '../lib/subscriptions.js';
import { updateAllBadges, updateBadge } from './badge.js';
import { refreshPage } from './blocker.js';
import { cosmeticPayload } from './cosmetic.js';
import { rescheduleUpdates } from './schedule.js';
import { setStats, state } from './state.js';

/** Register the message listener. */
export function installMessaging() {
  browser.runtime.onMessage.addListener((message, sender) => {
    if (!message || typeof message.type !== 'string') return undefined;
    return handleMessage(message, sender);
  });
}

/**
 * @param {object} message
 * @param {object} sender
 * @returns {Promise<any>}
 */
async function handleMessage(message, sender) {
  switch (message.type) {
    case MSG.GET_COSMETIC:
      return handleGetCosmetic(sender);

    case MSG.GET_POPUP_STATE:
      return handlePopupState();

    case MSG.GET_OPTIONS_STATE:
      return handleOptionsState();

    case MSG.SET_SETTING:
      return handleSetSetting(message.key, message.value);

    case MSG.TOGGLE_SITE:
      return handleToggleSite(message.host, message.blocked);

    case MSG.SET_PAUSE:
      return handleSetPause(message.minutes);

    case MSG.ADD_ALLOWLIST:
      return handleAllowlistChange('add', message.entry);

    case MSG.REMOVE_ALLOWLIST:
      return handleAllowlistChange('remove', message.entry);

    case MSG.SET_CUSTOM_FILTERS:
      return handleSetCustomFilters(message.text);

    case MSG.ADD_USER_FILTER:
      return handleAddUserFilter(message.text);

    case MSG.SET_SUBSCRIPTION_ENABLED: {
      const result = await setSubscriptionEnabled(message.id, message.enabled);
      await rebuildAndRefresh();
      return result;
    }

    case MSG.ADD_SUBSCRIPTION: {
      const result = await addSubscription(message.url, message.title);
      if (result.ok) await rebuildAndRefresh();
      return result;
    }

    case MSG.REMOVE_SUBSCRIPTION: {
      const result = await removeSubscription(message.id);
      if (result.ok) await rebuildAndRefresh();
      return result;
    }

    case MSG.UPDATE_SUBSCRIPTIONS: {
      const result = await updateDueSubscriptions({ force: message.force !== false });
      await rebuildAndRefresh();
      return result;
    }

    case MSG.GET_LOG:
      return {
        entries: state.log.query({
          tabId: message.tabId,
          action: message.action,
          search: message.search,
          limit: message.limit
        }),
        size: state.log.size,
        enabled: getSettings().logEnabled
      };

    case MSG.CLEAR_LOG:
      state.log.clear(message.tabId);
      return { ok: true };

    case MSG.RESET_STATS: {
      const fresh = new BlockStats({ total: 0, since: Date.now() });
      setStats(fresh);
      await saveStatsData(fresh.toJSON());
      await updateAllBadges();
      return { ok: true };
    }

    case MSG.EXPORT_BACKUP:
      return handleExportBackup();

    case MSG.IMPORT_BACKUP:
      return handleImportBackup(message.data);

    case MSG.START_PICKER:
      return handleStartPicker(message.tabId);

    default:
      return { ok: false, error: 'unknown message: ' + message.type };
  }
}

/**
 * Element hiding payload for a content script.
 * @param {object} sender
 * @returns {object}
 */
function handleGetCosmetic(sender) {
  const settings = getSettings();
  const tabId = sender.tab ? sender.tab.id : -1;
  const url = sender.url || (sender.tab ? sender.tab.url : '');
  const payload = cosmeticPayload(tabId, url);
  return {
    active: payload.active,
    procedural: payload.procedural,
    collapse: payload.active && settings.collapsePlaceholders,
    // The content script applies plain CSS itself only in frames the browser
    // would not let us reach with insertCSS (about:blank, srcdoc).
    css: sender.frameId > 0 && /^(?:about|blob|data):/i.test(url) ? payload.css : ''
  };
}

/**
 * State for the popup: the current tab, its counters and the switches.
 * @returns {Promise<object>}
 */
async function handlePopupState() {
  const settings = getSettings();
  let tab = null;
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0] || null;
  } catch {
    tab = null;
  }

  const url = tab ? tab.url || '' : '';
  const host = hostFromUrl(url);
  const supported = /^https?:/i.test(url);
  const page = tab ? state.pages.get(tab.id) : undefined;

  return {
    tabId: tab ? tab.id : -1,
    url,
    host,
    supported,
    enabled: settings.enabled,
    paused: isPaused(settings),
    pausedUntil: settings.pausedUntil,
    active: isBlockingActive(settings),
    allowlisted: Boolean(page && page.allowlisted) ||
      (host !== '' && settings.allowlist.some((entry) => normalizeAllowlistEntry(entry) === host)),
    documentException: Boolean(page && page.scopes.has('document')),
    tabBlocked: tab ? state.stats.tabCount(tab.id) : 0,
    totalBlocked: state.stats.total,
    since: state.stats.since,
    theme: settings.theme,
    ready: state.store.ready,
    filterCount: state.store.stats.network + state.store.stats.cosmetic
  };
}

/**
 * State for the options page.
 * @returns {object}
 */
function handleOptionsState() {
  const settings = getSettings();
  return {
    settings: {
      enabled: settings.enabled,
      pausedUntil: settings.pausedUntil,
      acceptableAds: settings.acceptableAds,
      hideCosmetic: settings.hideCosmetic,
      collapsePlaceholders: settings.collapsePlaceholders,
      showBadge: settings.showBadge,
      badgeScope: settings.badgeScope,
      theme: settings.theme,
      logEnabled: settings.logEnabled,
      logLimit: settings.logLimit,
      updateIntervalHours: settings.updateIntervalHours,
      allowlist: [...settings.allowlist],
      customFilters: settings.customFilters
    },
    subscriptions: settings.subscriptions.map((record) => ({ ...record })),
    catalogue: ALL_KNOWN_LISTS.map((list) => ({ ...list })),
    engine: state.store.getStats(),
    stats: {
      total: state.stats.total,
      since: state.stats.since,
      topDomains: state.stats.topDomains(12)
    }
  };
}

/**
 * Write one preference.
 * @param {string} key
 * @param {any} value
 * @returns {Promise<object>}
 */
async function handleSetSetting(key, value) {
  if (!WRITABLE_SETTINGS.includes(key)) {
    return { ok: false, error: 'setting is not writable: ' + key };
  }

  if (key === 'acceptableAds') {
    await setSubscriptionEnabled('acceptable-ads', Boolean(value));
    await updateSettings({ acceptableAds: Boolean(value) });
    await rebuildAndRefresh();
    return { ok: true };
  }

  if (key === 'logLimit') {
    const limit = Math.min(20000, Math.max(50, Number(value) || 1000));
    state.log.setLimit(limit);
    await updateSettings({ logLimit: limit });
    return { ok: true, value: limit };
  }

  if (key === 'updateIntervalHours') {
    const hours = Math.min(24 * 14, Math.max(1, Number(value) || 24));
    await updateSettings({ updateIntervalHours: hours });
    rescheduleUpdates();
    return { ok: true, value: hours };
  }

  if (key === 'badgeScope') {
    const scope = value === 'total' ? 'total' : 'tab';
    await updateSettings({ badgeScope: scope });
    await updateAllBadges();
    return { ok: true, value: scope };
  }

  if (key === 'theme') {
    const theme = ['system', 'light', 'dark'].includes(value) ? value : 'system';
    await updateSettings({ theme });
    return { ok: true, value: theme };
  }

  const booleanValue = Boolean(value);
  await updateSettings({ [key]: booleanValue });
  if (key === 'logEnabled') state.log.enabled = booleanValue;
  if (key === 'enabled' || key === 'showBadge') await updateAllBadges();
  if (key === 'enabled' || key === 'hideCosmetic') await refreshOpenTabs();
  return { ok: true, value: booleanValue };
}

/**
 * The popup's per-site switch.
 * @param {string} host
 * @param {boolean} blocked true to block here, false to allowlist the site
 * @returns {Promise<object>}
 */
async function handleToggleSite(host, blocked) {
  const entry = normalizeAllowlistEntry(host);
  if (entry === '') return { ok: false, error: 'This page cannot be allowlisted.' };
  const settings = getSettings();
  settings.allowlist = blocked
    ? removeAllowlistEntry(settings.allowlist, entry)
    : addAllowlistEntry(settings.allowlist, entry);
  await persist();
  await refreshOpenTabs();
  await updateAllBadges();
  return { ok: true, allowlisted: !blocked, entry };
}

/**
 * Pause or resume blocking everywhere.
 * @param {number} minutes 0 resumes immediately
 * @returns {Promise<object>}
 */
async function handleSetPause(minutes) {
  const amount = Number(minutes) || 0;
  const pausedUntil = amount > 0 ? Date.now() + amount * 60 * 1000 : 0;
  await updateSettings({ pausedUntil });
  await refreshOpenTabs();
  await updateAllBadges();
  return { ok: true, pausedUntil };
}

/**
 * Add or remove an allowlist entry from the options page.
 * @param {'add'|'remove'} action
 * @param {string} input
 * @returns {Promise<object>}
 */
async function handleAllowlistChange(action, input) {
  const settings = getSettings();
  if (action === 'add') {
    const entry = normalizeAllowlistEntry(input);
    if (entry === '') return { ok: false, error: 'That is not a hostname OpenAdBlock can use.' };
    settings.allowlist = addAllowlistEntry(settings.allowlist, entry);
  } else {
    settings.allowlist = removeAllowlistEntry(settings.allowlist, input);
  }
  await persist();
  await refreshOpenTabs();
  await updateAllBadges();
  return { ok: true, allowlist: [...settings.allowlist] };
}

/**
 * Replace the user's own filters, reporting any lines we could not parse.
 * @param {string} text
 * @returns {Promise<object>}
 */
async function handleSetCustomFilters(text) {
  const body = String(text || '');
  const problems = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('!')) continue;
    const parsed = parseFilter(line);
    if (parsed.kind === 'invalid') {
      problems.push({ line: i + 1, text: line, reason: parsed.reason });
    }
  }

  await updateSettings({ customFilters: body });
  await rebuildAndRefresh();
  return { ok: true, problems };
}

/**
 * Append one filter, used by the element picker and the "block this" action.
 * @param {string} text
 * @returns {Promise<object>}
 */
async function handleAddUserFilter(text) {
  const line = String(text || '').trim();
  if (line === '') return { ok: false, error: 'empty filter' };
  const parsed = parseFilter(line);
  if (parsed.kind === 'invalid') return { ok: false, error: parsed.reason };

  const settings = getSettings();
  const existing = settings.customFilters.split(/\r?\n/).map((item) => item.trim());
  if (existing.includes(line)) return { ok: true, duplicate: true };

  const separator = settings.customFilters === '' || settings.customFilters.endsWith('\n') ? '' : '\n';
  await updateSettings({ customFilters: settings.customFilters + separator + line + '\n' });
  await rebuildAndRefresh();
  return { ok: true, filter: line };
}

/**
 * Everything needed to restore this profile elsewhere. Filter list bodies are
 * left out on purpose: they are re-downloaded from their source.
 * @returns {object}
 */
function handleExportBackup() {
  const settings = getSettings();
  return {
    ok: true,
    data: {
      application: 'OpenAdBlock',
      format: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        enabled: settings.enabled,
        acceptableAds: settings.acceptableAds,
        hideCosmetic: settings.hideCosmetic,
        collapsePlaceholders: settings.collapsePlaceholders,
        showBadge: settings.showBadge,
        badgeScope: settings.badgeScope,
        theme: settings.theme,
        logEnabled: settings.logEnabled,
        logLimit: settings.logLimit,
        updateIntervalHours: settings.updateIntervalHours,
        allowlist: [...settings.allowlist],
        customFilters: settings.customFilters,
        subscriptions: settings.subscriptions.map((record) => ({
          id: record.id,
          url: record.url,
          title: record.title,
          enabled: record.enabled,
          userAdded: record.userAdded,
          category: record.category,
          homepage: record.homepage,
          description: record.description
        }))
      }
    }
  };
}

/**
 * Restore a backup produced by handleExportBackup.
 * @param {object} data
 * @returns {Promise<object>}
 */
async function handleImportBackup(data) {
  if (!data || typeof data !== 'object' || data.application !== 'OpenAdBlock') {
    return { ok: false, error: 'This file is not an OpenAdBlock backup.' };
  }
  if (!data.settings || typeof data.settings !== 'object') {
    return { ok: false, error: 'The backup does not contain any settings.' };
  }
  if (Number(data.format) !== 1) {
    return { ok: false, error: 'Unsupported backup format: ' + data.format };
  }

  const incoming = data.settings;
  const cleaned = {
    enabled: Boolean(incoming.enabled),
    acceptableAds: Boolean(incoming.acceptableAds),
    hideCosmetic: incoming.hideCosmetic !== false,
    collapsePlaceholders: incoming.collapsePlaceholders !== false,
    showBadge: incoming.showBadge !== false,
    badgeScope: incoming.badgeScope === 'total' ? 'total' : 'tab',
    theme: ['system', 'light', 'dark'].includes(incoming.theme) ? incoming.theme : 'system',
    logEnabled: incoming.logEnabled !== false,
    logLimit: Math.min(20000, Math.max(50, Number(incoming.logLimit) || 1000)),
    updateIntervalHours: Math.min(336, Math.max(1, Number(incoming.updateIntervalHours) || 24)),
    customFilters: typeof incoming.customFilters === 'string' ? incoming.customFilters : '',
    allowlist: Array.isArray(incoming.allowlist)
      ? incoming.allowlist.map(normalizeAllowlistEntry).filter((entry) => entry !== '')
      : [],
    subscriptions: Array.isArray(incoming.subscriptions) ? incoming.subscriptions : [],
    pausedUntil: 0,
    onboarded: true
  };

  await replaceSettings(cleaned);
  state.log.setLimit(cleaned.logLimit);
  state.log.enabled = cleaned.logEnabled;
  const result = await updateDueSubscriptions({ force: true });
  await rebuildAndRefresh();
  rescheduleUpdates();
  return { ok: true, updated: result.updated.length, failed: result.failed };
}

/**
 * Inject the element picker into a tab.
 * @param {number} tabId
 * @returns {Promise<object>}
 */
async function handleStartPicker(tabId) {
  const id = Number(tabId);
  if (!Number.isInteger(id) || id < 0) return { ok: false, error: 'no tab' };
  try {
    await browser.tabs.insertCSS(id, { file: '/content/picker.css', runAt: 'document_end' });
    await browser.tabs.executeScript(id, { file: '/content/picker.js', runAt: 'document_end' });
    state.pickerTabs.add(id);
    return { ok: true };
  } catch (error) {
    const detail = error && error.message ? ' (' + error.message + ')' : '';
    return { ok: false, error: 'OpenAdBlock cannot run on this page.' + detail };
  }
}

/**
 * Rebuild the engines and bring open tabs back in sync.
 * @returns {Promise<void>}
 */
export async function rebuildAndRefresh() {
  await state.store.rebuild();
  await refreshOpenTabs();
  await updateAllBadges();
  notifyStateChanged();
}

/**
 * Recompute cached page records for every open tab.
 * @returns {Promise<void>}
 */
export async function refreshOpenTabs() {
  try {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id === undefined || !tab.url) continue;
      refreshPage(tab.id, tab.url);
    }
  } catch {
    // Ignore: the next navigation will refresh the record anyway.
  }
}

/** Tell any open UI page that something changed. */
export function notifyStateChanged() {
  browser.runtime.sendMessage({ type: MSG.STATE_CHANGED }).catch(() => {
    // Nothing is listening, which is the normal case.
  });
}

export { updateBadge };
