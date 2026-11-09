/*
 * OpenAdBlock - options page
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Note on safety: filter list titles and descriptions come from files we
 * download, so every string from the background page is written with
 * textContent, never innerHTML.
 */

import { MSG } from '../lib/messages.js';

const SECTIONS = ['general', 'lists', 'allowlist', 'filters', 'log', 'backup', 'about'];

const CATEGORY_TITLES = {
  ads: 'Advertising',
  privacy: 'Privacy and tracking',
  annoyances: 'Annoyances',
  security: 'Security',
  exceptions: 'Exceptions',
  regional: 'Regional supplements',
  other: 'Other'
};

const CATEGORY_ORDER = ['ads', 'privacy', 'annoyances', 'security', 'exceptions', 'regional', 'other'];

/** @type {object|null} */
let state = null;
let toastTimer = 0;

void init();

/** Load state and wire up the page. */
async function init() {
  wireNavigation();
  wireSettings();
  wireLists();
  wireAllowlist();
  wireCustomFilters();
  wireLog();
  wireBackup();

  const manifest = browser.runtime.getManifest();
  document.getElementById('about-version').textContent = 'version ' + manifest.version;

  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === MSG.STATE_CHANGED) void load();
  });

  await load();
  showSection(currentSectionFromHash());
}

/** Fetch state from the background page and render everything. */
async function load() {
  state = await browser.runtime.sendMessage({ type: MSG.GET_OPTIONS_STATE });
  applyTheme();
  renderSettings();
  renderLists();
  renderAllowlist();
  renderCustomFilters();
  renderStats();
  renderEngineStats();
}

/* Navigation -------------------------------------------------------------- */

function wireNavigation() {
  for (const tab of document.querySelectorAll('.opt-tab')) {
    tab.addEventListener('click', () => {
      const section = tab.dataset.section;
      window.location.hash = section;
      showSection(section);
    });
  }
  window.addEventListener('hashchange', () => showSection(currentSectionFromHash()));
}

/** @returns {string} */
function currentSectionFromHash() {
  const hash = window.location.hash.replace('#', '');
  return SECTIONS.includes(hash) ? hash : 'general';
}

/**
 * @param {string} section
 */
function showSection(section) {
  for (const name of SECTIONS) {
    const panel = document.getElementById('section-' + name);
    const tab = document.querySelector('.opt-tab[data-section="' + name + '"]');
    const selected = name === section;
    if (panel) panel.hidden = !selected;
    if (tab) tab.setAttribute('aria-selected', String(selected));
  }
  if (section === 'log') void refreshLog();
}

/* General settings -------------------------------------------------------- */

function wireSettings() {
  for (const input of document.querySelectorAll('[data-setting]')) {
    input.addEventListener('change', async () => {
      const key = input.dataset.setting;
      const value = input.type === 'checkbox' ? input.checked : input.value;
      const result = await browser.runtime.sendMessage({ type: MSG.SET_SETTING, key, value });
      if (!result || !result.ok) {
        toast((result && result.error) || 'That setting could not be saved.', 'bad');
        return;
      }
      if (key === 'theme') {
        state.settings.theme = result.value;
        applyTheme();
      }
      if (key === 'acceptableAds') await load();
      toast('Saved.');
    });
  }
}

function renderSettings() {
  const settings = state.settings;
  for (const input of document.querySelectorAll('[data-setting]')) {
    const key = input.dataset.setting;
    if (!(key in settings)) continue;
    if (input.type === 'checkbox') input.checked = Boolean(settings[key]);
    else input.value = String(settings[key]);
  }
  const subtitle = document.getElementById('header-subtitle');
  subtitle.textContent = settings.enabled
    ? 'Free and open-source blocking for Firefox'
    : 'Blocking is currently switched off';
}

function applyTheme() {
  const theme = state && state.settings ? state.settings.theme : 'system';
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
}

/* Filter lists ------------------------------------------------------------ */

function wireLists() {
  document.getElementById('update-lists').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Updating…';
    const result = await browser.runtime.sendMessage({ type: MSG.UPDATE_SUBSCRIPTIONS, force: true });
    button.disabled = false;
    button.textContent = 'Update now';
    if (result && result.failed && result.failed.length > 0) {
      toast(result.failed.length + ' list(s) could not be updated.', 'bad');
    } else {
      toast('Filter lists updated.');
    }
    await load();
  });

  document.getElementById('add-list-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('add-list-url');
    const url = input.value.trim();
    if (url === '') return;
    toast('Downloading the list…', 'info');
    const result = await browser.runtime.sendMessage({ type: MSG.ADD_SUBSCRIPTION, url });
    if (!result || !result.ok) {
      toast((result && result.error) || 'That list could not be added.', 'bad');
      return;
    }
    input.value = '';
    toast('List added.');
    await load();
  });
}

function renderLists() {
  const container = document.getElementById('list-groups');
  container.textContent = '';

  const bySubscription = new Map(state.subscriptions.map((item) => [item.id, item]));
  /** @type {Map<string, object[]>} */
  const groups = new Map();

  const push = (category, entry) => {
    const key = CATEGORY_ORDER.includes(category) ? category : 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  };

  for (const definition of state.catalogue) {
    const record = bySubscription.get(definition.id);
    push(definition.category, { ...definition, ...(record || {}), subscribed: Boolean(record) });
    bySubscription.delete(definition.id);
  }
  // Anything left is a list the user added by URL.
  for (const record of bySubscription.values()) {
    push(record.userAdded ? 'other' : record.category, { ...record, subscribed: true });
  }

  let enabledCount = 0;
  for (const category of CATEGORY_ORDER) {
    const entries = groups.get(category);
    if (!entries || entries.length === 0) continue;

    const group = document.createElement('div');
    group.className = 'opt-group';
    const heading = document.createElement('h3');
    heading.textContent = CATEGORY_TITLES[category] || category;
    group.appendChild(heading);

    for (const entry of entries) {
      if (entry.enabled) enabledCount++;
      group.appendChild(renderListItem(entry));
    }
    container.appendChild(group);
  }

  const userAdded = state.subscriptions.filter((item) => item.userAdded).length;
  const total = state.catalogue.length + userAdded;
  const summary = document.getElementById('lists-summary');
  summary.textContent = enabledCount + ' of ' + total + ' lists enabled, ' +
    formatNumber(state.engine.network) + ' blocking rules and ' +
    formatNumber(state.engine.cosmetic) + ' hiding rules compiled.';
}

/**
 * @param {object} entry
 * @returns {HTMLElement}
 */
function renderListItem(entry) {
  const row = document.createElement('div');
  row.className = 'opt-list-item';

  const label = document.createElement('label');
  label.className = 'oab-switch';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = Boolean(entry.enabled);
  const track = document.createElement('span');
  track.className = 'oab-track';
  track.setAttribute('aria-hidden', 'true');
  const hidden = document.createElement('span');
  hidden.className = 'oab-visually-hidden';
  hidden.textContent = 'Enable ' + entry.title;
  label.append(checkbox, track, hidden);

  checkbox.addEventListener('change', async () => {
    const result = await browser.runtime.sendMessage({
      type: MSG.SET_SUBSCRIPTION_ENABLED,
      id: entry.id,
      enabled: checkbox.checked
    });
    if (!result || !result.ok) {
      toast((result && result.error) || 'That list could not be changed.', 'bad');
      checkbox.checked = !checkbox.checked;
      return;
    }
    if (result.error) toast(result.error, 'bad');
    await load();
  });

  const body = document.createElement('div');
  body.className = 'opt-list-body';

  const title = document.createElement('div');
  title.className = 'opt-list-title';
  title.textContent = entry.title || entry.id;
  if (entry.userAdded) {
    const badge = document.createElement('span');
    badge.className = 'opt-badge';
    badge.textContent = 'added by you';
    title.appendChild(badge);
  }
  body.appendChild(title);

  if (entry.description) {
    const description = document.createElement('div');
    description.className = 'opt-list-meta';
    description.textContent = entry.description;
    body.appendChild(description);
  }

  const meta = document.createElement('div');
  meta.className = 'opt-list-meta';
  meta.textContent = describeListState(entry);
  body.appendChild(meta);

  if (entry.lastError) {
    const error = document.createElement('div');
    error.className = 'opt-list-error';
    error.textContent = 'Last update failed: ' + entry.lastError;
    body.appendChild(error);
  }

  if (entry.homepage) {
    const link = document.createElement('a');
    link.href = entry.homepage;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'List homepage';
    link.className = 'opt-list-meta';
    body.appendChild(link);
  }

  row.append(label, body);

  if (entry.userAdded) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'oab-danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      const result = await browser.runtime.sendMessage({ type: MSG.REMOVE_SUBSCRIPTION, id: entry.id });
      if (!result || !result.ok) {
        toast('That list could not be removed.', 'bad');
        return;
      }
      toast('List removed.');
      await load();
    });
    row.appendChild(remove);
  }

  return row;
}

/**
 * @param {object} entry
 * @returns {string}
 */
function describeListState(entry) {
  if (!entry.subscribed) return 'Not subscribed.';
  if (!entry.enabled) return 'Disabled.';
  if (!entry.lastUpdate) return 'Not downloaded yet.';
  const counts = entry.counts || {};
  const parts = ['Updated ' + formatRelative(entry.lastUpdate)];
  if (counts.network || counts.cosmetic) {
    parts.push(formatNumber(counts.network || 0) + ' blocking, ' +
      formatNumber(counts.cosmetic || 0) + ' hiding rules');
  }
  if (counts.unsupported) parts.push(formatNumber(counts.unsupported) + ' rules not supported yet');
  return parts.join(' · ');
}

/* Allowlist --------------------------------------------------------------- */

function wireAllowlist() {
  document.getElementById('add-allow-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('add-allow-host');
    const entry = input.value.trim();
    if (entry === '') return;
    const result = await browser.runtime.sendMessage({ type: MSG.ADD_ALLOWLIST, entry });
    if (!result || !result.ok) {
      toast((result && result.error) || 'That entry could not be added.', 'bad');
      return;
    }
    input.value = '';
    state.settings.allowlist = result.allowlist;
    renderAllowlist();
    toast('Allowlist updated.');
  });
}

function renderAllowlist() {
  const list = document.getElementById('allowlist');
  list.textContent = '';
  const entries = state.settings.allowlist;

  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'opt-entry-empty';
    empty.textContent = 'No sites yet. Use the switch in the toolbar popup to add one.';
    list.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement('li');
    const host = document.createElement('span');
    host.className = 'opt-entry-host';
    host.textContent = entry.startsWith('=') ? entry.slice(1) + ' (exact host only)' : entry;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'oab-danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      const result = await browser.runtime.sendMessage({ type: MSG.REMOVE_ALLOWLIST, entry });
      if (!result || !result.ok) {
        toast('That entry could not be removed.', 'bad');
        return;
      }
      state.settings.allowlist = result.allowlist;
      renderAllowlist();
      toast('Allowlist updated.');
    });
    item.append(host, remove);
    list.appendChild(item);
  }
}

/* Custom filters ---------------------------------------------------------- */

function wireCustomFilters() {
  document.getElementById('save-filters').addEventListener('click', async () => {
    const textarea = document.getElementById('custom-filters');
    const result = await browser.runtime.sendMessage({
      type: MSG.SET_CUSTOM_FILTERS,
      text: textarea.value
    });
    if (!result || !result.ok) {
      toast('Your filters could not be saved.', 'bad');
      return;
    }
    renderProblems(result.problems || []);
    document.getElementById('filters-status').textContent = 'Saved at ' +
      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    toast('Filters saved.');
    await load();
  });
}

function renderCustomFilters() {
  const textarea = document.getElementById('custom-filters');
  if (document.activeElement !== textarea) textarea.value = state.settings.customFilters;
}

/**
 * @param {Array<{line: number, text: string, reason: string}>} problems
 */
function renderProblems(problems) {
  const container = document.getElementById('filter-problems');
  container.textContent = '';
  if (problems.length === 0) {
    container.hidden = true;
    return;
  }

  const heading = document.createElement('strong');
  heading.textContent = problems.length === 1
    ? '1 line was saved but will not be used:'
    : problems.length + ' lines were saved but will not be used:';
  const list = document.createElement('ul');
  for (const problem of problems.slice(0, 20)) {
    const item = document.createElement('li');
    item.textContent = 'Line ' + problem.line + ': ' + problem.reason;
    list.appendChild(item);
  }
  container.append(heading, list);
  container.hidden = false;
}

/* Activity log ------------------------------------------------------------ */

function wireLog() {
  document.getElementById('refresh-log').addEventListener('click', () => void refreshLog());
  document.getElementById('clear-log').addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: MSG.CLEAR_LOG });
    await refreshLog();
    toast('Log cleared.');
  });
  document.getElementById('log-action').addEventListener('change', () => void refreshLog());

  let searchTimer = 0;
  document.getElementById('log-search').addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void refreshLog(), 250);
  });
}

async function refreshLog() {
  const action = document.getElementById('log-action').value;
  const search = document.getElementById('log-search').value.trim();
  const response = await browser.runtime.sendMessage({
    type: MSG.GET_LOG,
    action: action || undefined,
    search: search || undefined,
    limit: 300
  });

  const body = document.getElementById('log-body');
  body.textContent = '';
  const entries = (response && response.entries) || [];

  if (entries.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'opt-entry-empty';
    cell.textContent = response && response.enabled === false
      ? 'Logging is switched off in General settings.'
      : 'Nothing logged yet. Browse a page and come back.';
    row.appendChild(cell);
    body.appendChild(row);
  }

  for (const entry of entries) {
    const row = document.createElement('tr');
    row.append(
      cell(new Date(entry.time).toLocaleTimeString()),
      cell(entry.action === 'block' ? 'Blocked' : 'Allowed', 'opt-action', entry.action),
      cell(entry.type),
      cell(entry.url, 'opt-url'),
      cell(entry.filter, 'opt-filter')
    );
    body.appendChild(row);
  }

  const note = document.getElementById('log-note');
  note.textContent = response
    ? 'Showing ' + entries.length + ' of ' + formatNumber(response.size) + ' entries held in memory.'
    : '';
}

/**
 * @param {string} text
 * @param {string} [className]
 * @param {string} [action]
 * @returns {HTMLTableCellElement}
 */
function cell(text, className, action) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  if (action) td.dataset.action = action;
  return td;
}

/* Backup, statistics and engine info ------------------------------------- */

function wireBackup() {
  document.getElementById('export-backup').addEventListener('click', async () => {
    const result = await browser.runtime.sendMessage({ type: MSG.EXPORT_BACKUP });
    if (!result || !result.ok) {
      toast('The backup could not be created.', 'bad');
      return;
    }
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'openadblock-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    link.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded.');
  });

  document.getElementById('import-backup').addEventListener('change', async (event) => {
    const input = event.currentTarget;
    const file = input.files && input.files[0];
    if (!file) return;
    input.value = '';

    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast('That file is not valid JSON.', 'bad');
      return;
    }
    toast('Restoring and downloading your lists…', 'info');
    const result = await browser.runtime.sendMessage({ type: MSG.IMPORT_BACKUP, data });
    if (!result || !result.ok) {
      toast((result && result.error) || 'The backup could not be restored.', 'bad');
      return;
    }
    await load();
    toast('Settings restored and ' + result.updated + ' list(s) downloaded.');
  });

  document.getElementById('reset-stats').addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: MSG.RESET_STATS });
    await load();
    toast('Counters reset.');
  });
}

function renderStats() {
  const summary = document.getElementById('stats-summary');
  summary.textContent = formatNumber(state.stats.total) + ' requests blocked since ' +
    new Date(state.stats.since).toLocaleDateString() + '.';

  const list = document.getElementById('top-domains');
  list.textContent = '';
  if (state.stats.topDomains.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'opt-entry-empty';
    empty.textContent = 'No blocked domains recorded yet.';
    list.appendChild(empty);
    return;
  }
  for (const item of state.stats.topDomains) {
    const li = document.createElement('li');
    const host = document.createElement('span');
    host.className = 'opt-entry-host';
    host.textContent = item.domain;
    const count = document.createElement('span');
    count.textContent = formatNumber(item.count);
    li.append(host, count);
    list.appendChild(li);
  }
}

function renderEngineStats() {
  const engine = state.engine;
  const rows = [
    ['Lists compiled', formatNumber(engine.lists)],
    ['Blocking filters', formatNumber(engine.blockingFilters)],
    ['Exception filters', formatNumber(engine.exceptionFilters)],
    ['Document exceptions', formatNumber(engine.documentExceptions)],
    ['Generic hiding rules', formatNumber(engine.genericSelectors)],
    ['Site specific hiding rules', formatNumber(engine.specificSelectors)],
    ['Procedural hiding rules', formatNumber(engine.proceduralSelectors)],
    ['Your own filters', formatNumber(engine.customFilters)],
    ['Rules not supported yet', formatNumber(engine.unsupported)],
    ['Last build', engine.builtAt ? formatRelative(engine.builtAt) + ' (' + engine.buildMs + ' ms)' : 'not yet']
  ];

  const container = document.getElementById('engine-stats');
  container.textContent = '';
  for (const [term, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    container.append(dt, dd);
  }
}

/* Helpers ----------------------------------------------------------------- */

/**
 * @param {string} message
 * @param {'good'|'bad'|'info'} [tone]
 */
function toast(message, tone = 'good') {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.dataset.tone = tone;
  element.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    element.hidden = true;
  }, 4000);
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
function formatRelative(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + ' minutes ago';
  const hours = Math.round(minutes / 60);
  if (hours < 36) return hours + ' hours ago';
  return Math.round(hours / 24) + ' days ago';
}
