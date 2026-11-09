/*
 * OpenAdBlock - domain helpers
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Second-level suffixes that behave like public suffixes.
 *
 * This is a deliberately small, dependency-free approximation of the Public
 * Suffix List. It covers the registrar patterns behind the vast majority of
 * real-world traffic. Getting an entry wrong only affects the first-party vs
 * third-party decision for that TLD, never plain hostname matching.
 * See docs/ARCHITECTURE.md, "Known limitations".
 */
const SECOND_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'ac.uk', 'gov.uk', 'nhs.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'school.nz', 'geek.nz',
  'co.za', 'org.za', 'net.za', 'web.za', 'gov.za', 'ac.za',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'lg.jp',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 're.kr', 'pe.kr',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in', 'gov.in', 'ac.in', 'edu.in',
  'com.mx', 'org.mx', 'net.mx', 'gob.mx', 'edu.mx',
  'com.ar', 'net.ar', 'org.ar', 'gob.ar', 'edu.ar',
  'com.tr', 'net.tr', 'org.tr', 'gov.tr', 'edu.tr',
  'com.tw', 'net.tw', 'org.tw', 'gov.tw', 'edu.tw',
  'com.hk', 'net.hk', 'org.hk', 'gov.hk', 'edu.hk', 'idv.hk',
  'com.sg', 'net.sg', 'org.sg', 'gov.sg', 'edu.sg',
  'com.my', 'net.my', 'org.my', 'gov.my', 'edu.my',
  'com.pl', 'net.pl', 'org.pl', 'gov.pl', 'edu.pl', 'waw.pl',
  'com.ua', 'net.ua', 'org.ua', 'gov.ua', 'edu.ua', 'in.ua', 'kiev.ua',
  'com.ru', 'net.ru', 'org.ru', 'msk.ru', 'spb.ru',
  'co.il', 'org.il', 'net.il', 'gov.il', 'ac.il',
  'com.co', 'net.co', 'nom.co',
  'co.id', 'web.id', 'or.id', 'go.id', 'ac.id',
  'com.ph', 'net.ph', 'org.ph', 'gov.ph',
  'com.vn', 'net.vn', 'org.vn', 'gov.vn', 'edu.vn',
  'com.pk', 'net.pk', 'org.pk', 'gov.pk', 'edu.pk',
  'co.th', 'in.th', 'go.th', 'ac.th',
  'com.eg', 'com.sa', 'com.ng', 'com.gh', 'com.ec', 'com.pe', 'com.uy', 'com.ve',
  'com.cy', 'com.mt', 'com.gr', 'com.pt', 'com.es', 'com.it', 'com.de', 'com.fr',
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'netlify.app', 'vercel.app',
  'herokuapp.com', 'appspot.com', 'cloudfront.net', 'firebaseapp.com', 'web.app',
  'blogspot.com', 'wordpress.com', 'tumblr.com', 'myshopify.com', 'azurewebsites.net',
  'cloudfunctions.net', 'r2.dev', 'onrender.com', 'fly.dev'
]);

const IPV4_RE = /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/;

/**
 * Lowercase a hostname and strip any trailing dot.
 * @param {string} host
 * @returns {string}
 */
export function normalizeHost(host) {
  if (typeof host !== 'string') return '';
  let h = host.trim().toLowerCase();
  while (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

/**
 * Extract the hostname from a URL string, or '' when there is none
 * (about:blank, data: URLs, malformed input).
 * @param {string} url
 * @returns {string}
 */
export function hostFromUrl(url) {
  if (typeof url !== 'string' || url === '') return '';
  const schemeEnd = url.indexOf('://');
  if (schemeEnd !== -1) {
    const start = schemeEnd + 3;
    let end = url.length;
    for (let i = start; i < url.length; i++) {
      const c = url.charCodeAt(i);
      // '/', '?' or '#' ends the authority component.
      if (c === 47 || c === 63 || c === 35) { end = i; break; }
    }
    let host = url.slice(start, end);
    const at = host.lastIndexOf('@');
    if (at !== -1) host = host.slice(at + 1);
    if (host.startsWith('[')) {
      const close = host.indexOf(']');
      return close === -1 ? '' : host.slice(0, close + 1).toLowerCase();
    }
    const colon = host.indexOf(':');
    if (colon !== -1) host = host.slice(0, colon);
    return normalizeHost(host);
  }
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return '';
  }
}

/**
 * Registrable domain (eTLD+1) for a hostname, using the approximation above.
 * IP literals and single-label hosts come back unchanged.
 * @param {string} host
 * @returns {string}
 */
export function baseDomain(host) {
  const h = normalizeHost(host);
  if (h === '' || h.startsWith('[') || IPV4_RE.test(h)) return h;
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  if (SECOND_LEVEL_SUFFIXES.has(parts.slice(-2).join('.'))) {
    return parts.slice(-3).join('.');
  }
  if (parts.length >= 4 && SECOND_LEVEL_SUFFIXES.has(parts.slice(-3).join('.'))) {
    return parts.slice(-4).join('.');
  }
  return parts.slice(-2).join('.');
}

/**
 * True when `host` belongs to a different registrable domain than
 * `documentHost`. An unknown document host counts as first party so that we
 * never over-block requests we cannot attribute.
 * @param {string} host
 * @param {string} documentHost
 * @returns {boolean}
 */
export function isThirdParty(host, documentHost) {
  const a = normalizeHost(host);
  const b = normalizeHost(documentHost);
  if (a === '' || b === '') return false;
  if (a === b) return false;
  return baseDomain(a) !== baseDomain(b);
}

/**
 * Domain-option matching: `example.com` matches `example.com` and all of its
 * subdomains, as in Adblock Plus filter syntax.
 * @param {string} host
 * @param {string} domain
 * @returns {boolean}
 */
export function hostMatchesDomain(host, domain) {
  const h = normalizeHost(host);
  const d = normalizeHost(domain);
  if (h === '' || d === '') return false;
  if (h === d) return true;
  return h.endsWith('.' + d);
}

/**
 * Every suffix of a hostname, longest first: a.b.example.com yields
 * a.b.example.com, b.example.com, example.com, com.
 * @param {string} host
 * @returns {string[]}
 */
export function hostSuffixes(host) {
  const h = normalizeHost(host);
  if (h === '') return [];
  const out = [h];
  let idx = h.indexOf('.');
  while (idx !== -1) {
    out.push(h.slice(idx + 1));
    idx = h.indexOf('.', idx + 1);
  }
  return out;
}
