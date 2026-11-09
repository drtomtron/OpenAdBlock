/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RequestLog } from '../src/lib/request-log.js';
import { BlockStats, formatBadgeCount } from '../src/lib/stats.js';

describe('BlockStats', () => {
  it('counts per tab and in total', () => {
    const stats = new BlockStats();
    stats.recordBlock(1, 'ads.test');
    stats.recordBlock(1, 'ads.test');
    stats.recordBlock(2, 'other.test');
    assert.equal(stats.total, 3);
    assert.equal(stats.tabCount(1), 2);
    assert.equal(stats.tabCount(2), 1);
    assert.equal(stats.tabCount(99), 0);
  });

  it('resets a tab when it navigates but keeps the total', () => {
    const stats = new BlockStats();
    stats.recordBlock(1, 'ads.test');
    stats.resetTab(1);
    assert.equal(stats.tabCount(1), 0);
    assert.equal(stats.total, 1);
  });

  it('forgets a closed tab', () => {
    const stats = new BlockStats();
    stats.recordBlock(5, 'ads.test');
    stats.removeTab(5);
    assert.equal(stats.tabCount(5), 0);
  });

  it('ranks the busiest domains', () => {
    const stats = new BlockStats();
    for (let i = 0; i < 3; i++) stats.recordBlock(1, 'a.test');
    stats.recordBlock(1, 'b.test');
    assert.deepEqual(stats.topDomains(2), [
      { domain: 'a.test', count: 3 },
      { domain: 'b.test', count: 1 }
    ]);
  });

  it('keeps the domain tally bounded', () => {
    const stats = new BlockStats();
    for (let i = 0; i < 500; i++) stats.recordBlock(1, 'host' + i + '.test');
    assert.ok(stats.domains.size <= 400, 'tally grew to ' + stats.domains.size);
  });

  it('round trips through JSON without per-tab state', () => {
    const stats = new BlockStats();
    stats.recordBlock(1, 'a.test');
    const restored = new BlockStats(JSON.parse(JSON.stringify(stats.toJSON())));
    assert.equal(restored.total, 1);
    assert.equal(restored.domains.get('a.test'), 1);
    assert.equal(restored.tabCount(1), 0);
  });

  it('resets everything on request', () => {
    const stats = new BlockStats();
    stats.recordBlock(1, 'a.test');
    stats.reset();
    assert.equal(stats.total, 0);
    assert.equal(stats.domains.size, 0);
  });
});

describe('formatBadgeCount', () => {
  it('keeps the badge short', () => {
    assert.equal(formatBadgeCount(0), '');
    assert.equal(formatBadgeCount(7), '7');
    assert.equal(formatBadgeCount(999), '999');
    assert.equal(formatBadgeCount(1500), '1k');
    assert.equal(formatBadgeCount(250000), '99k+');
  });
});

describe('RequestLog', () => {
  it('stores entries newest first', () => {
    const log = new RequestLog(10);
    log.add({ tabId: 1, url: 'https://a.test/1', type: 'script', action: 'block', filter: '||a.test^' });
    log.add({ tabId: 1, url: 'https://a.test/2', type: 'image', action: 'block', filter: '||a.test^' });
    const entries = log.query();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].url, 'https://a.test/2');
  });

  it('drops the oldest entries past the limit', () => {
    const log = new RequestLog(3);
    for (let i = 0; i < 6; i++) {
      log.add({ tabId: 1, url: 'https://a.test/' + i, type: 'script', action: 'block' });
    }
    assert.equal(log.size, 3);
    assert.equal(log.query()[2].url, 'https://a.test/3');
  });

  it('filters by tab, action and search text', () => {
    const log = new RequestLog();
    log.add({ tabId: 1, url: 'https://a.test/x', type: 'script', action: 'block', filter: '||a.test^' });
    log.add({ tabId: 2, url: 'https://b.test/y', type: 'image', action: 'allow', filter: '@@||b.test^' });
    assert.equal(log.query({ tabId: 2 }).length, 1);
    assert.equal(log.query({ action: 'allow' })[0].url, 'https://b.test/y');
    assert.equal(log.query({ search: 'A.TEST' }).length, 1);
    assert.equal(log.query({ search: '@@' })[0].action, 'allow');
  });

  it('clears one tab or everything', () => {
    const log = new RequestLog();
    log.add({ tabId: 1, url: 'https://a.test/x', type: 'script', action: 'block' });
    log.add({ tabId: 2, url: 'https://b.test/x', type: 'script', action: 'block' });
    log.clear(1);
    assert.equal(log.size, 1);
    log.clear();
    assert.equal(log.size, 0);
  });

  it('records nothing while disabled', () => {
    const log = new RequestLog();
    log.enabled = false;
    assert.equal(log.add({ tabId: 1, url: 'https://a.test/x', type: 'script', action: 'block' }), null);
    assert.equal(log.size, 0);
  });

  it('trims when the limit is lowered', () => {
    const log = new RequestLog(100);
    for (let i = 0; i < 20; i++) log.add({ tabId: 1, url: 'https://a.test/' + i, type: 'script', action: 'block' });
    log.setLimit(5);
    assert.equal(log.size, 5);
  });
});
