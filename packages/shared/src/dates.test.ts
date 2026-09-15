import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeElapsed, formatClockTime, parseClockTime, toClockTime } from './dates.ts';

describe('parseClockTime', () => {
  it('reads both padded and unpadded hours', () => {
    assert.deepEqual(parseClockTime('17:30'), { hour: 17, minute: 30 });
    assert.deepEqual(parseClockTime('7:05'), { hour: 7, minute: 5 });
    assert.deepEqual(parseClockTime('00:00'), { hour: 0, minute: 0 });
    assert.deepEqual(parseClockTime('23:59'), { hour: 23, minute: 59 });
  });

  it('tolerates surrounding whitespace', () => {
    assert.deepEqual(parseClockTime('  9:15 '), { hour: 9, minute: 15 });
  });

  // The reason this returns null rather than clamping: `expo-notifications`
  // throws a RangeError for these from inside `scheduleNotificationAsync`, and
  // a caller cannot catch what it never scheduled.
  it('rejects out-of-range fields', () => {
    assert.equal(parseClockTime('24:00'), null);
    assert.equal(parseClockTime('12:60'), null);
    assert.equal(parseClockTime('99:99'), null);
  });

  it('rejects anything that is not HH:mm', () => {
    assert.equal(parseClockTime(''), null);
    assert.equal(parseClockTime('5pm'), null);
    assert.equal(parseClockTime('5:00 pm'), null);
    assert.equal(parseClockTime('17:3'), null);
    assert.equal(parseClockTime('17'), null);
  });
});

describe('toClockTime', () => {
  it('always pads to two digits, so the strings sort', () => {
    assert.equal(toClockTime({ hour: 7, minute: 5 }), '07:05');
    assert.equal(toClockTime({ hour: 0, minute: 0 }), '00:00');
    assert.equal(toClockTime({ hour: 23, minute: 59 }), '23:59');
  });

  it('round-trips through parseClockTime', () => {
    for (const value of ['00:00', '07:05', '12:30', '17:00', '23:59']) {
      assert.equal(toClockTime(parseClockTime(value)!), value);
    }
  });
});

describe('formatClockTime', () => {
  // The output itself is the device's convention and so is not asserted here.
  // What is asserted is that it prints *something* about the right hour, and
  // that a value it cannot read comes back untouched rather than as
  // "Invalid Date" on a settings row.
  it('prints the hour and minute', () => {
    const printed = formatClockTime('17:30');
    assert.match(printed, /30/);
    assert.match(printed, /17|5/);
  });

  it('passes unparseable input through', () => {
    assert.equal(formatClockTime('not a time'), 'not a time');
    assert.equal(formatClockTime(''), '');
  });
});

describe('describeElapsed', () => {
  const NOW = 1_800_000_000_000;
  const MINUTE = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  const ago = (ms: number) => describeElapsed(NOW - ms, NOW);

  it('holds still under a minute', () => {
    assert.equal(ago(0), 'Just now');
    assert.equal(ago(59 * 1000), 'Just now');
  });

  it('counts minutes, then hours', () => {
    assert.equal(ago(MINUTE), '1 min ago');
    assert.equal(ago(40 * MINUTE), '40 min ago');
    assert.equal(ago(HOUR), '1 hour ago');
    assert.equal(ago(5 * HOUR), '5 hours ago');
    assert.equal(ago(23 * HOUR), '23 hours ago');
  });

  // The boundary the whole thing exists for: a session logged this morning
  // reads in hours, and only a session from another day reads in days.
  it('turns over to days at twenty-four hours, not at midnight', () => {
    assert.equal(ago(DAY - 1), '23 hours ago');
    assert.equal(ago(DAY), '1 day ago');
    assert.equal(ago(3 * DAY), '3 days ago');
    assert.equal(ago(13 * DAY), '13 days ago');
  });

  it('coarsens to weeks and then months', () => {
    assert.equal(ago(14 * DAY), '2 weeks ago');
    assert.equal(ago(30 * DAY), '4 weeks ago');
    assert.equal(ago(60 * DAY), '2 months ago');
    assert.equal(ago(400 * DAY), '13 months ago');
  });

  // Clocks move backwards: a device correcting its time, or a row written by
  // another device a few seconds ahead. "In 4 seconds" is not a thing a log
  // should ever say.
  it('reads a future instant as just now', () => {
    assert.equal(describeElapsed(NOW + 5 * HOUR, NOW), 'Just now');
  });
});
