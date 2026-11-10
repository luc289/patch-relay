#!/usr/bin/env node
'use strict';

/**
 * Déduit le type de mise à jour semver à partir du diff d'une PR (stdin),
 * en comparant les versions des dépendances déclarées dans package.json.
 * Sert de repli quand Dependabot ne fournit pas update-type (cas des mises à
 * jour de sécurité qui touchent plusieurs dépendances liées).
 *
 *   gh pr diff 12 | node scripts/update-type.js
 *   -> version-update:semver-minor
 */

const LEVELS = ['', 'semver-patch', 'semver-minor', 'semver-major'];

function parse(v) {
  const m = String(v).match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : null;
}

function level(from, to) {
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return 3; // version non comparable : traitée comme majeure
  if (b[0] !== a[0]) return 3;
  if (b[1] !== a[1]) return 2;
  if (b[2] !== a[2]) return 1;
  return 0;
}

function fromDiff(diff) {
  const removed = {};
  const added = {};
  let inManifest = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) { inManifest = / b\/package\.json$/.test(line); continue; }
    if (!inManifest || line.startsWith('---') || line.startsWith('+++')) continue;
    const m = line.match(/^([+-])\s*"([^"]+)":\s*"([^"]+)"/);
    if (!m || ['name', 'version', 'description', 'main'].includes(m[2])) continue;
    (m[1] === '-' ? removed : added)[m[2]] = m[3];
  }
  let max = 0;
  for (const dep of Object.keys(added)) {
    if (removed[dep]) max = Math.max(max, level(removed[dep], added[dep]));
  }
  return max ? `version-update:${LEVELS[max]}` : '';
}

if (require.main === module) {
  let input = '';
  process.stdin.on('data', (c) => { input += c; });
  process.stdin.on('end', () => console.log(fromDiff(input)));
}

module.exports = { fromDiff, level };
