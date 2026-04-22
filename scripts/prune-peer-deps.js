#!/usr/bin/env node
/**
 * prune-peer-deps.js
 *
 * Runs as a postinstall step in @zorbit-platform/sdk-node.
 *
 * Purpose
 * -------
 * When the SDK is installed into a consumer repo via `file:` reference, npm
 * symlinks the SDK directory by default. The SDK has its own node_modules/
 * (populated with devDependencies for building + testing: @nestjs/*,
 * typeorm, reflect-metadata). Node's module resolution, walking the real
 * path from the symlinked SDK, resolves @nestjs/typeorm and typeorm from
 * THE SDK's nested node_modules/ FIRST — before the consumer's top-level
 * copy.
 *
 * That produces two separate instances of @nestjs/typeorm and typeorm in
 * the running process. getRepositoryToken() from one instance returns a
 * symbol that doesn't match the token TypeOrmModule.forFeature() registers
 * in the consumer's instance. DI throws `undefinedRepository`.
 *
 * Fix — strip peer-dep copies from the SDK's own node_modules after every
 * install. The SDK only needs those packages at BUILD time (tsc). Once
 * dist/ is produced, they can go. Any consumer that imports
 * @zorbit-platform/sdk-node will then always resolve peer deps from the
 * consumer's top-level node_modules/.
 *
 * This script is idempotent and safe — it only removes directories we
 * explicitly list as peer dependencies.
 *
 * See ENTITY-CRUD-DI-FIX.md for the full write-up.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Peer dependencies that MUST be resolved from the consumer, not the SDK.
// Kept in sync with package.json "peerDependencies".
const PEER_DEPS = [
  '@nestjs/common',
  '@nestjs/config',
  '@nestjs/core',
  '@nestjs/passport',
  '@nestjs/typeorm',
  'passport',
  'passport-jwt',
  'reflect-metadata',
  'rxjs',
  'typeorm',
];

// Only prune when we are INSIDE the SDK's own node_modules/. When the SDK
// is being installed into a consumer (as the "@zorbit-platform/sdk-node"
// package), __dirname is <consumer>/node_modules/@zorbit-platform/sdk-node/
// scripts/. In that case we still want to prune — the consumer's top-level
// node_modules is one directory up from our package root.
const sdkRoot = path.resolve(__dirname, '..');
const sdkNodeModules = path.join(sdkRoot, 'node_modules');

if (!fs.existsSync(sdkNodeModules)) {
  // Fresh clone before `npm install` — nothing to prune.
  process.exit(0);
}

// Distinguish "SDK in development" (the SDK repo itself, where devDeps must
// stay so `jest` + `tsc` run) from "SDK installed under a consumer" (where
// peer-dep copies cause the DI mismatch and must be removed).
//
// Signal: if the SDK's parent directory is called `node_modules`, we are a
// nested install → prune. Otherwise we are at the repo root → leave alone.
const parent = path.basename(path.dirname(sdkRoot));
const grandparent = path.basename(path.dirname(path.dirname(sdkRoot)));
const isNestedInstall =
  parent === 'node_modules' || grandparent === 'node_modules';

// Explicit opt-in: consumers can set ZORBIT_SDK_FORCE_PRUNE=1 if they pin
// the SDK differently. And opt-out: set ZORBIT_SDK_SKIP_PRUNE=1 when you
// know what you're doing.
const forcePrune = process.env.ZORBIT_SDK_FORCE_PRUNE === '1';
const skipPrune = process.env.ZORBIT_SDK_SKIP_PRUNE === '1';

if (skipPrune) {
  process.exit(0);
}
if (!isNestedInstall && !forcePrune) {
  // SDK own repo during `npm install`. Keep devDependencies in place so
  // tests and `tsc` can run.
  process.exit(0);
}

let prunedCount = 0;
const pruned = [];
for (const dep of PEER_DEPS) {
  const target = path.join(sdkNodeModules, dep);
  try {
    const stat = fs.lstatSync(target);
    if (!stat) continue;
    // fs.rmSync recursive=true handles both directories and symlinks.
    fs.rmSync(target, { recursive: true, force: true });
    prunedCount += 1;
    pruned.push(dep);
  } catch (e) {
    if (e && e.code === 'ENOENT') continue;
    // Non-fatal — log and keep going. Pruning is best-effort.
    // eslint-disable-next-line no-console
    console.warn(
      '[zorbit-sdk-node] prune-peer-deps: could not remove ' +
        dep +
        ' (' +
        (e && e.code ? e.code : 'unknown') +
        ')',
    );
  }
}

// Also clean up empty parent dirs (@nestjs/, etc.) so `npm ls` is tidy.
const orgDirs = ['@nestjs'];
for (const org of orgDirs) {
  const dir = path.join(sdkNodeModules, org);
  try {
    const entries = fs.readdirSync(dir);
    if (entries.length === 0) {
      fs.rmdirSync(dir);
    }
  } catch (e) {
    /* ignore */
  }
}

if (prunedCount > 0 && process.env.ZORBIT_SDK_PRUNE_SILENT !== '1') {
  // eslint-disable-next-line no-console
  console.log(
    '[zorbit-sdk-node] pruned ' +
      prunedCount +
      ' peer-dep cop' +
      (prunedCount === 1 ? 'y' : 'ies') +
      ' from SDK node_modules (' +
      pruned.join(', ') +
      ') — resolving from consumer.',
  );
}
