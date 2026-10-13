import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurnManager, isBackchannel, endsWithDanglingWord } from './turnManager.js';

function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
  };
}

function setup(opts = {}) {
  const clock = fakeClock();
  const turns = [];
  const tm = createTurnManager({
    onInterviewerTurn: (text, meta) => turns.push({ text, ...meta }),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...opts,
  });
  const I = (text, isFinal = true) => tm.handleTranscript({ speaker: 'interviewer', text, isFinal });
  const A = (text, isFinal = true) => tm.handleTranscript({ speaker: 'applicant', text, isFinal });
  return { clock, turns, tm, I, A };
}

test('joins interviewer utterances into one turn and sends it after a pause', () => {
  const { clock, turns, I } = setup({ turnGapMs: 900 });
  I('okay next topic');
  clock.advance(500);
  I('how would you', false);
  clock.advance(2000); // still speaking -> nothing sent
  assert.equal(turns.length, 0);
  I('how would you shard a postgres table');
  clock.advance(899);
  assert.equal(turns.length, 0);
  clock.advance(1);
  assert.deepEqual(turns, [{ text: 'okay next topic how would you shard a postgres table', reason: 'pause' }]);
});

test('applicant starting to answer completes the interviewer turn immediately', () => {
  const { turns, I, A } = setup();
  I('what is a closure in javascript');
  A('so a closure is', false);
  assert.deepEqual(turns, [{ text: 'what is a closure in javascript', reason: 'applicant_started' }]);
});

test('applicant backchannel does not cut the interviewer off', () => {
  const { clock, turns, I, A } = setup({ turnGapMs: 900 });
  I('tell me about a hard bug');
  A('yeah');
  A('mm hmm okay');
  assert.equal(turns.length, 0);
  I('you fixed recently');
  clock.advance(900);
  assert.deepEqual(turns, [{ text: 'tell me about a hard bug you fixed recently', reason: 'pause' }]);
});

test('applicant speech while interviewer is mid-utterance is ignored', () => {
  const { turns, I, A } = setup();
  I('explain event loop');
  I('and how', false);
  A('i think the event loop');
  assert.equal(turns.length, 0);
});

test('applicant speech is never sent as a question', () => {
  const { clock, turns, A } = setup();
  A('i would use a token bucket in redis');
  clock.advance(10000);
  assert.equal(turns.length, 0);
});

test('dangling ending waits once more before sending', () => {
  const { clock, turns, I } = setup({ turnGapMs: 900, danglingExtraMs: 1200 });
  I('what is the difference between tcp and');
  clock.advance(900);
  assert.equal(turns.length, 0);
  I('udp');
  clock.advance(900);
  assert.deepEqual(turns.map((t) => t.text), ['what is the difference between tcp and udp']);

  I('compare rest with');
  clock.advance(900 + 1200);
  assert.deepEqual(turns.map((t) => t.text).slice(1), ['compare rest with']);
});

test('empty interviewer final (all filler) still ends the utterance', () => {
  const { clock, turns, I } = setup({ turnGapMs: 900 });
  I('design a url shortener');
  I('thank', false);
  I('', true);
  clock.advance(900);
  assert.deepEqual(turns.map((t) => t.text), ['design a url shortener']);
});

test('stalled partial eventually flushes what was already final', () => {
  const { clock, turns, I } = setup({ partialStallMs: 4000 });
  I('what is kubernetes');
  I('and', false);
  clock.advance(3999);
  assert.equal(turns.length, 0);
  clock.advance(1);
  assert.deepEqual(turns, [{ text: 'what is kubernetes', reason: 'stalled' }]);
});

test('very long interviewer turn is cut at maxTurnMs', () => {
  const { clock, turns, I } = setup({ maxTurnMs: 5000, turnGapMs: 900 });
  I('so we are a fintech company');
  clock.advance(500);
  I('our stack', false); // keeps talking, no pause long enough to end the turn
  clock.advance(2500);
  I('our stack is node and postgres');
  clock.advance(500);
  I('how would', false);
  clock.advance(1600);
  assert.equal(turns.length, 0);
  I('how would you scale it');
  assert.equal(turns.length, 1);
  assert.equal(turns[0].reason, 'max_length');
  assert.equal(turns[0].text, 'so we are a fintech company our stack is node and postgres how would you scale it');
});

test('flushNow and reset', () => {
  const { turns, tm, I } = setup();
  I('what is a mutex');
  tm.flushNow();
  assert.deepEqual(turns.map((t) => t.reason), ['manual']);
  I('what is a semaphore');
  tm.reset();
  tm.flushNow();
  assert.equal(turns.length, 1);
});

test('helpers', () => {
  assert.ok(isBackchannel('Yeah, okay.'));
  assert.ok(!isBackchannel('yeah so i would use redis'));
  assert.ok(endsWithDanglingWord('difference between tcp and'));
  assert.ok(endsWithDanglingWord('what kind of'));
  assert.ok(!endsWithDanglingWord('what is udp'));
});
