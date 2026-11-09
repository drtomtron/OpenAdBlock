/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FilterEngine, patternTokens, tokenizeUrl } from '../src/lib/filter-engine.js';
import { parseFilterList } from '../src/lib/filter-parser.js';

/**
 * @param {string[]} lines
 * @returns {FilterEngine}
 */
function engineFrom(lines) {
  return FilterEngine.build(parseFilterList(lines.join('\n')).filters);
}

/**
 * @param {FilterEngine} engine
 * @param {string} url
 * @param {string} type
 * @param {string} documentHost
 * @param {boolean} thirdParty
 * @returns {string}
 */
function action(engine, url, type, documentHost, thirdParty = true) {
  return engine.match({ url, type, documentHost, thirdParty }).action;
}

describe('tokenization', () => {
  it('splits URLs into keyword tokens', () => {
    assert.deepEqual(tokenizeUrl('https://Ads.Example.com/banner_300.js'),
      ['https', 'ads', 'example', 'com', 'banner', '300']);
  });

  it('only takes pattern tokens that are delimited on both sides', () => {
    // A token at the edge of a pattern could be a partial URL token, so it is
    // not usable as an index key.
    assert.deepEqual(patternTokens('||ads.example.com^'), ['ads', 'example', 'com']);
    assert.deepEqual(patternTokens('/banner'), []);
  });
});

describe('FilterEngine.match', () => {
  const engine = engineFrom([
    '||ads.example.com^',
    '||cdn.example.net/banner.js$script,third-party',
    '/adserver/*$image',
    '||counter.test^$image,~third-party',
    '@@||ads.example.com/allowed.js',
    '||tracker.test^$important',
    '@@||tracker.test^',
    '||sponsor.test^$domain=news.test|~free.news.test'
  ]);

  it('blocks a matching request', () => {
    assert.equal(action(engine, 'https://ads.example.com/a.png', 'image', 'site.test'), 'block');
  });

  it('leaves unmatched requests alone', () => {
    assert.equal(action(engine, 'https://safe.example.com/a.png', 'image', 'site.test'), 'none');
  });

  it('respects type options', () => {
    assert.equal(action(engine, 'https://x.test/adserver/1.gif', 'image', 'site.test'), 'block');
    assert.equal(action(engine, 'https://x.test/adserver/1.js', 'script', 'site.test'), 'none');
  });

  it('respects third-party', () => {
    assert.equal(action(engine, 'https://cdn.example.net/banner.js', 'script', 'site.test', true), 'block');
    assert.equal(action(engine, 'https://cdn.example.net/banner.js', 'script', 'example.net', false), 'none');
  });

  it('respects first-party only filters', () => {
    assert.equal(action(engine, 'https://counter.test/p.gif', 'image', 'counter.test', false), 'block');
    assert.equal(action(engine, 'https://counter.test/p.gif', 'image', 'other.test', true), 'none');
  });

  it('lets exception filters win', () => {
    assert.equal(action(engine, 'https://ads.example.com/allowed.js', 'script', 'site.test'), 'allow');
  });

  it('lets $important outrank an exception', () => {
    assert.equal(action(engine, 'https://tracker.test/t.gif', 'image', 'site.test'), 'block');
  });

  it('applies $domain include and exclude lists', () => {
    assert.equal(action(engine, 'https://sponsor.test/x.js', 'script', 'news.test'), 'block');
    assert.equal(action(engine, 'https://sponsor.test/x.js', 'script', 'sub.news.test'), 'block');
    assert.equal(action(engine, 'https://sponsor.test/x.js', 'script', 'free.news.test'), 'none');
    assert.equal(action(engine, 'https://sponsor.test/x.js', 'script', 'other.test'), 'none');
  });

  it('never blocks a top level document with a type-less filter', () => {
    // Visiting a blocked host directly must still work, as in Adblock Plus.
    assert.equal(action(engine, 'https://ads.example.com/', 'main_frame', 'ads.example.com', false), 'none');
  });

  it('does block a document when a filter asks for it explicitly', () => {
    const malware = engineFrom(['||malware.test^$document']);
    assert.equal(action(malware, 'https://malware.test/', 'main_frame', 'malware.test', false), 'block');
  });

  it('matches filters that have no usable keyword', () => {
    const engineNoToken = engineFrom(['/ad|']);
    assert.equal(action(engineNoToken, 'https://x.test/ad', 'image', 'site.test'), 'block');
  });

  it('is case insensitive unless $match-case is given', () => {
    const mixed = engineFrom(['||example.com/Banner.PNG', '||example.com/Exact.PNG$match-case']);
    assert.equal(action(mixed, 'https://example.com/banner.png', 'image', 'site.test'), 'block');
    assert.equal(action(mixed, 'https://example.com/exact.png', 'image', 'site.test'), 'none');
    assert.equal(action(mixed, 'https://example.com/Exact.PNG', 'image', 'site.test'), 'block');
  });
});

describe('FilterEngine.documentScopesFor', () => {
  const engine = engineFrom([
    '@@||allowed.test^$document',
    '@@||hidden.test^$elemhide,generichide',
    '@@|https://exact.test/page^$document',
    '@@$document,domain=bydomain.test'
  ]);

  it('finds a document exception by hostname', () => {
    assert.deepEqual([...engine.documentScopesFor('https://allowed.test/x', 'allowed.test')], ['document']);
  });

  it('covers subdomains', () => {
    assert.deepEqual([...engine.documentScopesFor('https://a.allowed.test/x', 'a.allowed.test')], ['document']);
  });

  it('returns every scope a page is granted', () => {
    const scopes = engine.documentScopesFor('https://hidden.test/x', 'hidden.test');
    assert.equal(scopes.has('elemhide'), true);
    assert.equal(scopes.has('generichide'), true);
    assert.equal(scopes.has('document'), false);
  });

  it('honours a path anchored exception', () => {
    assert.equal(engine.documentScopesFor('https://exact.test/page', 'exact.test').has('document'), true);
    assert.equal(engine.documentScopesFor('https://exact.test/other', 'exact.test').has('document'), false);
  });

  it('honours an exception restricted by $domain', () => {
    assert.equal(engine.documentScopesFor('https://bydomain.test/x', 'bydomain.test').has('document'), true);
    assert.equal(engine.documentScopesFor('https://elsewhere.test/x', 'elsewhere.test').has('document'), false);
  });

  it('returns nothing for an ordinary page', () => {
    assert.equal(engine.documentScopesFor('https://plain.test/x', 'plain.test').size, 0);
  });
});

describe('FilterEngine indexing', () => {
  it('files every filter and still matches them all', () => {
    const lines = [];
    for (let i = 0; i < 500; i++) lines.push('||host' + i + '.example.com^$script');
    const engine = engineFrom(lines);
    assert.equal(engine.counts.blocking, 500);
    for (let i = 0; i < 500; i += 97) {
      assert.equal(
        action(engine, 'https://host' + i + '.example.com/x.js', 'script', 'site.test'),
        'block',
        'filter ' + i
      );
    }
  });
});
