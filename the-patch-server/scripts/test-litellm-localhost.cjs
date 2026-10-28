'use strict';
/**
 * Unit checks for llm/adapters/litellm.cjs#isLocalHost.
 *   node scripts/test-litellm-localhost.cjs
 */
const assert = require('assert');
const { isLocalHost } = require('../llm/adapters/litellm.cjs');

assert.strictEqual(isLocalHost('http://localhost:4000/v1'), true);
assert.strictEqual(isLocalHost('http://127.0.0.1:4000'), true);
assert.strictEqual(isLocalHost('http://[::1]:4000/v1'), true);
assert.strictEqual(isLocalHost('https://localhost.evil.com/v1'), false);
assert.strictEqual(isLocalHost('https://mi-gateway.run.app/?x=localhost'), false);
assert.throws(
  () => isLocalHost('not-a-url'),
  (err) => err instanceof Error && /not a valid URL/i.test(err.message)
);
assert.throws(
  () => isLocalHost(''),
  (err) => err instanceof Error && /not a valid URL/i.test(err.message)
);

console.log('isLocalHost tests passed');
