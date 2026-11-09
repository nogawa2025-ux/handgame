import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMatchState } from '../src/sim/state.js';
import { step } from '../src/sim/step.js';
import { encodeSnapshot, decodeSnapshot, SnapshotBuffer } from '../src/net/sync.js';
import { joinRoom, wrapConn } from '../src/net/peer.js';

test('encode/decode snapshot round-trips positions within 0.01', () => {
  const s = createMatchState();
  for (let i = 0; i < 400; i++) step(s, [null, null], 1 / 60);
  const d = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(s))));
  s.players.forEach((p, i) => {
    assert.ok(Math.abs(p.x - d.players[i].x) <= 0.01);
    assert.ok(Math.abs(p.z - d.players[i].z) <= 0.01);
    assert.equal(p.anim, d.players[i].anim);
  });
  assert.ok(Math.abs(s.ball.y - d.ball.y) <= 0.01);
  assert.equal(d.ball.holder, s.ball.holder);
  assert.deepEqual(d.score, s.score);
  assert.equal(d.phase, s.phase);
  assert.deepEqual(d.controlled, s.controlled);
  assert.deepEqual(d.bench.map((b) => b.map((x) => x.num)), s.bench.map((b) => b.map((x) => x.num)));
  assert.deepEqual(d.players.map((p) => p.num), s.players.map((p) => p.num));
  s.players.forEach((p, i) => assert.ok(Math.abs(p.stamina - d.players[i].stamina) <= 0.01));
  s.attack = { team: 1, time: 16, warned: true };
  const w = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(s))));
  assert.equal(w.attack.warned, true);
  assert.equal(w.attack.team, 1);
});

const at = (x) => { const s = createMatchState(); s.players[3].x = x; s.ball.x = x; return s; };

test('SnapshotBuffer interpolates midway', () => {
  const buf = new SnapshotBuffer(0.1);
  buf.push(at(0), 1.0);
  buf.push(at(2), 1.05);
  const s = buf.sample(1.125); // render time 1.025 → halfway
  assert.ok(Math.abs(s.players[3].x - 1) < 1e-6);
  assert.ok(Math.abs(s.ball.x - 1) < 1e-6);
});

test('SnapshotBuffer holds last snapshot when starved', () => {
  const buf = new SnapshotBuffer(0.1);
  buf.push(at(0), 1.0);
  buf.push(at(2), 1.05);
  const s = buf.sample(5);
  assert.equal(s.players[3].x, 2);
});

class FakePeer extends EventEmitter {
  constructor(id) { super(); this.id = id ?? 'guest-x'; setTimeout(() => this.emit('open', this.id), 0); }
  connect() {
    const dc = new EventEmitter();
    setTimeout(() => this.emit('error', { type: 'peer-unavailable' }), 0);
    return dc;
  }
  destroy() {}
}

test('join fails on unknown room', async () => {
  await assert.rejects(joinRoom('ABCDE', FakePeer), { message: 'NOT_FOUND' });
});

test('disconnect emits close', () => {
  const dc = new EventEmitter();
  dc.send = () => {};
  dc.close = () => {};
  const conn = wrapConn(dc, { destroy() {}, on() {} }, { heartbeat: false });
  let n = 0;
  conn.onClose(() => n++);
  dc.emit('close');
  dc.emit('close');
  assert.equal(n, 1);
});

test('messages reach listeners and can be unsubscribed', () => {
  const dc = new EventEmitter();
  dc.send = () => {};
  dc.close = () => {};
  const conn = wrapConn(dc, { destroy() {}, on() {} }, { heartbeat: false });
  const got = [];
  const off = conn.on('input', (m) => got.push(m.seq));
  dc.emit('data', { t: 'input', seq: 1 });
  off();
  dc.emit('data', { t: 'input', seq: 2 });
  assert.deepEqual(got, [1]);
});
