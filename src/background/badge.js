/*
 * OpenAdBlock - toolbar button badge and icon
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getSettings, isBlockingActive } from '../lib/settings.js';
import { formatBadgeCount } from '../lib/stats.js';
import { getPage, state } from './state.js';

const BADGE_ACTIVE = '#1d4ed8';
const BADGE_OFF = '#6b7280';
/** Coalesce rapid updates: one repaint per tab per interval. */
const THROTTLE_MS = 300;

/** @type {Map<number, number>} tabId -> timer id */
const pending = new Map();

/**
 * Repaint the button for a tab, at most a few times a second.
 * @param {number} tabId
 */
export function scheduleBadgeUpdate(tabId) {
  if (tabId < 0 || pending.has(tabId)) return;
  const timer = setTimeout(() => {
    pending.delete(tabId);
    void updateBadge(tabId);
  }, THROTTLE_MS);
  pending.set(tabId, timer);
}

/**
 * Repaint the button for a tab immediately.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export async function updateBadge(tabId) {
  if (tabId < 0) return;
  const settings = getSettings();
  const active = isBlockingActive(settings);
  const page = getPage(tabId);
  const paused = !active;
  const off = paused || page.allowlisted;

  try {
    await browser.browserAction.setIcon({
      tabId,
      path: off ? { 19: '../icons/icon-disabled.svg', 38: '../icons/icon-disabled.svg' }
        : { 19: '../icons/icon.svg', 38: '../icons/icon.svg' }
    });

    if (!settings.showBadge) {
      await browser.browserAction.setBadgeText({ tabId, text: '' });
      return;
    }

    const count = settings.badgeScope === 'total'
      ? state.stats.total
      : state.stats.tabCount(tabId);
    await browser.browserAction.setBadgeBackgroundColor({ tabId, color: off ? BADGE_OFF : BADGE_ACTIVE });
    await browser.browserAction.setBadgeTextColor({ tabId, color: '#ffffff' });
    await browser.browserAction.setBadgeText({ tabId, text: off ? '' : formatBadgeCount(count) });
    await browser.browserAction.setTitle({
      tabId,
      title: off
        ? (paused ? 'OpenAdBlock - paused' : 'OpenAdBlock - off on this site')
        : 'OpenAdBlock - ' + count + ' blocked on this page'
    });
  } catch {
    // The tab can disappear between the decision and the repaint.
  }
}

/**
 * Repaint every open tab, after a settings change.
 * @returns {Promise<void>}
 */
export async function updateAllBadges() {
  try {
    const tabs = await browser.tabs.query({});
    await Promise.all(tabs.map((tab) => updateBadge(tab.id)));
  } catch {
    // Nothing we can do if the tab query fails.
  }
}
