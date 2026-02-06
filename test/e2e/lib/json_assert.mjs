#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

function usage() {
  console.error(
    'Usage: json_assert.mjs <exists|equals|contains|normalize> <file> <path?> <value?> <output?>',
  );
  process.exit(2);
}

function tokenize(path) {
  const tokens = [];
  const regex = /([^[.\]]+)|\[(\d+)\]/g;
  let match;
  while ((match = regex.exec(path)) !== null) {
    if (match[1]) {
      tokens.push(match[1]);
    } else if (match[2]) {
      tokens.push(Number(match[2]));
    }
  }
  return tokens;
}

function resolvePath(root, path) {
  if (!path) {
    return { ok: true, value: root };
  }
  const tokens = tokenize(path);
  let current = root;
  for (const token of tokens) {
    if (current === null || current === undefined || !(token in current)) {
      return { ok: false, value: undefined };
    }
    current = current[token];
  }
  return { ok: true, value: current };
}

function parseExpected(raw) {
  if (raw === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function stable(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stable(entry));
  }
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = stable(value[key]);
    }
    return sorted;
  }
  return value;
}

const [, , mode, filePath, pathArg, valueArg, outPath] = process.argv;
if (!mode || !filePath) {
  usage();
}

const payloadRaw = await readFile(filePath, 'utf8');
const payload = JSON.parse(payloadRaw);

if (mode === 'normalize') {
  if (!pathArg) {
    usage();
  }
  const cloned = JSON.parse(JSON.stringify(payload));
  if (cloned?.run && typeof cloned.run === 'object') {
    delete cloned.run.timestampISO;
  }
  const normalized = JSON.stringify(stable(cloned), null, 2) + '\n';
  await writeFile(pathArg, normalized, 'utf8');
  process.exit(0);
}

const resolved = resolvePath(payload, pathArg);

if (mode === 'exists') {
  if (!resolved.ok) {
    console.error(`Path not found: ${pathArg}`);
    process.exit(1);
  }
  process.exit(0);
}

if (!resolved.ok) {
  console.error(`Path not found: ${pathArg}`);
  process.exit(1);
}

if (mode === 'equals') {
  const expected = parseExpected(valueArg);
  const actual = resolved.value;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(
      `Mismatch at ${pathArg}. expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    );
    process.exit(1);
  }
  process.exit(0);
}

if (mode === 'contains') {
  const needle = parseExpected(valueArg);
  const actual = resolved.value;
  if (typeof actual === 'string') {
    if (!actual.includes(String(needle))) {
      console.error(`String at ${pathArg} does not contain ${needle}`);
      process.exit(1);
    }
    process.exit(0);
  }
  if (Array.isArray(actual)) {
    const found = actual.some((entry) => JSON.stringify(entry) === JSON.stringify(needle));
    if (!found) {
      console.error(`Array at ${pathArg} does not contain ${JSON.stringify(needle)}`);
      process.exit(1);
    }
    process.exit(0);
  }
  console.error(`Contains mode unsupported for path ${pathArg}`);
  process.exit(1);
}

if (outPath) {
  void outPath;
}

usage();
