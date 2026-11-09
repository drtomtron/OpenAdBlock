/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Runs the real background page against a stubbed WebExtension API. The unit
 * tests cover the engine in isolation; this covers the wiring - startup,
 * subscription download, navigation, blocking decisions, the element hiding
 * payload and every message handler.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

const SRC = new URL('../src/', import.meta.url).href;

const LIST_TEXT = [
  '[Adblock Plus 2.0]',
  '! Title: Stub list',
  '! Expires: 4 days',
  '||ads.example.com^',
  '||tracker.test^$third-party',
  '||cdn.example.net/banner.js$script',
  '@@||ads.example.com/ok.js',
  '@@||allowed.test^$document',
  '##.generic-ad',
  'news.test##.sponsored',
  'news.test#?#div:has-text(Sponsored)',
  '||bad.test^$removeparam=x'
].join('\n');

const storage = new Map();
const listeners = { request: [], committed: [], history: [], message: [], alarm: [], tabRemoved: [] };
const calls = { insertCSS: [], sendMessageToTab: [], createdTabs: [], alarms: [] };
let fetchCount = 0;

/**
 * @param {Array<Function>} bucket
 * @returns {{addListener: Function, removeListener: Function}}
 */
function event(bucket) {
  return { addListener: (fn) => bucket.push(fn), removeListener: () => {} };
}

globalThis.browser = {
  storage: {
    local: {
      async get(key) {
        if (key === null || key === undefined) return Object.fromEntries(storage);
        const keys = Array.isArray(key) ? key : [key];
        const out = {};
        for (const name of keys) if (storage.has(name)) out[name] = storage.get(name);
        return out;
      },
      async set(items) {
        for (const [name, value] of Object.entries(items)) storage.set(name, value);
      },
      async remove(key) {
        for (const name of Array.isArray(key) ? key : [key]) storage.delete(name);
      }
    }
  },
  webRequest: { onBeforeRequest: event(listeners.request) },
  webNavigation: {
    onCommitted: event(listeners.committed),
    onHistoryStateUpdated: event(listeners.history)
  },
  tabs: {
    onRemoved: event(listeners.tabRemoved),
    async query() { return [{ id: 1, url: 'https://news.test/article', active: true }]; },
    async insertCSS(tabId, details) { calls.insertCSS.push({ tabId, bytes: (details.code || '').length }); },
    async executeScript() { return []; },
    async sendMessage(tabId, message) { calls.sendMessageToTab.push({ tabId, message }); },
    async create(details) { calls.createdTabs.push(details.url); return { id: 9 }; },
    async reload() {}
  },
  alarms: { create: (name, info) => calls.alarms.push({ name, info }), onAlarm: event(listeners.alarm) },
  contextMenus: { async removeAll() {}, create() {}, onClicked: event([]) },
  browserAction: {
    async setIcon() {}, async setBadgeText() {}, async setBadgeBackgroundColor() {},
    async setBadgeTextColor() {}, async setTitle() {}
  },
  runtime: {
    id: 'openadblock@test',
    onMessage: event(listeners.message),
    async sendMessage() { return undefined; },
    getManifest: () => ({ version: '0.1.0' }),
    getURL: (path) => 'moz-extension://stub/' + path,
    async openOptionsPage() {}
  },
  i18n: { getUILanguage: () => 'de-DE' },
  windows: { onRemoved: event([]) }
};

globalThis.fetch = async () => {
  fetchCount++;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    async text() { return LIST_TEXT + '\n'; }
  };
};

// The background page keeps a timer for persisting counters; let the test
// process exit even though it is running.
const nativeSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms) => {
  const timer = nativeSetInterval(fn, ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
};

let state;
let MSG;

/**
 * Deliver a message to the background page's handler.
 * @param {object} message
 * @param {object} [sender]
 * @returns {Promise<any>}
 */
function send(message, sender) {
  const from = sender || {
    tab: { id: 1, url: 'https://news.test/article' },
    url: 'https://news.test/article',
    frameId: 0
  };
  for (const handler of listeners.message) {
    const result = handler(message, from);
    if (result !== undefined) return result;
  }
  return Promise.resolve(undefined);
}

/**
 * Put a request through the blocking listener.
 * @param {string} url
 * @param {string} type
 * @param {string} [documentUrl]
 * @param {number} [tabId]
 * @returns {object|undefined}
 */
function decide(url, type, documentUrl = 'https://news.test/article', tabId = 1) {
  return listeners.request[0]({ tabId, frameId: 0, url, type, documentUrl });
}

before(async () => {
  await import(SRC + 'background/main.js');
  // Allow startup (settings, downloads, engine build) to finish.
  await new Promise((resolve) => setTimeout(resolve, 500));
  ({ state } = await import(SRC + 'background/state.js'));
  ({ MSG } = await import(SRC + 'lib/messages.js'));

  const commit = { tabId: 1, frameId: 0, url: 'https://news.test/article' };
  listeners.request[0]({ ...commit, type: 'main_frame' });
  for (const handler of listeners.committed) await handler(commit);
});

describe('startup', () => {
  it('builds the engine from the downloaded lists', () => {
    assert.equal(state.store.ready, true);
    assert.ok(fetchCount > 0, 'no list was downloaded');
    assert.ok(state.store.getStats().network > 0);
  });

  it('subscribes to a regional list matching the browser language', () => {
    const settings = storage.get('settings');
    const german = settings.subscriptions.find((item) => item.id === 'easylist-germany');
    assert.ok(german, 'the German supplement was not added for de-DE');
    assert.equal(german.enabled, true);
  });

  it('leaves Acceptable Ads switched off', () => {
    assert.equal(storage.get('settings').acceptableAds, false);
    const record = storage.get('settings').subscriptions.find((item) => item.id === 'acceptable-ads');
    assert.equal(record.enabled, false);
  });

  it('shows the welcome page once and schedules updates', () => {
    assert.equal(calls.createdTabs.length, 1);
    assert.match(calls.createdTabs[0], /welcome\.html$/);
    assert.ok(calls.alarms.length > 0);
  });

  it('injects an element hiding stylesheet when a page commits', () => {
    assert.ok(calls.insertCSS.length > 0);
    assert.ok(calls.insertCSS[0].bytes > 0);
  });
});

describe('blocking decisions', () => {
  it('blocks a request a filter matches', () => {
    assert.deepEqual(decide('https://ads.example.com/tag.js', 'script'), { cancel: true });
  });

  it('honours an exception filter', () => {
    assert.equal(decide('https://ads.example.com/ok.js', 'script'), undefined);
  });

  it('leaves unrelated requests alone', () => {
    assert.equal(decide('https://news.test/app.js', 'script'), undefined);
  });

  it('honours $third-party', () => {
    assert.deepEqual(decide('https://tracker.test/t.gif', 'image'), { cancel: true });
    assert.equal(
      decide('https://tracker.test/t.gif', 'image', 'https://tracker.test/page'),
      undefined
    );
  });

  it('ignores a filter whose options are unsupported', () => {
    assert.equal(decide('https://bad.test/x.js?x=1', 'script'), undefined);
  });

  it('never blocks a top level document with a type-less filter', () => {
    assert.equal(
      decide('https://ads.example.com/', 'main_frame', 'https://ads.example.com/', 7),
      undefined
    );
  });

  it('counts and logs what it blocked', () => {
    const before = state.stats.total;
    const logged = state.log.query({ action: 'block' }).length;
    decide('https://ads.example.com/another.js', 'script');
    assert.equal(state.stats.total, before + 1);
    assert.equal(state.log.query({ action: 'block' }).length, logged + 1);
  });

  it('asks the page to collapse a blocked image', () => {
    const before = calls.sendMessageToTab.length;
    decide('https://ads.example.com/banner.png', 'image');
    assert.equal(calls.sendMessageToTab.length, before + 1);
    assert.match(calls.sendMessageToTab.at(-1).message.type, /collapse/);
  });

  it('resets the page counter on navigation but keeps the total', () => {
    const total = state.stats.total;
    decide('https://news.test/other', 'main_frame', 'https://news.test/other');
    assert.equal(state.stats.tabCount(1), 0);
    assert.equal(state.stats.total, total);
  });

  it('respects a $document exception from a filter list', () => {
    listeners.request[0]({ tabId: 2, frameId: 0, url: 'https://allowed.test/page', type: 'main_frame' });
    assert.equal(
      decide('https://ads.example.com/tag.js', 'script', 'https://allowed.test/page', 2),
      undefined
    );
  });
});

describe('the popup switches', () => {
  it('reports the current page', async () => {
    const popup = await send({ type: MSG.GET_POPUP_STATE });
    assert.equal(popup.host, 'news.test');
    assert.equal(popup.supported, true);
    assert.equal(popup.active, true);
    assert.equal(popup.allowlisted, false);
  });

  it('turns blocking off and on for one site', async () => {
    const off = await send({ type: MSG.TOGGLE_SITE, host: 'news.test', blocked: false });
    assert.equal(off.ok, true);
    assert.equal(decide('https://ads.example.com/tag.js', 'script'), undefined);
    assert.equal((await send({ type: MSG.GET_COSMETIC })).active, false);

    const on = await send({ type: MSG.TOGGLE_SITE, host: 'news.test', blocked: true });
    assert.equal(on.ok, true);
    assert.deepEqual(decide('https://ads.example.com/tag.js', 'script'), { cancel: true });
  });

  it('pauses and resumes everywhere', async () => {
    await send({ type: MSG.SET_PAUSE, minutes: 30 });
    assert.equal(decide('https://ads.example.com/tag.js', 'script'), undefined);
    await send({ type: MSG.SET_PAUSE, minutes: 0 });
    assert.deepEqual(decide('https://ads.example.com/tag.js', 'script'), { cancel: true });
  });
});

describe('element hiding payload', () => {
  it('hands procedural selectors to the content script', async () => {
    const payload = await send({ type: MSG.GET_COSMETIC });
    assert.equal(payload.active, true);
    assert.deepEqual(payload.procedural, ['div:has-text(Sponsored)']);
    assert.equal(payload.collapse, true);
  });
});

describe('user filters', () => {
  it('saves a filter from the element picker', async () => {
    const result = await send({ type: MSG.ADD_USER_FILTER, text: 'news.test##.picked-by-user' });
    assert.equal(result.ok, true);
    assert.ok(storage.get('settings').customFilters.includes('.picked-by-user'));
  });

  it('refuses a filter it cannot parse', async () => {
    const result = await send({ type: MSG.ADD_USER_FILTER, text: 'not a filter at all' });
    assert.equal(result.ok, false);
  });

  it('saves a filter block and reports unusable lines', async () => {
    const result = await send({
      type: MSG.SET_CUSTOM_FILTERS,
      text: '||my.test^\n$$broken filter\n! a comment\n'
    });
    assert.equal(result.ok, true);
    assert.equal(result.problems.length, 1);
    assert.equal(result.problems[0].line, 2);
    assert.deepEqual(decide('https://my.test/a.js', 'script'), { cancel: true });
  });
});

describe('options page state', () => {
  it('reports subscriptions, catalogue and engine counts', async () => {
    const options = await send({ type: MSG.GET_OPTIONS_STATE });
    assert.ok(options.subscriptions.length > 0);
    assert.ok(options.catalogue.length > 0);
    assert.equal(options.engine.ready, true);
    assert.equal(typeof options.stats.total, 'number');
  });

  it('refuses to write a setting that is not exposed', async () => {
    const result = await send({ type: MSG.SET_SETTING, key: 'allowlist', value: [] });
    assert.equal(result.ok, false);
  });

  it('clamps a setting to a sane range', async () => {
    const result = await send({ type: MSG.SET_SETTING, key: 'logLimit', value: 10 ** 9 });
    assert.equal(result.value, 20000);
  });

  it('reports an unknown message instead of throwing', async () => {
    const result = await send({ type: 'nonsense' });
    assert.equal(result.ok, false);
  });
});

describe('backup', () => {
  it('exports and restores settings', async () => {
    const exported = await send({ type: MSG.EXPORT_BACKUP });
    assert.equal(exported.ok, true);
    assert.equal(exported.data.application, 'OpenAdBlock');
    assert.ok(Array.isArray(exported.data.settings.subscriptions));

    const restored = await send({ type: MSG.IMPORT_BACKUP, data: exported.data });
    assert.equal(restored.ok, true);
  });

  it('rejects a file that is not an OpenAdBlock backup', async () => {
    const result = await send({ type: MSG.IMPORT_BACKUP, data: { application: 'Something else' } });
    assert.equal(result.ok, false);
  });

  it('rejects an unknown backup format version', async () => {
    const result = await send({
      type: MSG.IMPORT_BACKUP,
      data: { application: 'OpenAdBlock', format: 99, settings: {} }
    });
    assert.equal(result.ok, false);
  });
});

describe('activity log', () => {
  it('returns entries and can be cleared', async () => {
    decide('https://ads.example.com/logged.js', 'script');
    const response = await send({ type: MSG.GET_LOG, limit: 10 });
    assert.ok(response.entries.length > 0);

    await send({ type: MSG.CLEAR_LOG });
    const cleared = await send({ type: MSG.GET_LOG, limit: 10 });
    assert.equal(cleared.entries.length, 0);
  });
});
