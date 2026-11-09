/*
 * OpenAdBlock - content script: procedural selectors and placeholder collapsing
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Plain CSS element hiding is injected by the background page as a user
 * stylesheet. This script only does the work that needs the DOM:
 *
 *   1. procedural selectors - :has-text(), :has(), :upward()
 *   2. collapsing the empty box left behind by a blocked image or frame
 *
 * It is a classic (non-module) script because content scripts cannot be ES
 * modules, so everything it needs is defined here.
 */

(() => {
  'use strict';

  if (window.__openAdBlockActive) return;
  window.__openAdBlockActive = true;

  const HIDDEN_ATTRIBUTE = 'data-openadblock-hidden';
  const COLLAPSE_DEBOUNCE_MS = 50;
  const RERUN_DEBOUNCE_MS = 300;
  /** Stop re-running procedural rules forever on very busy pages. */
  const MAX_RUNS = 400;

  /** @type {Array<{base: string, ops: Array<{name: string, arg: string}>}>} */
  let rules = [];
  let collapseEnabled = false;
  let runCount = 0;
  let rerunTimer = 0;
  let observer = null;

  /** URLs waiting to be collapsed. */
  const pendingCollapse = new Set();
  let collapseTimer = 0;

  browser.runtime
    .sendMessage({ type: 'cosmetic:get' })
    .then(start)
    .catch(() => {
      // The background page may not be ready yet; nothing else to do.
    });

  browser.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'openadblock:collapse') return;
    if (!collapseEnabled) return;
    pendingCollapse.add(message.url);
    if (collapseTimer === 0) {
      collapseTimer = window.setTimeout(runCollapse, COLLAPSE_DEBOUNCE_MS);
    }
  });

  /**
   * @param {{active: boolean, procedural: string[], collapse: boolean, css: string}} payload
   */
  function start(payload) {
    if (!payload || !payload.active) return;
    collapseEnabled = Boolean(payload.collapse);

    // Frames the background cannot reach with insertCSS get their stylesheet here.
    if (payload.css) injectStylesheet(payload.css);

    rules = (payload.procedural || []).map(compileSelector).filter(Boolean);
    if (rules.length === 0) return;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        applyRules();
        watchForChanges();
      }, { once: true });
    } else {
      applyRules();
      watchForChanges();
    }
  }

  /**
   * @param {string} css
   */
  function injectStylesheet(css) {
    try {
      const style = document.createElement('style');
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    } catch {
      // A hostile or very early document; skip.
    }
  }

  /**
   * Split a procedural selector into a CSS prefix and a chain of operators.
   * Returns null for shapes this implementation does not handle, which keeps a
   * filter from being applied in a way its author did not intend.
   *
   * @param {string} selector
   * @returns {{base: string, ops: Array<{name: string, arg: string}>}|null}
   */
  function compileSelector(selector) {
    const ops = [];
    let base = '';
    let index = 0;
    let depth = 0;
    let quote = '';
    let current = '';

    while (index < selector.length) {
      const ch = selector[index];

      if (quote !== '') {
        current += ch;
        if (ch === quote) quote = '';
        index++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        current += ch;
        index++;
        continue;
      }
      if (ch === '(') depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);

      if (ch === ':' && depth === 0) {
        const match = /^:(?:-abp-)?(has-text|contains|has|upward)\(/i.exec(selector.slice(index));
        if (match) {
          const argStart = index + match[0].length;
          const argEnd = findClosingParen(selector, argStart);
          if (argEnd === -1) return null;
          if (ops.length === 0) base = current.trim();
          else if (current.trim() !== '') return null; // CSS between operators
          current = '';
          ops.push({ name: match[1].toLowerCase(), arg: selector.slice(argStart, argEnd).trim() });
          index = argEnd + 1;
          continue;
        }
      }

      current += ch;
      index++;
    }

    if (ops.length === 0) return null;
    if (current.trim() !== '') return null; // trailing CSS after an operator
    if (base === '') base = '*';

    // :has() is native in current Firefox, so let the engine do that work.
    if (ops.length === 1 && ops[0].name === 'has' && supportsNativeHas()) {
      return { base: base + ':has(' + ops[0].arg + ')', ops: [] };
    }
    return { base, ops };
  }

  /**
   * @param {string} text
   * @param {number} from index just after the opening parenthesis
   * @returns {number} index of the matching ')' or -1
   */
  function findClosingParen(text, from) {
    let depth = 1;
    let quote = '';
    for (let i = from; i < text.length; i++) {
      const ch = text[i];
      if (quote !== '') {
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  let nativeHas = null;
  /** @returns {boolean} */
  function supportsNativeHas() {
    if (nativeHas === null) {
      try {
        document.querySelector(':has(*)');
        nativeHas = true;
      } catch {
        nativeHas = false;
      }
    }
    return nativeHas;
  }

  /** Evaluate every rule and hide what matches. */
  function applyRules() {
    if (runCount++ > MAX_RUNS) {
      disconnect();
      return;
    }
    for (const rule of rules) {
      let elements;
      try {
        elements = Array.from(document.querySelectorAll(rule.base));
      } catch {
        continue; // invalid CSS in the filter
      }
      for (const op of rule.ops) {
        elements = applyOperator(elements, op);
        if (elements.length === 0) break;
      }
      for (const element of elements) hide(element);
    }
  }

  /**
   * @param {Element[]} elements
   * @param {{name: string, arg: string}} op
   * @returns {Element[]}
   */
  function applyOperator(elements, op) {
    switch (op.name) {
      case 'has-text':
      case 'contains': {
        const test = textTester(op.arg);
        return elements.filter((element) => test(element.textContent || ''));
      }
      case 'has':
        return elements.filter((element) => {
          try {
            return element.querySelector(op.arg) !== null;
          } catch {
            return false;
          }
        });
      case 'upward': {
        const steps = Number(op.arg);
        const out = [];
        for (const element of elements) {
          const target = Number.isInteger(steps) && steps > 0
            ? climb(element, steps)
            : closestSafe(element, op.arg);
          if (target && target !== document.documentElement && target !== document.body) {
            out.push(target);
          }
        }
        return out;
      }
      default:
        return [];
    }
  }

  /**
   * Build a text predicate from a filter argument, which may be a plain string
   * or a /regular expression/.
   * @param {string} arg
   * @returns {(text: string) => boolean}
   */
  function textTester(arg) {
    const trimmed = arg.replace(/^["']|["']$/g, '');
    if (trimmed.length > 2 && trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
      const end = trimmed.lastIndexOf('/');
      const flags = trimmed.slice(end + 1).replace(/[^gimsuy]/g, '');
      try {
        const regex = new RegExp(trimmed.slice(1, end), flags.replace('g', ''));
        return (text) => regex.test(text);
      } catch {
        return () => false;
      }
    }
    const needle = trimmed.toLowerCase();
    return (text) => text.toLowerCase().includes(needle);
  }

  /**
   * @param {Element} element
   * @param {number} steps
   * @returns {Element|null}
   */
  function climb(element, steps) {
    let node = element;
    for (let i = 0; i < steps && node; i++) node = node.parentElement;
    return node;
  }

  /**
   * @param {Element} element
   * @param {string} selector
   * @returns {Element|null}
   */
  function closestSafe(element, selector) {
    try {
      return element.parentElement ? element.parentElement.closest(selector) : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {Element} element
   */
  function hide(element) {
    if (!element || element.hasAttribute(HIDDEN_ATTRIBUTE)) return;
    element.setAttribute(HIDDEN_ATTRIBUTE, '');
    element.style.setProperty('display', 'none', 'important');
  }

  /** Re-run the rules when the page changes, at a modest rate. */
  function watchForChanges() {
    if (observer !== null) return;
    observer = new MutationObserver(() => {
      if (rerunTimer !== 0) return;
      rerunTimer = window.setTimeout(() => {
        rerunTimer = 0;
        applyRules();
      }, RERUN_DEBOUNCE_MS);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'id', 'style']
    });
  }

  function disconnect() {
    if (observer !== null) {
      observer.disconnect();
      observer = null;
    }
  }

  /** Hide elements whose request we cancelled, in one DOM pass. */
  function runCollapse() {
    collapseTimer = 0;
    const urls = new Set(pendingCollapse);
    pendingCollapse.clear();
    if (urls.size === 0) return;

    const candidates = document.querySelectorAll(
      'img, iframe, video, audio, object, embed, source, picture'
    );
    for (const element of candidates) {
      if (element.hasAttribute(HIDDEN_ATTRIBUTE)) continue;
      const raw = element.getAttribute('src') || element.getAttribute('data') ||
        element.getAttribute('poster') || '';
      if (raw === '') continue;
      let absolute;
      try {
        absolute = new URL(raw, document.baseURI).href;
      } catch {
        continue;
      }
      if (!urls.has(absolute)) continue;
      const target = element.tagName === 'SOURCE' ? element.parentElement : element;
      if (target) collapseElement(target);
    }
  }

  /**
   * Collapse rather than merely hide: a blocked banner should not leave a gap.
   * @param {Element} element
   */
  function collapseElement(element) {
    element.setAttribute(HIDDEN_ATTRIBUTE, '');
    element.style.setProperty('display', 'none', 'important');
  }
})();
