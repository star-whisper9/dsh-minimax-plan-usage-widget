export const BEAT_MS = 60000 / 130;
// Estimated low-frequency attack phase in the bundled track, not its first audio sample.
export const BEAT_OFFSET_MS = 120;
export function beatPhase(time) {
  const phase = ((time - BEAT_OFFSET_MS) % BEAT_MS + BEAT_MS) % BEAT_MS;
  return phase < 1e-6 || BEAT_MS - phase < 1e-6 ? 0 : phase;
}
export const nextBeat = time => time + BEAT_MS - beatPhase(time);
export const releaseBeat = time => nextBeat(time + 180);
export function beatPlaybackRate(audioTime, animationTime) {
  const error = ((beatPhase(audioTime) - beatPhase(animationTime + BEAT_OFFSET_MS) + BEAT_MS * 1.5) % BEAT_MS) - BEAT_MS / 2;
  return 1 + Math.max(-.025, Math.min(.025, error / 4000));
}
export const nearestBeat = time => Math.max(BEAT_OFFSET_MS,
  BEAT_OFFSET_MS + Math.round((time - BEAT_OFFSET_MS) / BEAT_MS) * BEAT_MS);

// The audio element owns playback; persisted progress is restored once metadata is available.
export function createMotionMusic(audio, {
  position = 0, enabled = false, onPosition, onError, now = Date.now,
  schedule = setTimeout, cancel = clearTimeout,
}) {
  let active = false, disposed = false, pending = false, restored = false;
  let progress = position, savedAt = 0;
  let revision = 0;
  let tailTimer = null;
  const volume = audio.volume ?? 1;
  function cancelTail() {
    if (tailTimer != null) cancel(tailTimer);
    tailTimer = null;
    audio.volume = volume;
  }
  function stopAt(time) {
    active = false;
    audio.pause();
    if (enabled && restored) audio.currentTime = Math.max(0, time / 1000) % audio.duration;
    cancelTail();
    sync();
  }
  function finishOnBeat() {
    cancelTail();
    if (!wanted() || !restored || audio.paused) { active = false; sync(); return; }
    const start = audio.currentTime * 1000;
    const end = Math.min(nextBeat(start), audio.duration * 1000);
    const startedAt = now();
    function fade() {
      tailTimer = null;
      if (disposed || !wanted()) return;
      const time = audio.currentTime * 1000;
      if (time >= end || time < start) { stopAt(end); return; }
      // A stalled media clock must not leave a detached tail playing indefinitely.
      if (now() - startedAt > BEAT_MS + 1000) { active = false; audio.pause(); cancelTail(); save(); return; }
      audio.volume = volume * Math.max(0, Math.min(1, (end - time) / Math.max(1, end - start))) ** 2;
      tailTimer = schedule(fade, 16);
    }
    fade();
  }
  const wanted = () => enabled && active && !disposed;
  function save() {
    if (restored && Number.isFinite(audio.currentTime)) progress = audio.currentTime;
    onPosition(progress);
    savedAt = now();
  }
  function sync() {
    if (!wanted()) { revision++; audio.pause(); save(); return; }
    if (pending || !audio.paused) return;
    pending = true;
    const attempt = revision;
    audio.play().then(() => {
      if (disposed) { audio.pause(); return; }
      if (!wanted()) { audio.pause(); save(); }
      else onError(null);
    }).catch(error => {
      if (!wanted() || attempt !== revision) return;
      onError(error.name === 'NotAllowedError'
        ? '浏览器阻止了音乐自动播放，请点击挂件重试'
        : 'Q 弹音乐播放失败，请检查音频资源后重试');
    }).finally(() => {
      pending = false;
      if (wanted() && attempt !== revision) sync();
    });
  }
  function metadata() {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = progress % audio.duration;
    restored = true;
  }
  function update() { if (wanted() && restored && now() - savedAt >= 5000) save(); }
  function error() { if (enabled && !disposed) onError('Q 弹音乐加载失败，请检查音频资源'); }
  function alignPosition() {
    progress = nearestBeat((restored ? audio.currentTime : progress) * 1000) / 1000;
    if (restored) audio.currentTime = progress % audio.duration;
  }
  audio.loop = true;
  audio.addEventListener('loadedmetadata', metadata);
  audio.addEventListener('timeupdate', update);
  audio.addEventListener('error', error);
  return {
    getTime() { return enabled && active && restored && !audio.paused ? audio.currentTime * 1000 : null; },
    isPending() { return pending && wanted(); },
    alignStart() {
      if (!enabled || active) return;
      alignPosition();
    },
    stopAt,
    finishOnBeat,
    setActive(value) { cancelTail(); active = value; sync(); },
    setEnabled(value) {
      if (value && !enabled) alignPosition();
      enabled = value;
      if (!value) cancelTail();
      if (!value) onError(null);
      sync();
    },
    retry() { if (wanted()) sync(); },
    reset() {
      cancelTail();
      progress = 0;
      if (restored) audio.currentTime = 0;
      onPosition(0);
      savedAt = now();
    },
    dispose() {
      disposed = true;
      cancelTail();
      audio.pause();
      save();
      audio.removeEventListener('loadedmetadata', metadata);
      audio.removeEventListener('timeupdate', update);
      audio.removeEventListener('error', error);
      audio.removeAttribute('src');
      audio.load();
    },
  };
}
