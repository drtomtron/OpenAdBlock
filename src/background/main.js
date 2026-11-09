/*
 * OpenAdBlock - background entry point
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findListDefinition, regionalListsForLanguage } from '../lib/default-lists.js';
import { MSG } from '../lib/messages.js';
import {
  getSettings, loadSettings, loadStatsData, persist, saveStatsData, subscriptionRecord,
  updateSettings
} from '../lib/settings.js';
import { BlockStats } from '../lib/stats.js';
import { updateDueSubscriptions } from '../lib/subscriptions.js';
import { updateAllBadges, updateBadge } from './badge.js';
import { installBlocker, refreshPage } from './blocker.js';
import { injectStylesheet } from './cosmetic.js';
import { installMessaging, rebuildAndRefresh, refreshOpenTabs } from './messaging.js';
import { installSchedule } from './schedule.js';
import { forgetPage, setStats, state } from './state.js';

/** How often the lifetime counters are written to storage. */
const STATS_SAVE_INTERVAL_MS = 60 * 1000;

const MENU_BLOCK_ELEMENT = 'openadblock:block-element';
const MENU_OPTIONS = 'openadblock:options';

/** Start everything up. */
async function main() {
  const settings = await loadSettings();

  const statsData = await loadStatsData();
  setStats(new BlockStats(statsData));
  state.log.enabled = settings.logEnabled;
  state.log.setLimit(settings.logLimit);

  installBlocker();
  installMessaging();
  installNavigationListeners();
  installContextMenu();
  installStatsPersistence();
  installSchedule(() => rebuildAndRefresh());

  // Build from whatever is already cached so blocking starts immediately.
  await state.store.rebuild();
  await refreshOpenTabs();
  await updateAllBadges();

  if (!settings.onboarded) await firstRun();
  else await catchUpSubscriptions();
}

/** Navigation and tab bookkeeping. */
function installNavigationListeners() {
  browser.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) {
      refreshPage(details.tabId, details.url);
      void updateBadge(details.tabId);
    }
    void injectStylesheet(details);
  });

  // Single page apps change URL without a new document.
  browser.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return;
    refreshPage(details.tabId, details.url);
    void updateBadge(details.tabId);
  });

  browser.tabs.onRemoved.addListener((tabId) => forgetPage(tabId));
}

/** Right-click entries. */
function installContextMenu() {
  if (!browser.contextMenus) return;
  browser.contextMenus.removeAll().then(() => {
    browser.contextMenus.create({
      id: MENU_BLOCK_ELEMENT,
      title: 'Block an element on this page',
      contexts: ['page', 'image', 'video', 'audio', 'frame']
    });
    browser.contextMenus.create({
      id: MENU_OPTIONS,
      title: 'OpenAdBlock settings',
      contexts: ['browser_action', 'page']
    });
  }, () => {
    // contextMenus.removeAll can reject while the browser is still starting.
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === MENU_OPTIONS) {
      await browser.runtime.openOptionsPage();
      return;
    }
    if (info.menuItemId === MENU_BLOCK_ELEMENT && tab && tab.id !== undefined) {
      await browser.runtime.sendMessage({ type: MSG.START_PICKER, tabId: tab.id })
        .catch(() => undefined);
    }
  });
}

/** Persist the lifetime counters periodically rather than on every block. */
function installStatsPersistence() {
  let lastTotal = state.stats.total;
  setInterval(() => {
    if (state.stats.total === lastTotal) return;
    lastTotal = state.stats.total;
    void saveStatsData(state.stats.toJSON());
  }, STATS_SAVE_INTERVAL_MS);

  if (browser.windows && browser.windows.onRemoved) {
    browser.windows.onRemoved.addListener(() => {
      void saveStatsData(state.stats.toJSON());
    });
  }
}

/**
 * First run: subscribe to a regional supplement for the browser language,
 * download the default lists and open the welcome page.
 * @returns {Promise<void>}
 */
async function firstRun() {
  const settings = getSettings();
  try {
    const language = browser.i18n.getUILanguage();
    for (const id of regionalListsForLanguage(language)) {
      if (settings.subscriptions.some((item) => item.id === id)) continue;
      const definition = findListDefinition(id);
      if (definition) settings.subscriptions.push(subscriptionRecord(definition, true));
    }
    await persist();
  } catch {
    // A missing i18n API is not worth failing startup over.
  }

  await updateDueSubscriptions({ force: true });
  await updateSettings({ onboarded: true });
  await rebuildAndRefresh();

  try {
    await browser.tabs.create({ url: browser.runtime.getURL('pages/welcome.html') });
  } catch {
    // Opening a tab can fail during a silent install; not fatal.
  }
}

/**
 * Refresh anything that went stale while the browser was closed.
 * @returns {Promise<void>}
 */
async function catchUpSubscriptions() {
  const result = await updateDueSubscriptions();
  if (result.updated.length > 0) await rebuildAndRefresh();
}

main().catch((error) => {
  console.error('OpenAdBlock failed to start:', error);
});
