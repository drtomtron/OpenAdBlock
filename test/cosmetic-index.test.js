/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CosmeticIndex, buildStylesheet } from '../src/lib/cosmetic-index.js';
import { parseFilterList } from '../src/lib/filter-parser.js';

/**
 * @param {string[]} lines
 * @returns {CosmeticIndex}
 */
function indexFrom(lines) {
  return CosmeticIndex.build(parseFilterList(lines.join('\n')).filters);
}

describe('CosmeticIndex', () => {
  const index = indexFrom([
    '##.generic-ad',
    '##.everywhere',
    '~safe.test##.generic-ad',
    'example.com##.promo',
    'example.com##.promo-two',
    'sub.example.com##.deep',
    'example.com#@#.promo-two',
    'news.test##div:has-text(Sponsored)',
    'shop.test,~eu.shop.test##.banner'
  ]);

  it('applies generic rules everywhere', () => {
    const result = index.getForHost('anything.test');
    assert.ok(result.generic.includes('.generic-ad'));
    assert.ok(result.generic.includes('.everywhere'));
  });

  it('honours a generic exclusion for one domain', () => {
    const result = index.getForHost('safe.test');
    assert.equal(result.generic.includes('.generic-ad'), false);
    assert.ok(result.generic.includes('.everywhere'));
  });

  it('applies domain rules to the domain and its subdomains', () => {
    assert.deepEqual(index.getForHost('example.com').plain, ['.promo']);
    const sub = index.getForHost('sub.example.com').plain;
    assert.ok(sub.includes('.promo'));
    assert.ok(sub.includes('.deep'));
  });

  it('cancels a rule that has an exception', () => {
    assert.equal(index.getForHost('example.com').plain.includes('.promo-two'), false);
  });

  it('respects a domain exclusion on a specific rule', () => {
    assert.deepEqual(index.getForHost('shop.test').plain, ['.banner']);
    assert.deepEqual(index.getForHost('eu.shop.test').plain, []);
  });

  it('keeps procedural selectors separate', () => {
    const result = index.getForHost('news.test');
    assert.deepEqual(result.procedural, ['div:has-text(Sponsored)']);
    assert.equal(result.plain.includes('div:has-text(Sponsored)'), false);
  });

  it('drops generic rules when $generichide applies', () => {
    const result = index.getForHost('example.com', { genericHide: true });
    assert.deepEqual(result.generic, []);
    assert.deepEqual(result.plain, ['.promo']);
  });

  it('returns nothing at all when element hiding is switched off', () => {
    const result = index.getForHost('example.com', { elemHide: false });
    assert.deepEqual(result, { plain: [], procedural: [], generic: [] });
  });

  it('knows when the shared generic stylesheet can be reused', () => {
    assert.equal(index.usesDefaultGeneric('plain.test'), true);
    assert.equal(index.usesDefaultGeneric('safe.test'), false);
    assert.equal(index.usesDefaultGeneric('example.com'), false);
  });

  it('applies a wildcard TLD rule across every country domain', () => {
    const wildcard = indexFrom(['shop.*##.country-ad', 'shop.*,~shop.ru##.promo']);
    assert.deepEqual(wildcard.getForHost('shop.com').plain, ['.country-ad', '.promo']);
    assert.deepEqual(wildcard.getForHost('www.shop.co.uk').plain, ['.country-ad', '.promo']);
    assert.deepEqual(wildcard.getForHost('shop.ru').plain, ['.country-ad']);
    assert.deepEqual(wildcard.getForHost('othershop.com').plain, []);
  });

  it('counts what it stored', () => {
    assert.equal(index.counts.generic, 2);
    assert.equal(index.counts.procedural, 1);
    assert.equal(index.counts.exceptions, 1);
  });
});

describe('buildStylesheet', () => {
  it('builds one hiding rule', () => {
    assert.equal(buildStylesheet(['.a', '.b']), '.a,.b{display:none!important}');
  });

  it('returns an empty string for no selectors', () => {
    assert.equal(buildStylesheet([]), '');
    assert.equal(buildStylesheet(undefined), '');
  });

  it('splits very long selector lists into several rules', () => {
    const selectors = [];
    for (let i = 0; i < 1200; i++) selectors.push('.ad-' + i);
    const css = buildStylesheet(selectors);
    assert.equal(css.split('\n').length, 3);
    assert.ok(css.includes('.ad-0,'));
    assert.ok(css.includes('.ad-1199{display:none!important}'));
  });
});
