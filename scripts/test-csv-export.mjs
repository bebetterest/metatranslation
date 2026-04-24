import assert from 'node:assert/strict';
import { escapeCsvCell } from '../src/lib/csv.ts';

test('quotes and escapes csv cells', () => {
  assert.equal(escapeCsvCell('hello, "world"'), '"hello, ""world"""');
  assert.equal(escapeCsvCell('line\nbreak'), '"line\nbreak"');
});

test('neutralizes spreadsheet formulas', () => {
  assert.equal(escapeCsvCell('=1+1'), "'=1+1");
  assert.equal(escapeCsvCell('+cmd'), "'+cmd");
  assert.equal(escapeCsvCell('-cmd'), "'-cmd");
  assert.equal(escapeCsvCell('@cmd'), "'@cmd");
});

test('does not alter ordinary text', () => {
  assert.equal(escapeCsvCell('plain text'), 'plain text');
  assert.equal(escapeCsvCell(42), '42');
});

async function test(name, fn) {
  await fn();
  console.log(`ok - ${name}`);
}
