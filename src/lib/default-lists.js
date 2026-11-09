/*
 * OpenAdBlock - built-in filter list catalogue
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Every list here is maintained by a third party under its own licence. We
 * only subscribe to them; we do not redistribute their contents in this repo.
 */

/**
 * @typedef {object} ListDefinition
 * @property {string} id            stable identifier used in storage
 * @property {string} title         human readable name
 * @property {string} url           download URL
 * @property {string} homepage      where the list is maintained
 * @property {string} category      'ads' | 'privacy' | 'annoyances' | 'security' | 'exceptions' | 'regional'
 * @property {string} description   one line explanation shown in the options page
 * @property {boolean} enabledByDefault
 */

/** @type {ListDefinition[]} */
export const DEFAULT_LISTS = [
  {
    id: 'easylist',
    title: 'EasyList',
    url: 'https://easylist.to/easylist/easylist.txt',
    homepage: 'https://easylist.to/',
    category: 'ads',
    description: 'The primary ad blocking list: banners, pop-ups, interstitials and video ads.',
    enabledByDefault: true
  },
  {
    id: 'easyprivacy',
    title: 'EasyPrivacy',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
    homepage: 'https://easylist.to/',
    category: 'privacy',
    description: 'Blocks tracking scripts, pixels, beacons and analytics collectors.',
    enabledByDefault: true
  },
  {
    id: 'abp-anti-circumvention',
    title: 'ABP anti-circumvention',
    url: 'https://easylist-downloads.adblockplus.org/abp-filters-anti-cv.txt',
    homepage: 'https://github.com/abp-filters/abp-filters-anti-cv',
    category: 'ads',
    description: 'Counters sites that actively work around ad blockers.',
    enabledByDefault: true
  },
  {
    id: 'peter-lowe',
    title: 'Peter Lowe ad and tracking servers',
    url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext',
    homepage: 'https://pgl.yoyo.org/adservers/',
    category: 'privacy',
    description: 'A compact, long-running list of ad and tracking server hostnames.',
    enabledByDefault: false
  },
  {
    id: 'fanboy-social',
    title: 'Fanboy social blocking',
    url: 'https://easylist.to/easylist/fanboy-social.txt',
    homepage: 'https://easylist.to/',
    category: 'annoyances',
    description: 'Removes social network share buttons, widgets and embedded like boxes.',
    enabledByDefault: false
  },
  {
    id: 'easylist-cookie',
    title: 'EasyList cookie notices',
    url: 'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt',
    homepage: 'https://www.fanboy.co.nz/',
    category: 'annoyances',
    description: 'Hides cookie consent banners and GDPR notices.',
    enabledByDefault: false
  },
  {
    id: 'fanboy-annoyance',
    title: 'Fanboy annoyances',
    url: 'https://easylist.to/easylist/fanboy-annoyance.txt',
    homepage: 'https://easylist.to/',
    category: 'annoyances',
    description: 'Hides newsletter prompts, app install interstitials, chat widgets and surveys.',
    enabledByDefault: false
  },
  {
    id: 'urlhaus-malware',
    title: 'URLhaus malicious hosts',
    url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt',
    homepage: 'https://gitlab.com/malware-filter/urlhaus-filter',
    category: 'security',
    description: 'Blocks hosts known to distribute malware, based on abuse.ch URLhaus data.',
    enabledByDefault: false
  },
  {
    id: 'acceptable-ads',
    title: 'Acceptable Ads',
    url: 'https://easylist-downloads.adblockplus.org/exceptionrules.txt',
    homepage: 'https://acceptableads.com/',
    category: 'exceptions',
    description: 'Allows ads that meet the Acceptable Ads criteria. Off by default in OpenAdBlock.',
    enabledByDefault: false
  }
];

/** Lists shown in the "regional" section of the options page. */
export const REGIONAL_LISTS = [
  {
    id: 'easylist-germany',
    title: 'EasyList Germany',
    url: 'https://easylist.to/easylistgermany/easylistgermany.txt',
    homepage: 'https://easylist.to/',
    category: 'regional',
    description: 'German supplement to EasyList.',
    enabledByDefault: false
  },
  {
    id: 'liste-fr',
    title: 'Liste FR',
    url: 'https://easylist-downloads.adblockplus.org/liste_fr.txt',
    homepage: 'https://forums.lanik.us/viewforum.php?f=91',
    category: 'regional',
    description: 'French supplement to EasyList.',
    enabledByDefault: false
  },
  {
    id: 'easylist-italy',
    title: 'EasyList Italy',
    url: 'https://easylist-downloads.adblockplus.org/easylistitaly.txt',
    homepage: 'https://easylist.to/',
    category: 'regional',
    description: 'Italian supplement to EasyList.',
    enabledByDefault: false
  },
  {
    id: 'easylist-spanish',
    title: 'EasyList Spanish',
    url: 'https://easylist-downloads.adblockplus.org/easylistspanish.txt',
    homepage: 'https://easylist.to/',
    category: 'regional',
    description: 'Spanish supplement to EasyList.',
    enabledByDefault: false
  },
  {
    id: 'easylist-dutch',
    title: 'EasyList Dutch',
    url: 'https://easylist-downloads.adblockplus.org/easylistdutch.txt',
    homepage: 'https://easylist.to/',
    category: 'regional',
    description: 'Dutch supplement to EasyList.',
    enabledByDefault: false
  },
  {
    id: 'ruadlist',
    title: 'RU AdList',
    url: 'https://easylist-downloads.adblockplus.org/advblock.txt',
    homepage: 'https://forums.lanik.us/viewforum.php?f=102',
    category: 'regional',
    description: 'Russian and Ukrainian supplement to EasyList.',
    enabledByDefault: false
  },
  {
    id: 'easylist-china',
    title: 'EasyList China',
    url: 'https://easylist-downloads.adblockplus.org/easylistchina.txt',
    homepage: 'https://easylist.to/',
    category: 'regional',
    description: 'Chinese supplement to EasyList.',
    enabledByDefault: false
  },
  {
    id: 'japanese-filters',
    title: 'Japanese filters',
    url: 'https://raw.githubusercontent.com/k2jp/abp-japanese-filters/master/abpjf.txt',
    homepage: 'https://github.com/k2jp/abp-japanese-filters',
    category: 'regional',
    description: 'Japanese supplement to EasyList.',
    enabledByDefault: false
  }
];

/** Every list OpenAdBlock knows about out of the box. */
export const ALL_KNOWN_LISTS = [...DEFAULT_LISTS, ...REGIONAL_LISTS];

/**
 * Look up a built-in list definition.
 * @param {string} id
 * @returns {ListDefinition|undefined}
 */
export function findListDefinition(id) {
  return ALL_KNOWN_LISTS.find((list) => list.id === id);
}

/**
 * Suggest regional lists for a browser UI language such as `de` or `pt-BR`.
 * @param {string} uiLanguage
 * @returns {string[]} list ids
 */
export function regionalListsForLanguage(uiLanguage) {
  const language = String(uiLanguage || '').toLowerCase().split('-')[0];
  const map = {
    de: ['easylist-germany'],
    fr: ['liste-fr'],
    it: ['easylist-italy'],
    es: ['easylist-spanish'],
    nl: ['easylist-dutch'],
    ru: ['ruadlist'],
    uk: ['ruadlist'],
    zh: ['easylist-china'],
    ja: ['japanese-filters']
  };
  return map[language] || [];
}
