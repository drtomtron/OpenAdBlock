/*
 * OpenAdBlock - request blocking
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A blocking webRequest listener. Firefox keeps `webRequestBlocking` in both
 * Manifest V2 and V3, which is what lets an extension cancel a request before
 * it leaves the browser rather than only after the fact.
 */

import { isAllowlisted } from '../lib/allowlist.js';
import { baseDomain, hostFromUrl, isThirdParty } from '../lib/domain.js';
import { getSettings, isBlockingActive } from '../lib/settings.js';
import { scheduleBadgeUpdate } from './badge.js';
import { getPage, state } from './state.js';

/** Schemes worth matching: everything else cannot carry an ad. */
const BLOCKABLE_SCHEME = /^(?:https?|wss?):/i;

/** Types where an empty box is worth collapsing in the page. */
const COLLAPSIBLE_TYPES = new Set([
  'image', 'imageset', 'media', 'object', 'object_subrequest', 'sub_frame'
]);

const CANCEL = { cancel: true };

/**
 * Attach the blocking listener. Navigation and tab events are wired up in
 * main.js so that their ordering is explicit.
 */
export function installBlocker() {
  browser.webRequest.onBeforeRequest.addListener(
    onBeforeRequest,
    { urls: ['<all_urls>'] },
    ['blocking']
  );
}

/**
 * Recalculate the cached page record for a tab: its host, whether the user
 * switched blocking off here, and which document exceptions apply.
 *
 * @param {number} tabId
 * @param {string} url top level document URL
 * @returns {import('./state.js').PageInfo}
 */
export function refreshPage(tabId, url) {
  const page = getPage(tabId);
  const host = hostFromUrl(url);
  const settings = getSettings();

  page.url = url;
  page.host = host;
  page.allowlisted = host !== '' && isAllowlisted(host, settings.allowlist);
  page.scopes = BLOCKABLE_SCHEME.test(url) && state.store.ready
    ? state.store.engine.documentScopesFor(url, host)
    : new Set();

  if (tabId >= 0) state.stats.resetTab(tabId);
  return page;
}

/**
 * Is blocking switched off for this tab, either globally or by the user?
 * @param {number} tabId
 * @returns {boolean}
 */
export function isTabExempt(tabId) {
  const settings = getSettings();
  if (!isBlockingActive(settings)) return true;
  const page = state.pages.get(tabId);
  if (page === undefined) return false;
  return page.allowlisted || page.scopes.has('document');
}

/**
 * The webRequest handler.
 *
 * @param {object} details webRequest request details
 * @returns {object|undefined} `{cancel: true}` to block
 */
function onBeforeRequest(details) {
  const { url, type, tabId } = details;
  if (!BLOCKABLE_SCHEME.test(url)) return undefined;

  const settings = getSettings();
  if (!isBlockingActive(settings) || !state.store.ready) return undefined;

  // A new top level document: refresh what we know about the tab first, so the
  // allowlist and any document exception are in place for its subresources.
  if (type === 'main_frame') {
    const page = refreshPage(tabId, url);
    scheduleBadgeUpdate(tabId);
    if (page.allowlisted || page.scopes.has('document')) return undefined;
  }

  const page = tabId >= 0 ? state.pages.get(tabId) : undefined;
  if (page !== undefined && (page.allowlisted || page.scopes.has('document'))) {
    return undefined;
  }

  const documentHost = resolveDocumentHost(details, page);
  const requestHost = hostFromUrl(url);
  const thirdParty = isThirdParty(requestHost, documentHost);

  const result = state.store.engine.match({ url, type, documentHost, thirdParty });
  if (result.action === 'none') return undefined;

  if (result.action === 'allow') {
    logDecision(details, 'allow', result.filter, documentHost, thirdParty);
    return undefined;
  }

  // `$genericblock` exempts a page from filters that carry no `$domain=`.
  if (page !== undefined && page.scopes.has('genericblock') &&
      result.filter.includeDomains.length === 0) {
    return undefined;
  }

  const blockedDomain = baseDomain(requestHost);
  state.stats.recordBlock(tabId, blockedDomain);
  logDecision(details, 'block', result.filter, documentHost, thirdParty);
  scheduleBadgeUpdate(tabId);

  if (settings.collapsePlaceholders && tabId >= 0 && COLLAPSIBLE_TYPES.has(type)) {
    requestCollapse(tabId, details.frameId, url);
  }

  return CANCEL;
}

/**
 * The host a request is attributed to, used for `$domain=` and third-party
 * decisions. Firefox gives us the immediate document for subresources; we fall
 * back to the top level page when it does not (workers, for instance).
 *
 * @param {object} details
 * @param {import('./state.js').PageInfo|undefined} page
 * @returns {string}
 */
function resolveDocumentHost(details, page) {
  if (details.type === 'main_frame') return hostFromUrl(details.url);
  const direct = hostFromUrl(details.documentUrl || details.originUrl || '');
  if (direct !== '') return direct;
  return page ? page.host : '';
}

/**
 * Ask the content script to collapse the element that made a blocked request.
 * @param {number} tabId
 * @param {number} frameId
 * @param {string} url
 */
function requestCollapse(tabId, frameId, url) {
  browser.tabs
    .sendMessage(tabId, { type: 'openadblock:collapse', url }, { frameId: frameId ?? 0 })
    .catch(() => {
      // No content script in that frame; nothing to collapse.
    });
}

/**
 * Add an entry to the in-memory log.
 * @param {object} details
 * @param {string} action
 * @param {object|null} filter
 * @param {string} documentHost
 * @param {boolean} thirdParty
 */
function logDecision(details, action, filter, documentHost, thirdParty) {
  const settings = getSettings();
  if (!settings.logEnabled) return;
  state.log.add({
    tabId: details.tabId,
    url: details.url,
    type: details.type,
    action,
    filter: filter ? filter.raw.trim() : '',
    documentHost,
    thirdParty
  });
}
