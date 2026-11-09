/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Packaging checks: a broken reference in the manifest makes the extension
 * fail to load in Firefox, which is easy to miss until install time.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const srcDir = join(root, 'src');

const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const messages = JSON.parse(readFileSync(join(srcDir, '_locales', 'en', 'messages.json'), 'utf8'));

/**
 * @param {string} relative
 */
function assertExists(relative) {
  const path = join(srcDir, relative.replace(/^\//, ''));
  assert.ok(existsSync(path), 'missing file referenced by the manifest: ' + relative);
}

describe('manifest', () => {
  it('targets Manifest V2, which Firefox still supports for blocking webRequest', () => {
    assert.equal(manifest.manifest_version, 2);
  });

  it('has the same version as package.json', () => {
    assert.equal(manifest.version, pkg.version);
  });

  it('declares a Gecko application id', () => {
    assert.ok(manifest.browser_specific_settings.gecko.id);
    assert.match(manifest.browser_specific_settings.gecko.strict_min_version, /^\d+\.\d+$/);
  });

  it('asks for the permissions the blocker needs and nothing exotic', () => {
    const permissions = new Set(manifest.permissions);
    for (const needed of ['<all_urls>', 'webRequest', 'webRequestBlocking', 'storage', 'tabs']) {
      assert.ok(permissions.has(needed), 'missing permission: ' + needed);
    }
    // Permissions that would be a privacy red flag in an ad blocker.
    for (const unwanted of ['history', 'bookmarks', 'cookies', 'downloads', 'nativeMessaging', 'proxy']) {
      assert.equal(permissions.has(unwanted), false, 'unexpected permission: ' + unwanted);
    }
  });

  it('uses a background page so the code can be ES modules', () => {
    assert.ok(manifest.background.page);
    assert.equal(manifest.background.persistent, true);
    assertExists(manifest.background.page);
  });

  it('points at files that exist', () => {
    for (const icon of Object.values(manifest.icons)) assertExists(icon);
    for (const icon of Object.values(manifest.browser_action.default_icon)) assertExists(icon);
    assertExists(manifest.browser_action.default_popup);
    assertExists(manifest.options_ui.page);
    for (const script of manifest.content_scripts.flatMap((entry) => entry.js)) {
      assertExists(script);
    }
  });

  it('runs the content script early and in every frame', () => {
    const [entry] = manifest.content_scripts;
    assert.equal(entry.run_at, 'document_start');
    assert.equal(entry.all_frames, true);
    assert.deepEqual(entry.matches, ['http://*/*', 'https://*/*']);
  });

  it('resolves every localised manifest string', () => {
    const json = JSON.stringify(manifest);
    for (const match of json.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
      assert.ok(messages[match[1]], 'missing message: ' + match[1]);
      assert.ok(messages[match[1]].message, 'empty message: ' + match[1]);
    }
  });

  it('ships the on-demand picker files', () => {
    assertExists('content/picker.js');
    assertExists('content/picker.css');
    assertExists('pages/welcome.html');
  });
});
