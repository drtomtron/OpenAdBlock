/*
 * OpenAdBlock - element picker ("block an element on this page")
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Injected on demand by the background page. Hover highlights an element,
 * click selects it, and the panel shows the element hiding filter that would
 * be written before anything is saved.
 */

(() => {
  'use strict';

  if (window.__openAdBlockPicker) {
    window.__openAdBlockPicker.focus();
    return;
  }

  const ROOT_ID = 'openadblock-picker-root';
  /** Class names that look machine generated and so make poor filters. */
  const UNSTABLE_CLASS = /(^|[-_])(?:[0-9a-f]{6,}|\d{3,})([-_]|$)|^css-[a-z0-9]+$|^[a-z]{1,2}\d+$/i;
  const MAX_DEPTH = 6;

  let target = null;
  /** The element the user actually pointed at, before any widening. */
  let anchor = null;
  let depth = 0;
  let root = null;
  let highlight = null;
  let label = null;
  let filterText = '';

  build();
  window.__openAdBlockPicker = { focus: () => root && root.focus(), stop };

  /** Create the picker chrome. */
  function build() {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('tabindex', '-1');
    root.innerHTML = [
      '<div id="openadblock-picker-highlight"></div>',
      '<div id="openadblock-picker-panel" role="dialog" aria-label="OpenAdBlock element picker">',
      '  <div id="openadblock-picker-title">Pick an element to block</div>',
      '  <code id="openadblock-picker-filter">Hover over the page</code>',
      '  <div id="openadblock-picker-hint">Click an element. Use the buttons or the up',
      '  and down arrow keys to widen the selection. Escape cancels.</div>',
      '  <div id="openadblock-picker-actions">',
      '    <button type="button" id="openadblock-picker-wider">Wider</button>',
      '    <button type="button" id="openadblock-picker-narrower">Narrower</button>',
      '    <button type="button" id="openadblock-picker-block" disabled>Block it</button>',
      '    <button type="button" id="openadblock-picker-cancel">Cancel</button>',
      '  </div>',
      '</div>'
    ].join('');
    document.documentElement.appendChild(root);

    highlight = root.querySelector('#openadblock-picker-highlight');
    label = root.querySelector('#openadblock-picker-filter');

    root.querySelector('#openadblock-picker-wider').addEventListener('click', () => adjust(1));
    root.querySelector('#openadblock-picker-narrower').addEventListener('click', () => adjust(-1));
    root.querySelector('#openadblock-picker-block').addEventListener('click', commit);
    root.querySelector('#openadblock-picker-cancel').addEventListener('click', stop);

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition, true);
    root.focus();
  }

  /**
   * @param {MouseEvent} event
   */
  function onMouseMove(event) {
    if (isOwn(event.target)) return;
    depth = 0;
    select(event.target);
  }

  /**
   * @param {MouseEvent} event
   */
  function onClick(event) {
    if (isOwn(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    document.removeEventListener('mousemove', onMouseMove, true);
    select(event.target);
  }

  /**
   * @param {KeyboardEvent} event
   */
  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      stop();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      adjust(1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      adjust(-1);
    } else if (event.key === 'Enter' && target) {
      event.preventDefault();
      commit();
    }
  }

  /**
   * @param {EventTarget|null} node
   * @returns {boolean}
   */
  function isOwn(node) {
    return Boolean(node && node instanceof Element && node.closest('#' + ROOT_ID));
  }

  /**
   * @param {number} direction 1 to select the parent, -1 to go back down
   */
  function adjust(direction) {
    if (!target || !anchor) return;
    depth = Math.max(0, Math.min(MAX_DEPTH, depth + direction));
    select(anchor);
  }

  /**
   * Highlight an element and show the filter it would produce.
   * @param {EventTarget|null} node
   */
  function select(node) {
    if (!(node instanceof Element)) return;
    anchor = node;
    let element = node;
    for (let i = 0; i < depth && element.parentElement; i++) {
      if (element.parentElement === document.body) break;
      element = element.parentElement;
    }
    target = element;

    filterText = buildFilter(element);
    label.textContent = filterText;
    root.querySelector('#openadblock-picker-block').disabled = false;
    reposition();
  }

  /** Move the highlight box over the current target. */
  function reposition() {
    if (!target || !highlight) return;
    const rect = target.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.top = rect.top + 'px';
    highlight.style.left = rect.left + 'px';
    highlight.style.width = rect.width + 'px';
    highlight.style.height = rect.height + 'px';
  }

  /**
   * Build the element hiding filter for an element.
   * @param {Element} element
   * @returns {string}
   */
  function buildFilter(element) {
    return location.hostname + '##' + buildSelector(element);
  }

  /**
   * A selector that is specific enough to be useful but not so specific that
   * it breaks on the next page load.
   * @param {Element} element
   * @returns {string}
   */
  function buildSelector(element) {
    if (element.id && isStable(element.id)) return '#' + cssEscape(element.id);

    const parts = [];
    let node = element;
    for (let i = 0; i < 4 && node && node !== document.body; i++) {
      parts.unshift(describe(node));
      if (document.querySelectorAll(parts.join(' > ')).length === 1) break;
      node = node.parentElement;
    }
    return parts.join(' > ') || element.tagName.toLowerCase();
  }

  /**
   * One step of a selector: tag plus any usable classes, falling back to the
   * position among siblings.
   * @param {Element} element
   * @returns {string}
   */
  function describe(element) {
    const tag = element.tagName.toLowerCase();
    if (element.id && isStable(element.id)) return tag + '#' + cssEscape(element.id);

    const classes = Array.from(element.classList)
      .filter(isStable)
      .slice(0, 3)
      .map((name) => '.' + cssEscape(name));
    if (classes.length > 0) return tag + classes.join('');

    const attribute = usableAttribute(element);
    if (attribute) return tag + attribute;

    const parent = element.parentElement;
    if (!parent) return tag;
    const sameTag = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
    if (sameTag.length < 2) return tag;
    return tag + ':nth-of-type(' + (sameTag.indexOf(element) + 1) + ')';
  }

  /**
   * Attributes that identify ad slots reliably enough to filter on.
   * @param {Element} element
   * @returns {string}
   */
  function usableAttribute(element) {
    for (const name of ['data-ad-slot', 'data-ad-client', 'data-testid', 'aria-label', 'role', 'name']) {
      const value = element.getAttribute(name);
      if (value && value.length < 40 && isStable(value)) {
        return '[' + name + '="' + value.replace(/"/g, '\\"') + '"]';
      }
    }
    return '';
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  function isStable(name) {
    return typeof name === 'string' && name.length > 1 && name.length < 40 &&
      !UNSTABLE_CLASS.test(name) && !/\s/.test(name);
  }

  /**
   * @param {string} value
   * @returns {string}
   */
  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return value.replace(/[^\w-]/g, (ch) => '\\' + ch);
  }

  /** Save the filter and hide the element. */
  function commit() {
    if (!target || filterText === '') return;
    const element = target;
    browser.runtime
      .sendMessage({ type: 'filters:add-user-filter', text: filterText })
      .then((result) => {
        if (result && result.ok) {
          element.style.setProperty('display', 'none', 'important');
        } else if (result && result.error) {
          label.textContent = 'Could not save: ' + result.error;
          return;
        }
        stop();
      })
      .catch(() => stop());
  }

  /** Remove the picker. */
  function stop() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition, true);
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    target = null;
    delete window.__openAdBlockPicker;
  }
})();
