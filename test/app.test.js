'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

function withServer(fn) {
  return new Promise((resolve, reject) => {
    const server = createApp().listen(0, async () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      try { await fn(base); resolve(); } catch (e) { reject(e); } finally { server.close(); }
    });
  });
}

test('GET /health répond ok', () => withServer(async (base) => {
  const res = await fetch(`${base}/health`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.status, 'ok');
}));

test('GET /api/inventory liste les dépendances', () => withServer(async (base) => {
  const body = await (await fetch(`${base}/api/inventory`)).json();
  assert.ok(body.dependencies.express);
}));

test("x-powered-by n'est pas exposé", () => withServer(async (base) => {
  const res = await fetch(`${base}/health`);
  assert.strictEqual(res.headers.get('x-powered-by'), null);
}));
