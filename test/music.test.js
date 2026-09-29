import test from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_MS, BEAT_OFFSET_MS, beatPhase, nextBeat, nearestBeat, releaseBeat, beatPlaybackRate, createMotionMusic } from '../src/music.js';

class AudioStub extends EventTarget {
  currentTime = 0;
  duration = 100;
  paused = true;
  plays = 0;
  async play() { this.plays++; this.paused = false; }
  pause() { this.paused = true; }
  removeAttribute() {}
  load() {}
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('music alone fades to the next beat; a new gesture cancels the tail', async () => {
  const audio = new AudioStub();
  audio.volume = .8;
  let tick, saved;
  const music = createMotionMusic(audio, {
    enabled: true, onPosition(value) { saved = value; }, onError() {},
    schedule(callback) { tick = callback; return 1; }, cancel() { tick = null; },
  });
  audio.dispatchEvent(new Event('loadedmetadata'));
  music.setActive(true);
  await flush();
  audio.currentTime = .2;
  music.finishOnBeat();
  const end = nextBeat(200);
  assert.equal(audio.paused, false);
  audio.currentTime = (200 + end) / 2000;
  tick();
  assert.ok(audio.volume > 0 && audio.volume < .8);
  music.setActive(true);
  assert.equal(tick, null);
  assert.equal(audio.volume, .8);
  music.finishOnBeat();
  audio.currentTime = (end + 3) / 1000;
  tick();
  assert.equal(audio.paused, true);
  assert.ok(Math.abs(saved * 1000 - end) < 1e-6);
  assert.equal(audio.volume, .8);
  music.dispose();
});

test('release has room to animate near a beat; automatic correction is bounded and wraps correctly', () => {
  for (let time = 0; time < 5000; time += 7) {
    const duration = releaseBeat(time) - time;
    assert.ok(duration >= 180 && duration <= 180 + BEAT_MS + 1e-6);
    assert.equal(beatPhase(releaseBeat(time)), 0);
    const rate = beatPlaybackRate(time, 400);
    assert.ok(rate >= .975 && rate <= 1.025);
  }
  assert.equal(beatPlaybackRate(BEAT_OFFSET_MS + BEAT_MS, BEAT_MS), 1);
  assert.ok(beatPlaybackRate(BEAT_OFFSET_MS + 5, BEAT_MS - 5) > 1);
  assert.ok(beatPlaybackRate(BEAT_OFFSET_MS + BEAT_MS - 5, 5) < 1);
});

test('beat grid has stable boundaries, a measured offset, and at most one beat to finish', () => {
  for (let i = 0; i < 500; i++) {
    const beat = BEAT_OFFSET_MS + i * BEAT_MS;
    assert.equal(beatPhase(beat), 0);
    assert.ok(Math.abs(nextBeat(beat) - beat - BEAT_MS) < 1e-6);
    const mid = beat + BEAT_MS * .8;
    assert.ok(nextBeat(mid) > mid && nextBeat(mid) - mid <= BEAT_MS);
    assert.ok(Math.abs(nearestBeat(mid) - nextBeat(mid)) < 1e-6);
  }
});

test('start snaps old progress to the beat and finish persists the exact boundary, not RAF overshoot', async () => {
  const audio = new AudioStub();
  let saved;
  const music = createMotionMusic(audio, { position: 3.17, enabled: true, onPosition(value) { saved = value; }, onError() {} });
  music.alignStart();
  audio.dispatchEvent(new Event('loadedmetadata'));
  assert.ok(Math.abs(audio.currentTime * 1000 - nearestBeat(3170)) < 1e-6);
  music.setActive(true);
  await flush();
  const boundary = nextBeat(music.getTime());
  audio.currentTime = (boundary + 12) / 1000;
  music.stopAt(boundary);
  assert.equal(audio.paused, true);
  assert.ok(Math.abs(saved * 1000 - boundary) < 1e-6);
  assert.equal(music.getTime(), null);
  music.dispose();
});

test('music restores progress, follows animation, resumes, and resets without losing toggle state', async () => {
  const audio = new AudioStub();
  let saved, error;
  const music = createMotionMusic(audio, {
    position: 37, enabled: true,
    onPosition(value) { saved = value; }, onError(value) { error = value; },
  });
  music.setActive(false);
  assert.equal(saved, 37); // Metadata has not arrived: do not persist the element's initial zero.
  audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(audio.currentTime, 37);
  music.setActive(true);
  await flush();
  assert.equal(audio.paused, false);
  assert.equal(audio.loop, true);
  audio.currentTime = 41;
  music.setActive(false);
  assert.equal(saved, 41);
  assert.equal(audio.paused, true);
  music.setActive(true);
  await flush();
  assert.equal(audio.currentTime, 41);
  music.setEnabled(false);
  assert.equal(audio.paused, true);
  music.setEnabled(true);
  await flush();
  music.reset();
  assert.equal(audio.currentTime, 0);
  assert.equal(saved, 0);
  assert.equal(audio.paused, false);
  assert.equal(error, null);
  audio.currentTime = 3;
  music.dispose();
  assert.equal(saved, 3);
  assert.equal(audio.paused, true);
});

test('music periodically persists progress and reset before metadata remains at zero', async () => {
  const audio = new AudioStub();
  let time = 0;
  const saved = [];
  const music = createMotionMusic(audio, {
    position: 25, enabled: true, now: () => time,
    onPosition: value => saved.push(value), onError() {},
  });
  music.reset();
  audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(audio.currentTime, 0);
  music.setActive(true);
  await flush();
  audio.currentTime = 4; time = 4000;
  audio.dispatchEvent(new Event('timeupdate'));
  assert.deepEqual(saved, [0]);
  audio.currentTime = 6; time = 6000;
  audio.dispatchEvent(new Event('timeupdate'));
  assert.deepEqual(saved, [0, 6]);
  music.dispose();
});

test('blocked autoplay is visible and retryable; a late play completion cannot resume stopped music', async () => {
  const audio = new AudioStub();
  let error;
  const music = createMotionMusic(audio, { enabled: true, onPosition() {}, onError(value) { error = value; } });
  audio.play = async () => { throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' }); };
  music.setActive(true);
  await flush();
  assert.match(error, /点击挂件/);
  let finishPlay;
  audio.play = () => new Promise(resolve => { finishPlay = () => { audio.paused = false; resolve(); }; });
  music.retry();
  music.setActive(false);
  finishPlay();
  await flush();
  assert.equal(audio.paused, true);
  music.dispose();
});

test('a new animation retries after an older pending play was interrupted', async () => {
  const audio = new AudioStub();
  let rejectPlay, error;
  audio.play = () => new Promise((resolve, reject) => { rejectPlay = reject; });
  const music = createMotionMusic(audio, { enabled: true, onPosition() {}, onError(value) { error = value; } });
  music.setActive(true);
  music.setActive(false);
  music.setActive(true);
  audio.play = AudioStub.prototype.play;
  rejectPlay(Object.assign(new Error('interrupted'), { name: 'AbortError' }));
  await flush();
  assert.equal(audio.paused, false);
  assert.equal(error, null);
  music.dispose();
});
