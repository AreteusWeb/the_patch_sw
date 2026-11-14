'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { matchKeywords, normalizeText } = require('./keywordMatcher.cjs');

describe('normalizeText', () => {
  it('lowercases and strips accents', () => {
    assert.equal(normalizeText('ÚRGENTE Factúra'), 'urgente factura');
    assert.equal(normalizeText('Señor Niño'), 'senor nino');
  });
});

describe('matchKeywords', () => {
  it('matches against subject', () => {
    const hits = matchKeywords(
      { subject: 'Factura de marzo', from: 'billing@example.com' },
      ['factura', 'urgente']
    );
    assert.deepEqual(hits, ['factura']);
  });

  it('matches against from (accent-insensitive)', () => {
    const hits = matchKeywords(
      { subject: 'Hola', from: 'José Urgente <jose@example.com>' },
      ['urgente']
    );
    assert.deepEqual(hits, ['urgente']);
  });

  it('returns all matching keywords in input order', () => {
    const hits = matchKeywords(
      { subject: 'URGENTE: factura pendiente', from: 'a@b.com' },
      ['factura', 'spam', 'urgente']
    );
    assert.deepEqual(hits, ['factura', 'urgente']);
  });

  it('returns empty for no hits or empty inputs', () => {
    assert.deepEqual(matchKeywords({ subject: 'hi', from: 'x' }, ['zzz']), []);
    assert.deepEqual(matchKeywords(null, ['a']), []);
    assert.deepEqual(matchKeywords({ subject: 'a' }, null), []);
    assert.deepEqual(matchKeywords({ subject: 'a' }, []), []);
  });

  it('ignores blank keywords', () => {
    assert.deepEqual(
      matchKeywords({ subject: 'hola', from: '' }, ['', '  ', 'hola']),
      ['hola']
    );
  });
});
