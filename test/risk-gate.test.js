'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evaluate } = require('../scripts/risk-gate');

function report(severities) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trivy-')), 'r.json');
  fs.writeFileSync(file, JSON.stringify({ Results: [{ Vulnerabilities: severities.map((s) => ({ Severity: s })) }] }));
  return file;
}

const base = {
  origin: 'dependabot',
  updateType: 'version-update:semver-patch',
  changedFiles: 'package.json\npackage-lock.json',
};

test('correctif Dependabot patch sans résiduel -> faible risque, admissible', () => {
  const r = evaluate({ ...base, trivyReport: report(['LOW', 'MEDIUM']) });
  assert.strictEqual(r.risk, 'low');
  assert.strictEqual(r.eligible, true);
});

test('mise à jour majeure -> non admissible, risque élevé', () => {
  const r = evaluate({ ...base, updateType: 'version-update:semver-major', trivyReport: report([]) });
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.risk, 'high');
});

test('résiduel HIGH -> non admissible', () => {
  const r = evaluate({ ...base, trivyReport: report(['HIGH']) });
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.risk, 'moderate');
});

test('code applicatif modifié -> non admissible', () => {
  const r = evaluate({ ...base, changedFiles: 'package.json\nsrc/app.js', trivyReport: report([]) });
  assert.strictEqual(r.eligible, false);
});

test('livraison manuelle -> chemin normal', () => {
  const r = evaluate({ ...base, origin: 'manual', trivyReport: report([]) });
  assert.strictEqual(r.eligible, false);
});
