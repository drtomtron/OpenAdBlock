/*
 * OpenAdBlock - popup
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MSG } from '../lib/messages.js';

/** Default length of a pause, in minutes. */
const PAUSE_MINUTES = 30;

const element = {
  banner: document.getElementById('status-banner'),
  host: document.getElementById('site-host'),
  state: document.getElementById('site-state'),
  switch: /** @type {HTMLInputElement} */ (document.getElementById('site-switch')),
  countPage: document.getElementById('count-page'),
  countTotal: document.getElementById('count-total'),
  pick: document.getElementById('pick-element'),
  pause: document.getElementById('toggle-pause'),
  reload: document.getElementById('reload-page'),
  filterCount: document.getElementById('filter-count'),
  options: document.getElementById('open-options'),
  log: document.getElementById('open-log')
};

/** @type {object|null} */
let current = null;

element.switch.addEventListener('change', onSiteToggle);
element.pause.addEventListener('click', onPauseToggle);
element.pick.addEventListener('click', onPickElement);
element.reload.addEventListener('click', onReload);
element.options.addEventListener('click', () => openOptions());
element.log.addEventListener('click', (event) => {
  event.preventDefault();
  openOptions('log');
});

void refresh();

/** Fetch state from the background page and draw it. */
async function refresh() {
  try {
    current = await browser.runtime.sendMessage({ type: MSG.GET_POPUP_STATE });
  } catch {
    showBanner('OpenAdBlock is still starting up.', 'warn');
    return;
  }
  render();
}

/** Draw the current state. */
function render() {
  if (!current) return;
  document.documentElement.dataset.theme = current.theme === 'system' ? '' : current.theme;

  element.host.textContent = current.host || 'This page';
  element.countPage.textContent = formatNumber(current.tabBlocked);
  element.countTotal.textContent = formatNumber(current.totalBlocked);
  element.filterCount.textContent = current.ready
    ? formatNumber(current.filterCount) + ' filters active'
    : 'Loading filters…';

  const blockingHere = current.active && !current.allowlisted && current.supported;
  element.switch.checked = blockingHere;
  element.switch.disabled = !current.supported || !current.active;

  if (!current.supported) {
    element.state.textContent = 'OpenAdBlock only runs on web pages.';
  } else if (!current.enabled) {
    element.state.textContent = 'Blocking is switched off in settings.';
  } else if (current.paused) {
    element.state.textContent = 'Paused until ' + formatTime(current.pausedUntil) + '.';
  } else if (current.allowlisted) {
    element.state.textContent = 'Blocking is off for this site.';
  } else if (current.documentException) {
    element.state.textContent = 'A filter list allows ads on this site.';
  } else {
    element.state.textContent = 'Blocking ads and trackers.';
  }

  element.pause.textContent = current.paused ? 'Resume blocking' : 'Pause everywhere';
  element.pick.disabled = !current.supported || !current.active || current.allowlisted;

  if (!current.enabled) showBanner('Blocking is switched off for every site.', 'warn');
  else if (current.paused) showBanner('Paused until ' + formatTime(current.pausedUntil) + '.', 'warn');
  else hideBanner();
}

/** Turn blocking on or off for the current site. */
async function onSiteToggle() {
  if (!current || !current.host) return;
  const blocked = element.switch.checked;
  const result = await browser.runtime.sendMessage({
    type: MSG.TOGGLE_SITE,
    host: current.host,
    blocked
  });
  if (!result || !result.ok) {
    showBanner((result && result.error) || 'That change could not be saved.', 'bad');
    element.switch.checked = !blocked;
    return;
  }
  current.allowlisted = !blocked;
  render();
  element.reload.hidden = false;
}

/** Pause or resume blocking everywhere. */
async function onPauseToggle() {
  if (!current) return;
  const minutes = current.paused ? 0 : PAUSE_MINUTES;
  const result = await browser.runtime.sendMessage({ type: MSG.SET_PAUSE, minutes });
  if (!result || !result.ok) {
    showBanner('That change could not be saved.', 'bad');
    return;
  }
  current.paused = minutes > 0;
  current.pausedUntil = result.pausedUntil;
  current.active = !current.paused && current.enabled;
  render();
  element.reload.hidden = false;
}

/** Start the element picker in the current tab. */
async function onPickElement() {
  if (!current || current.tabId < 0) return;
  const result = await browser.runtime.sendMessage({
    type: MSG.START_PICKER,
    tabId: current.tabId
  });
  if (result && result.ok) {
    window.close();
    return;
  }
  showBanner((result && result.error) || 'The picker could not start here.', 'bad');
}

/** Reload the current tab so the change takes effect. */
async function onReload() {
  if (!current || current.tabId < 0) return;
  await browser.tabs.reload(current.tabId);
  window.close();
}

/**
 * @param {string} [section] options page section to open
 */
function openOptions(section) {
  const url = browser.runtime.getURL('options/options.html' + (section ? '#' + section : ''));
  void browser.tabs.create({ url });
  window.close();
}

/**
 * @param {string} text
 * @param {'warn'|'bad'} [tone]
 */
function showBanner(text, tone = 'warn') {
  element.banner.textContent = text;
  element.banner.dataset.tone = tone;
  element.banner.hidden = false;
}

function hideBanner() {
  element.banner.hidden = true;
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

/**
 * @param {number} timestamp
 * @returns {string}
 */
function formatTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
