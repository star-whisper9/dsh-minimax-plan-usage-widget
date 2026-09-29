// The audio element owns playback; persisted progress is restored once metadata is available.
export function createMotionMusic(audio, { position = 0, enabled = false, onPosition, onError, now = Date.now }) {
  let active = false, disposed = false, pending = false, restored = false;
  let progress = position, savedAt = 0;
  let revision = 0;
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
  audio.loop = true;
  audio.addEventListener('loadedmetadata', metadata);
  audio.addEventListener('timeupdate', update);
  audio.addEventListener('error', error);
  return {
    setActive(value) { active = value; sync(); },
    setEnabled(value) { enabled = value; if (!value) onError(null); sync(); },
    retry() { if (wanted()) sync(); },
    reset() {
      progress = 0;
      if (restored) audio.currentTime = 0;
      onPosition(0);
      savedAt = now();
    },
    dispose() {
      disposed = true;
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
