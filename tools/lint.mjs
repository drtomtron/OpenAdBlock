#!/usr/bin/env node
/*
 * OpenAdBlock - dependency-free source checks
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Deliberately has no npm dependencies: `node tools/lint.mjs` works on a fresh
 * checkout with nothing installed. It checks syntax, file hygiene, licence
 * headers, and the content security rules a reviewed extension has to follow.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'web-ext-artifacts']);
const CHECKED_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.md', '.yml']);

/** @type {Array<{file: string, line: number|null, message: string}>} */
const problems = [];
let filesChecked = 0;

/**
 * @param {string} file
 * @param {number|null} line
 * @param {string} message
 */
function report(file, line, message) {
  problems.push({ file, line, message });
}

/**
 * @param {string} directory
 * @returns {string[]}
 */
function walk(directory) {
  const out = [];
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const files = walk(root).filter((path) => CHECKED_EXTENSIONS.has(extname(path)));

for (const path of files) {
  const name = relative(root, path).split('\\').join('/');
  const text = readFileSync(path, 'utf8');
  const extension = extname(path);
  filesChecked++;

  checkHygiene(name, text, extension === '.js' || extension === '.mjs' || extension === '.css');
  if (extension === '.json') checkJson(name, text);
  if (extension === '.js' || extension === '.mjs') checkJavaScript(name, path, text);
  if (extension === '.html') checkHtml(name, text);
  if (extension === '.css') checkLicence(name, text);
}

checkStructure();

/**
 * Whitespace, line endings and file endings.
 * @param {string} name
 * @param {string} text
 * @param {boolean} enforceLineLength only code files have a width limit
 */
function checkHygiene(name, text, enforceLineLength) {
  if (text.includes('\r')) report(name, null, 'carriage returns: files must use LF endings');
  if (text !== '' && !text.endsWith('\n')) report(name, null, 'missing trailing newline');

  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (line.includes('\t')) report(name, index + 1, 'tab character: use spaces');
    if (/[ \t]+$/.test(line)) report(name, index + 1, 'trailing whitespace');
    if (enforceLineLength && line.length > 120 && !/https?:\/\//.test(line)) {
      report(name, index + 1, 'line longer than 120 characters');
    }
  });
}

/**
 * @param {string} name
 * @param {string} text
 */
function checkJson(name, text) {
  try {
    JSON.parse(text);
  } catch (error) {
    report(name, null, 'invalid JSON: ' + error.message);
  }
}

/**
 * @param {string} name
 * @param {string} path
 * @param {string} text
 */
function checkJavaScript(name, path, text) {
  try {
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  } catch (error) {
    const detail = (error.stderr ? error.stderr.toString() : '').split('\n').slice(0, 4).join(' ').trim();
    report(name, null, 'syntax error: ' + detail);
  }

  checkLicence(name, text);

  if (name.startsWith('src/')) {
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (/\bconsole\.log\s*\(/.test(line)) {
        report(name, index + 1, 'console.log in shipped code');
      }
      if (/\.innerHTML\s*=/.test(line) && !/innerHTML = \[/.test(line)) {
        report(name, index + 1, 'innerHTML assignment: build nodes instead so list data cannot inject markup');
      }
      if (/\beval\s*\(|new Function\s*\(/.test(line)) {
        report(name, index + 1, 'eval or new Function is not allowed in an extension');
      }
      if (/\bdebugger\b/.test(line)) report(name, index + 1, 'debugger statement');
    });
  }
}

/**
 * Extension pages run under a content security policy that forbids inline
 * script, so catch it here rather than at install time.
 * @param {string} name
 * @param {string} text
 */
function checkHtml(name, text) {
  const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i;
  if (inlineScript.test(text)) {
    report(name, null, 'inline <script> content is blocked by the extension CSP');
  }
  const handler = /\son(?:click|load|change|submit|error|mouseover)\s*=/i.exec(text);
  if (handler) {
    report(name, null, 'inline event handler attribute (' + handler[0].trim() + ') is blocked by the CSP');
  }
  if (!/<html lang="/.test(text)) report(name, null, 'missing lang attribute on <html>');
  if (!/<meta charset="utf-8"/i.test(text)) report(name, null, 'missing utf-8 charset meta');
}

/**
 * @param {string} name
 * @param {string} text
 */
function checkLicence(name, text) {
  if (name.startsWith('test/') || name.startsWith('tools/')) {
    if (!text.includes('SPDX-License-Identifier')) report(name, null, 'missing SPDX licence line');
    return;
  }
  if (!name.startsWith('src/')) return;
  if (!text.includes('SPDX-License-Identifier: GPL-3.0-or-later')) {
    report(name, null, 'missing SPDX licence header');
  }
}

/** Project level expectations. */
function checkStructure() {
  const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) {
    report('src/manifest.json', null,
      'version ' + manifest.version + ' does not match package.json ' + pkg.version);
  }
  for (const required of ['README.md', 'LICENSE', 'CONTRIBUTING.md', 'CHANGELOG.md']) {
    try {
      statSync(join(root, required));
    } catch {
      report(required, null, 'required project file is missing');
    }
  }
}

/* Report ------------------------------------------------------------------ */

if (problems.length === 0) {
  console.log('lint: ' + filesChecked + ' files checked, no problems found');
  process.exit(0);
}

problems.sort((a, b) => (a.file === b.file ? (a.line || 0) - (b.line || 0) : a.file < b.file ? -1 : 1));
for (const problem of problems) {
  const where = problem.line === null ? problem.file : problem.file + ':' + problem.line;
  console.error(where + ': ' + problem.message);
}
console.error('\nlint: ' + problems.length + ' problem(s) in ' + filesChecked + ' files');
process.exit(1);
