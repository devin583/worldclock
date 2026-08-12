'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TZ = require('../src/tz-util.js');

function clock(parts) {
  return [parts.h, parts.m, parts.s];
}

test('Budapest spring DST boundary is derived from the supplied instant', () => {
  const before = new Date('2026-03-29T00:59:59.000Z');
  const after = new Date('2026-03-29T01:00:00.000Z');

  assert.equal(TZ.offsetMin('Europe/Budapest', before), 60);
  assert.equal(TZ.offsetMin('Europe/Budapest', after), 120);
  assert.deepEqual(clock(TZ.parts('Europe/Budapest', before)), [1, 59, 59]);
  assert.deepEqual(clock(TZ.parts('Europe/Budapest', after)), [3, 0, 0]);
  assert.equal(TZ.offsetLabel('Europe/Budapest', before), 'UTC+1');
  assert.equal(TZ.offsetLabel('Europe/Budapest', after), 'UTC+2');
});

test('Shanghai remains fixed while its difference from Budapest changes with DST', () => {
  const winter = '2026-01-15T12:00:00.000Z';
  const summer = '2026-07-15T12:00:00.000Z';

  assert.equal(TZ.offsetMin('Asia/Shanghai', winter), 480);
  assert.equal(TZ.offsetMin('Asia/Shanghai', summer), 480);
  assert.equal(TZ.diffText('Asia/Shanghai', 'Europe/Budapest', 'en', 'Budapest', false, winter), '+7h vs Budapest');
  assert.equal(TZ.diffText('Asia/Shanghai', 'Europe/Budapest', 'en', 'Budapest', false, summer), '+6h vs Budapest');
});

test('New York spring DST boundary skips 02:00', () => {
  const before = '2026-03-08T06:59:59.000Z';
  const after = '2026-03-08T07:00:00.000Z';

  assert.equal(TZ.offsetMin('America/New_York', before), -300);
  assert.equal(TZ.offsetMin('America/New_York', after), -240);
  assert.deepEqual(clock(TZ.parts('America/New_York', before)), [1, 59, 59]);
  assert.deepEqual(clock(TZ.parts('America/New_York', after)), [3, 0, 0]);
  assert.equal(TZ.offsetLabel('America/New_York', before), 'UTC−5');
});

test('Sydney autumn DST boundary repeats the 02:00 hour', () => {
  const before = 1775318399000; // 2026-04-04T15:59:59Z
  const after = 1775318400000; // 2026-04-04T16:00:00Z

  assert.equal(TZ.offsetMin('Australia/Sydney', before), 660);
  assert.equal(TZ.offsetMin('Australia/Sydney', after), 600);
  assert.deepEqual(clock(TZ.parts('Australia/Sydney', before)), [2, 59, 59]);
  assert.deepEqual(clock(TZ.parts('Australia/Sydney', after)), [2, 0, 0]);
  assert.equal(TZ.isDay('Australia/Sydney', after), false);
});

test('half-hour and 45-minute zones retain minute precision', () => {
  const instant = '2026-06-01T00:00:00.000Z';

  assert.equal(TZ.offsetMin('Asia/Kolkata', instant), 330);
  assert.equal(TZ.offsetLabel('Asia/Kolkata', instant), 'UTC+5:30');
  assert.equal(TZ.offsetMin('Asia/Kathmandu', instant), 345);
  assert.equal(TZ.offsetLabel('Asia/Kathmandu', instant), 'UTC+5:45');
  assert.equal(TZ.diffText('Asia/Kathmandu', 'UTC', 'en', 'UTC', false, instant), '+5.75h vs UTC');
  assert.equal(TZ.diffText('Asia/Kathmandu', 'UTC', 'zh', '世界时', true, instant), '世界时 +5.75h');
});

test('invalid instants and IANA identifiers fail explicitly', () => {
  assert.throws(() => TZ.parts('UTC', 'not-a-date'), RangeError);
  assert.throws(() => TZ.offsetMin('Pacific/Sydney', '2026-01-01T00:00:00Z'), RangeError);
});
