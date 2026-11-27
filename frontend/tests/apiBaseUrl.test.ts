import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolveApiBaseUrl} from '../src/lib/apiBaseUrl.ts';

test('missing and blank API URLs use the current site', () => {
  for (const configured of [undefined, '', '  ']) {
    assert.equal(resolveApiBaseUrl(configured, 'https://preview.vercel.app'), 'https://preview.vercel.app');
  }
});

test('an explicit backend override is preserved without trailing slashes', () => {
  assert.equal(resolveApiBaseUrl(' https://api.example.com/ ', 'http://localhost:5173'), 'https://api.example.com');
});

test('local development uses the Vite origin for proxying', () => {
  assert.equal(resolveApiBaseUrl('', 'http://localhost:5173'), 'http://localhost:5173');
});
