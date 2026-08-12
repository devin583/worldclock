'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Config = require('../src/config.js');

test('normalization returns independent, versioned defaults', () => {
  const first = Config.normalizeConfig();
  const second = Config.normalizeConfig();

  assert.equal(first.version, 4);
  assert.equal(first.clockCount, 2);
  assert.equal(first.mode, 'digital');
  assert.equal(first.showSeconds, false);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.clocks, second.clocks);
  assert.notStrictEqual(first.clocks[0], second.clocks[0]);

  first.clocks[0].label = 'Changed';
  assert.equal(second.clocks[0].label, 'Budapest');
});

test('normalization rejects malformed fields and clamps numbers', () => {
  const config = Config.normalizeConfig({
    clocks: [
      { label: '\u0000'.repeat(3), tz: 'Not/A_Zone' },
      { label: '  A label longer than forty characters 1234567890  ', tz: 'Australia/Sydney' },
    ],
    clockCount: 99,
    mode: 'invalid',
    theme: 'invalid',
    surfaceStyle: 'invalid',
    surfaceStyleExplicit: true,
    timeFormat: 13,
    opacity: 100,
    pomodoro: { focusMinutes: -1, breakMinutes: 999 },
  });

  assert.deepEqual(config.clocks[0], { label: 'Budapest', tz: 'Europe/Budapest' });
  assert.equal(config.clocks[1].label.length, 40);
  assert.equal(config.clocks[1].tz, 'Australia/Sydney');
  assert.equal(config.clockCount, 2);
  assert.equal(config.mode, 'digital');
  assert.equal(config.theme, 'classic');
  assert.equal(config.surfaceStyle, 'transparent');
  assert.equal(config.timeFormat, '24');
  assert.equal(config.opacity, 1);
  assert.deepEqual(config.pomodoro, { focusMinutes: 1, breakMinutes: 60 });
});

test('legacy themes migrate and valid custom IANA zones survive', () => {
  const config = Config.normalizeConfig({
    theme: 'minimal-glass',
    clocks: [
      { label: 'Kathmandu', tz: 'Asia/Kathmandu' },
      { label: 'São Paulo', tz: 'America/Sao_Paulo' },
    ],
  });

  assert.equal(config.theme, 'glass');
  assert.equal(config.clocks[0].tz, 'Asia/Kathmandu');
  assert.equal(config.clocks[1].tz, 'America/Sao_Paulo');
  assert.equal(Config.isValidTimeZone('Pacific/Sydney'), false);
});

test('timezone search resolves list fragments and falls back safely', () => {
  assert.equal(Config.resolveTimezone('new_york', 'UTC'), 'America/New_York');
  assert.equal(Config.resolveTimezone('Australia/Sydney', 'UTC'), 'Australia/Sydney');
  assert.equal(Config.resolveTimezone('not a real zone', 'UTC'), 'UTC');
  assert.equal(Config.resolveTimezone('', 'Europe/Budapest'), 'Europe/Budapest');
});

test('preferred window sizes encode compact one-clock and roomy two-clock layouts', () => {
  assert.deepEqual(
    Config.preferredWindowSize({ clockCount: 1, mode: 'digital', showSeconds: false }),
    { width: 400, height: 220 },
  );
  assert.deepEqual(
    Config.preferredWindowSize({ clockCount: 1, mode: 'digital', showSeconds: true }),
    { width: 580, height: 240 },
  );
  assert.deepEqual(
    Config.preferredWindowSize({ clockCount: 2, mode: 'digital', showSeconds: false }),
    { width: 640, height: 260 },
  );
  assert.deepEqual(
    Config.preferredWindowSize({ clockCount: 2, mode: 'digital', showSeconds: true }),
    { width: 820, height: 260 },
  );
  assert.deepEqual(
    Config.preferredWindowSize({ clockCount: 2, mode: 'analog' }),
    { width: 660, height: 360 },
  );
  assert.deepEqual(
    Config.preferredWindowSize({ clockCount: 2, mode: 'both' }),
    { width: 820, height: 390 },
  );
});

test('window fitting is limited to layout-affecting production config fields', () => {
  const previous = Config.normalizeConfig();
  assert.equal(Config.shouldFitWindow(previous, {
    ...previous,
    theme: 'glass',
    opacity: 0.74,
    autostart: true,
    clocks: [{ ...previous.clocks[0], label: 'Home' }, previous.clocks[1]],
  }), false);
  assert.equal(Config.shouldFitWindow(previous, { ...previous, clockCount: 1 }), true);
  assert.equal(Config.shouldFitWindow(previous, { ...previous, mode: 'analog' }), true);
  assert.equal(Config.shouldFitWindow(previous, { ...previous, showSeconds: true }), true);
});
