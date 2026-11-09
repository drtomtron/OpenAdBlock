/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addAllowlistEntry, allowlistEntryMatches, allowlistFilterText, findAllowlistMatch,
  isAllowlisted, normalizeAllowlistEntry, removeAllowlistEntry
} from '../src/lib/allowlist.js';

describe('normalizeAllowlistEntry', () => {
  it('accepts a bare hostname', () => {
    assert.equal(normalizeAllowlistEntry(' Example.COM '), 'example.com');
  });

  it('accepts a full URL and keeps only the host', () => {
    assert.equal(normalizeAllowlistEntry('https://news.example.com/a/b?c=1'), 'news.example.com');
  });

  it('accepts a path on a bare host', () => {
    assert.equal(normalizeAllowlistEntry('example.com/news'), 'example.com');
  });

  it('strips wildcard and leading dot forms', () => {
    assert.equal(normalizeAllowlistEntry('*.example.com'), 'example.com');
    assert.equal(normalizeAllowlistEntry('.example.com'), 'example.com');
  });

  it('keeps the exact marker', () => {
    assert.equal(normalizeAllowlistEntry('=example.com'), '=example.com');
  });

  it('rejects input with no host', () => {
    assert.equal(normalizeAllowlistEntry('about:blank'), '');
    assert.equal(normalizeAllowlistEntry(''), '');
    assert.equal(normalizeAllowlistEntry(null), '');
  });
});

describe('allowlistEntryMatches', () => {
  it('covers subdomains by default', () => {
    assert.equal(allowlistEntryMatches('example.com', 'example.com'), true);
    assert.equal(allowlistEntryMatches('news.example.com', 'example.com'), true);
  });

  it('does not match a lookalike domain', () => {
    assert.equal(allowlistEntryMatches('notexample.com', 'example.com'), false);
    assert.equal(allowlistEntryMatches('example.com.evil.test', 'example.com'), false);
  });

  it('matches only the exact host for = entries', () => {
    assert.equal(allowlistEntryMatches('example.com', '=example.com'), true);
    assert.equal(allowlistEntryMatches('news.example.com', '=example.com'), false);
  });
});

describe('list operations', () => {
  it('adds entries without duplicates and keeps them sorted', () => {
    let entries = [];
    entries = addAllowlistEntry(entries, 'zeta.test');
    entries = addAllowlistEntry(entries, 'alpha.test');
    entries = addAllowlistEntry(entries, 'https://alpha.test/x');
    assert.deepEqual(entries, ['alpha.test', 'zeta.test']);
  });

  it('ignores unusable input when adding', () => {
    assert.deepEqual(addAllowlistEntry(['a.test'], 'about:blank'), ['a.test']);
  });

  it('removes an entry however it was written', () => {
    assert.deepEqual(removeAllowlistEntry(['a.test', 'b.test'], 'https://a.test/'), ['b.test']);
  });

  it('finds which entry exempts a host', () => {
    assert.equal(findAllowlistMatch('x.a.test', ['b.test', 'a.test']), 'a.test');
    assert.equal(findAllowlistMatch('c.test', ['a.test']), null);
    assert.equal(isAllowlisted('x.a.test', ['a.test']), true);
    assert.equal(isAllowlisted('x.a.test', 'not an array'), false);
  });
});

describe('allowlistFilterText', () => {
  it('shows the filter an entry is equivalent to', () => {
    assert.equal(allowlistFilterText('example.com'), '@@||example.com^$document');
    assert.equal(allowlistFilterText('=example.com'), '@@|https://example.com^$document');
    assert.equal(allowlistFilterText(''), '');
  });
});
