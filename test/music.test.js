import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionMusic } from '../src/music.js';

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
