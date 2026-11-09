/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseFilter, parseFilterList, patternToRegexSource } from '../src/lib/filter-parser.js';

describe('parseFilter: comments and headers', () => {
  it('ignores blank lines, comments and list headers', () => {
    for (const line of ['', '   ', '! a comment', '# ', '[Adblock Plus 2.0]']) {
      assert.equal(parseFilter(line).kind, 'comment', JSON.stringify(line));
    }
  });
});

describe('parseFilter: network filters', () => {
  it('parses a plain domain anchored filter', () => {
    const filter = parseFilter('||ads.example.com^');
    assert.equal(filter.kind, 'network');
    assert.equal(filter.isException, false);
    assert.equal(filter.types, null);
    assert.equal(filter.thirdParty, null);
    assert.deepEqual(filter.includeDomains, []);
  });

  it('parses exception filters', () => {
    const filter = parseFilter('@@||example.com/ads.js');
    assert.equal(filter.kind, 'network');
    assert.equal(filter.isException, true);
  });

  it('parses type options', () => {
    const filter = parseFilter('||example.com/x$script,image');
    assert.deepEqual([...filter.types].sort(), ['image', 'imageset', 'script']);
  });

  it('parses negated type options as everything else', () => {
    const filter = parseFilter('||example.com/x$~script');
    assert.ok(filter.types.has('image'));
    assert.equal(filter.types.has('script'), false);
  });

  it('parses third-party and its aliases', () => {
    assert.equal(parseFilter('||a.com^$third-party').thirdParty, true);
    assert.equal(parseFilter('||a.com^$3p').thirdParty, true);
    assert.equal(parseFilter('||a.com^$~third-party').thirdParty, false);
    assert.equal(parseFilter('||a.com^$first-party').thirdParty, false);
    assert.equal(parseFilter('||a.com^$1p').thirdParty, false);
  });

  it('parses domain include and exclude lists', () => {
    const filter = parseFilter('/banner$domain=example.com|~sub.example.com|other.org');
    assert.deepEqual(filter.includeDomains, ['example.com', 'other.org']);
    assert.deepEqual(filter.excludeDomains, ['sub.example.com']);
  });

  it('keeps $important and $match-case', () => {
    const filter = parseFilter('||a.com^$important,match-case');
    assert.equal(filter.important, true);
    assert.equal(filter.matchCase, true);
  });

  it('accepts regular expression filters', () => {
    const filter = parseFilter('/^https?:\\/\\/[a-z]+\\.ads\\./$script');
    assert.equal(filter.kind, 'network');
    assert.equal(filter.isRegex, true);
    assert.ok(filter.types.has('script'));
  });

  it('rejects an invalid regular expression', () => {
    assert.equal(parseFilter('/ad(/').kind, 'invalid');
  });

  it('converts hosts-file lines', () => {
    const filter = parseFilter('0.0.0.0 ads.example.com');
    assert.equal(filter.kind, 'network');
    assert.equal(filter.pattern, '||ads.example.com^');
  });

  it('skips hosts-file lines that point at localhost', () => {
    assert.equal(parseFilter('127.0.0.1 localhost').kind, 'comment');
  });

  it('treats a bare hostname as a domain block', () => {
    assert.equal(parseFilter('tracker.example.net').pattern, '||tracker.example.net^');
  });

  it('refuses a pattern that would match everything', () => {
    assert.equal(parseFilter('*').kind, 'invalid');
  });

  it('refuses a pattern containing whitespace, which no URL can match', () => {
    const filter = parseFilter('$$broken filter');
    assert.equal(filter.kind, 'invalid');
    assert.equal(filter.reason, 'pattern contains whitespace');
    assert.equal(parseFilter('this is a sentence, not a filter').kind, 'invalid');
  });

  it('reports options it cannot honour rather than guessing', () => {
    for (const line of ['||a.com^$removeparam=x', '||a.com^$redirect=noop.js', '||a.com^$csp=foo']) {
      const filter = parseFilter(line);
      assert.equal(filter.kind, 'invalid', line);
      assert.equal(filter.unsupported, true, line);
    }
  });

  it('makes a popup-only filter inert instead of blocking navigation', () => {
    const filter = parseFilter('||a.com^$popup');
    assert.equal(filter.kind, 'network');
    assert.equal(filter.types.size, 0);
  });

  it('records document level exception scopes', () => {
    const filter = parseFilter('@@||example.com^$document,elemhide');
    assert.equal(filter.isDocumentScoped, true);
    assert.deepEqual(filter.docScopes.sort(), ['document', 'elemhide']);
  });

  it('does not treat a blocking $document filter as a document exception', () => {
    const filter = parseFilter('||malware.test^$document');
    assert.equal(filter.isDocumentScoped, false);
    assert.ok(filter.types.has('main_frame'));
  });
});

describe('parseFilter: element hiding', () => {
  it('parses a domain specific rule', () => {
    const filter = parseFilter('example.com,other.org##.ad-box');
    assert.equal(filter.kind, 'cosmetic');
    assert.equal(filter.selector, '.ad-box');
    assert.deepEqual(filter.includeDomains, ['example.com', 'other.org']);
    assert.equal(filter.isException, false);
  });

  it('parses a generic rule', () => {
    const filter = parseFilter('##.banner-ad');
    assert.equal(filter.kind, 'cosmetic');
    assert.deepEqual(filter.includeDomains, []);
  });

  it('parses exclusions and exceptions', () => {
    assert.deepEqual(parseFilter('~example.com##.ad').excludeDomains, ['example.com']);
    assert.equal(parseFilter('example.com#@#.ad').isException, true);
  });

  it('marks procedural selectors', () => {
    const filter = parseFilter('example.com##div:has-text(Sponsored)');
    assert.equal(filter.isProcedural, true);
  });

  it('rejects scriptlets and snippets as unsupported', () => {
    assert.equal(parseFilter('example.com##+js(abort-on-property-read, ads)').unsupported, true);
    assert.equal(parseFilter('example.com#$#abort-on-property-read ads').unsupported, true);
  });

  it('rejects procedural operators it cannot evaluate', () => {
    const filter = parseFilter('example.com#?#div:matches-css(width: 300px)');
    assert.equal(filter.kind, 'invalid');
    assert.equal(filter.unsupported, true);
  });

  it('does not mistake a network filter containing a hash for element hiding', () => {
    const filter = parseFilter('||example.com/track?id=1#frag');
    assert.equal(filter.kind, 'network');
  });

  it('accepts the any-public-suffix domain form used throughout EasyList', () => {
    // Real EasyList line: a wildcard TLD plus a selector containing spaces.
    const filter = parseFilter('tellows-au.com,tellows.*##li > .comment-body[style*="min-height: 250px;"]');
    assert.equal(filter.kind, 'cosmetic');
    assert.deepEqual(filter.includeDomains, ['tellows-au.com', 'tellows.*']);
    assert.equal(filter.selector, 'li > .comment-body[style*="min-height: 250px;"]');
  });
});

describe('patternToRegexSource', () => {
  it('anchors the domain for ||', () => {
    const source = patternToRegexSource('||example.com^');
    const regex = new RegExp(source, 'i');
    assert.ok(regex.test('https://example.com/'));
    assert.ok(regex.test('https://ads.example.com/x'));
    assert.equal(regex.test('https://notexample.com/'), false);
    assert.equal(regex.test('https://evil.test/?u=example.com/'), false);
  });

  it('treats ^ as a separator that also matches the end of the URL', () => {
    const regex = new RegExp(patternToRegexSource('||example.com^'), 'i');
    assert.ok(regex.test('https://example.com'));
    assert.equal(regex.test('https://example.com.evil.test/'), false);
  });

  it('expands * and honours the | anchors', () => {
    const regex = new RegExp(patternToRegexSource('|https://a.com/*/ads.js|'), 'i');
    assert.ok(regex.test('https://a.com/x/ads.js'));
    assert.equal(regex.test('https://a.com/x/ads.js?v=1'), false);
  });
});

describe('parseFilterList', () => {
  it('reads metadata and counts the outcome of every line', () => {
    const text = [
      '[Adblock Plus 2.0]',
      '! Title: Example list',
      '! Homepage: https://example.org/',
      '! Expires: 3 days',
      '! Version: 202611091200',
      '||ads.example.com^',
      'example.com##.ad',
      '||a.com^$removeparam=x',
      ''
    ].join('\n');

    const { meta, filters, stats } = parseFilterList(text);
    assert.equal(meta.title, 'Example list');
    assert.equal(meta.homepage, 'https://example.org/');
    assert.equal(meta.expiresHours, 72);
    assert.equal(meta.version, '202611091200');
    assert.equal(filters.length, 2);
    assert.equal(stats.network, 1);
    assert.equal(stats.cosmetic, 1);
    assert.equal(stats.unsupported, 1);
  });

  it('reads an expiry given in hours', () => {
    assert.equal(parseFilterList('! Expires: 6 hours').meta.expiresHours, 6);
  });
});
