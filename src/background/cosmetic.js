/*
 * OpenAdBlock - element hiding injection
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Plain CSS selectors are injected as a user stylesheet by the browser itself,
 * which is both faster and harder for a page to undo than touching the DOM.
 * Only procedural selectors (`:has-text`, `:upward`) are handed to the content
 * script, because they need to look at the DOM to be evaluated.
 */

import { hostFromUrl } from '../lib/domain.js';
import { getSettings, isBlockingActive } from '../lib/settings.js';
import { state } from './state.js';

/**
 * Element hiding payload for a document, honouring the allowlist, the master
 * switch and any `$elemhide` / `$generichide` exception.
 *
 * @param {number} tabId
 * @param {string} url
 * @returns {{css: string, procedural: string[], active: boolean}}
 */
export function cosmeticPayload(tabId, url) {
  const empty = { css: '', procedural: [], active: false };
  const settings = getSettings();
  if (!settings.hideCosmetic || !isBlockingActive(settings) || !state.store.ready) return empty;
  if (!/^https?:/i.test(url)) return empty;

  const page = tabId >= 0 ? state.pages.get(tabId) : undefined;
  if (page !== undefined) {
    if (page.allowlisted || page.scopes.has('document') || page.scopes.has('elemhide')) {
      return empty;
    }
  }

  const host = hostFromUrl(url);
  if (host === '') return empty;
  const genericHide = Boolean(page && page.scopes.has('generichide'));
  const payload = state.store.cosmeticFor(host, { genericHide });
  return { css: payload.css, procedural: payload.procedural, active: true };
}

/**
 * Inject the stylesheet for one frame.
 *
 * @param {{tabId: number, frameId: number, url: string}} details
 * @returns {Promise<void>}
 */
export async function injectStylesheet(details) {
  const { tabId, frameId, url } = details;
  const payload = cosmeticPayload(tabId, url);
  if (!payload.active || payload.css === '') return;

  try {
    await browser.tabs.insertCSS(tabId, {
      code: payload.css,
      cssOrigin: 'user',
      frameId,
      runAt: 'document_start',
      matchAboutBlank: true
    });
  } catch {
    // The frame may already be gone, or be a page extensions cannot touch.
  }
}
