/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  baseDomain, hostFromUrl, hostMatchesDomain, hostSuffixes, isThirdParty, normalizeHost
} from '../src/lib/domain.js';

describe('hostFromUrl', () => {
  it('reads the host out of ordinary URLs', () => {
    assert.equal(hostFromUrl('https://ads.example.com/a.js?x=1'), 'ads.example.com');
    assert.equal(hostFromUrl('http://example.com'), 'example.com');
    assert.equal(hostFromUrl('wss://socket.example.com:8443/feed'), 'socket.example.com');
  });

  it('lowercases, strips ports, credentials and trailing dots', () => {
    assert.equal(hostFromUrl('https://User:pw@Ads.Example.COM.:8443/x'), 'ads.example.com');
  });

  it('handles IPv6 literals', () => {
    assert.equal(hostFromUrl('https://[2606:4700::1111]:443/x'), '[2606:4700::1111]');
  });

  it('returns an empty string when there is no host', () => {
    assert.equal(hostFromUrl('about:blank'), '');
    assert.equal(hostFromUrl('data:text/html,hi'), '');
    assert.equal(hostFromUrl(''), '');
    assert.equal(hostFromUrl(undefined), '');
  });

  it('stops at the first path, query or fragment character', () => {
    assert.equal(hostFromUrl('https://example.com?a=b'), 'example.com');
    assert.equal(hostFromUrl('https://example.com#frag'), 'example.com');
  });
});

describe('baseDomain', () => {
  it('returns the registrable domain', () => {
    assert.equal(baseDomain('a.b.example.com'), 'example.com');
    assert.equal(baseDomain('example.com'), 'example.com');
  });

  it('understands common two-label public suffixes', () => {
    assert.equal(baseDomain('news.bbc.co.uk'), 'bbc.co.uk');
    assert.equal(baseDomain('shop.company.com.au'), 'company.com.au');
  });

  it('leaves IP literals and single labels alone', () => {
    assert.equal(baseDomain('192.168.0.1'), '192.168.0.1');
    assert.equal(baseDomain('localhost'), 'localhost');
  });
});

describe('isThirdParty', () => {
  it('treats subdomains of the same site as first party', () => {
    assert.equal(isThirdParty('cdn.example.com', 'www.example.com'), false);
    assert.equal(isThirdParty('example.com', 'example.com'), false);
  });

  it('treats a different registrable domain as third party', () => {
    assert.equal(isThirdParty('ads.doubleclick.net', 'example.com'), true);
    assert.equal(isThirdParty('a.bbc.co.uk', 'b.itv.co.uk'), true);
  });

  it('treats an unknown document host as first party so nothing is over-blocked', () => {
    assert.equal(isThirdParty('ads.example.com', ''), false);
  });
});

describe('hostMatchesDomain', () => {
  it('matches the domain and its subdomains only', () => {
    assert.equal(hostMatchesDomain('example.com', 'example.com'), true);
    assert.equal(hostMatchesDomain('a.example.com', 'example.com'), true);
    assert.equal(hostMatchesDomain('notexample.com', 'example.com'), false);
    assert.equal(hostMatchesDomain('example.com.evil.test', 'example.com'), false);
  });
});

describe('hostSuffixes', () => {
  it('lists every suffix, longest first', () => {
    assert.deepEqual(hostSuffixes('a.b.example.com'),
      ['a.b.example.com', 'b.example.com', 'example.com', 'com']);
  });

  it('returns nothing for an empty host', () => {
    assert.deepEqual(hostSuffixes(''), []);
  });
});

describe('normalizeHost', () => {
  it('trims, lowercases and removes trailing dots', () => {
    assert.equal(normalizeHost('  Example.COM.. '), 'example.com');
    assert.equal(normalizeHost(null), '');
  });
});
