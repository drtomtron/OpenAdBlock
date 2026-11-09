#!/usr/bin/env node
/*
 * OpenAdBlock - package the extension
 * Copyright (C) 2026 OpenAdBlock contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Produces dist/openadblock-<version>.zip, which can be loaded in Firefox as a
 * temporary add-on or uploaded to addons.mozilla.org. The ZIP writer is built
 * on node:zlib so a release needs no npm dependencies at all, and timestamps
 * are fixed so the same source always produces an identical archive.
 */

import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const distDir = join(root, 'dist');

/** Fixed DOS timestamp (1 January 1980) for reproducible archives. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/**
 * Every file that goes into the package.
 * @param {string} directory
 * @returns {string[]} absolute paths
 */
function collect(directory) {
  const out = [];
  for (const entry of readdirSync(directory).sort()) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...collect(path));
    else out.push(path);
  }
  return out;
}

/** Read the manifest and package.json, package everything, report. */
function main() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'));

  if (manifest.version !== pkg.version) {
    console.error('build: src/manifest.json version ' + manifest.version +
      ' does not match package.json ' + pkg.version);
    process.exit(1);
  }

  const entries = collect(srcDir).map((path) => ({
    name: relative(srcDir, path).split('\\').join('/'),
    data: readFileSync(path)
  }));
  // The licence travels with the package.
  entries.push({ name: 'LICENSE', data: readFileSync(join(root, 'LICENSE')) });
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));

  mkdirSync(distDir, { recursive: true });
  const outputPath = join(distDir, 'openadblock-' + pkg.version + '.zip');
  writeFileSync(outputPath, buildZip(entries));

  const totalBytes = entries.reduce((sum, entry) => sum + entry.data.length, 0);
  const packedBytes = statSync(outputPath).size;
  console.log('build: ' + entries.length + ' files, ' + formatBytes(totalBytes) +
    ' source, ' + formatBytes(packedBytes) + ' packed');
  console.log('build: ' + relative(root, outputPath).split('\\').join('/'));
  console.log('');
  console.log('To try it: Firefox -> about:debugging -> This Firefox ->');
  console.log('Load Temporary Add-on -> pick src/manifest.json (or this zip).');
}

/* ZIP writing ------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

/**
 * @param {Buffer} buffer
 * @returns {number}
 */
function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (~crc) >>> 0;
}

/**
 * Build a ZIP archive. Each entry is deflated unless that would make it
 * bigger, in which case it is stored.
 *
 * @param {Array<{name: string, data: Buffer}>} files
 * @returns {Buffer}
 */
function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const deflated = deflateRawSync(file.data, { level: 9 });
    const useDeflate = deflated.length < file.data.length;
    const payload = useDeflate ? deflated : file.data;
    const method = useDeflate ? 8 : 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 names
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBytes, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(DOS_TIME, 12);
    centralHeader.writeUInt16LE(DOS_DATE, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attributes
    centralHeader.writeUInt32LE(0o644 << 16, 38); // external attributes
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + payload.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, end]);
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

main();
