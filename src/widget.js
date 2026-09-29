import {
  CHARACTER_RECT, DESIGN_WIDTH, clampPosition, defaultPosition, fitWidth,
  hitTestCharacterFrame, resizeFromHandle, settlePosition, widgetHeight,
} from './geometry.js';
import { DEFAULT_TEMPLATE, parseTemplate, renderTemplate } from './template.js';
import { createMotionMusic } from './music.js';

const STORAGE_KEY = 'dsh.minimax.plan.widget.v1';
const INSTANCE_KEY = '__dshMinimaxPlanWidget';
const EXPRESSIONS = [
  ['normal', '普通', 'dsh-minimax-chibi.optimized.png'],
  ['blank', '呆住', 'dsh-minimax-chibi-blank.optimized.png'],
  ['grin', '开心', 'dsh-minimax-chibi-grin.optimized.png'],
];
const TEMPLATE = parseTemplate(DEFAULT_TEMPLATE);
const SVG_NS = 'http://www.w3.org/2000/svg';

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svg(doc, viewBox) {
  const node = doc.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function svgPath(doc, parent, d) {
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  parent.append(path);
}

function iconButton(doc, label, name, path) {
  const button = element(doc, 'button', `icon-button ${name}`);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  const graphic = svg(doc, '0 0 24 24');
  svgPath(doc, graphic, path);
  button.append(graphic);
  return button;
}

function loadPreferences(windowRef) {
  const defaults = { expression: 'normal', size: DESIGN_WIDTH, bubble: true, snap: true, position: null, autoBounce: false, music: false, musicPosition: 0 };
  try {
    const raw = windowRef.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { preferences: defaults, error: null };
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置格式无效');
    const expression = EXPRESSIONS.some(([id]) => id === value.expression) ? value.expression : defaults.expression;
    const size = Number.isFinite(value.size) ? value.size : defaults.size;
    const position = value.position && Number.isFinite(value.position.x) && Number.isFinite(value.position.y)
      ? { x: value.position.x, y: value.position.y } : null;
    return {
      preferences: {
        expression, size,
        bubble: typeof value.bubble === 'boolean' ? value.bubble : defaults.bubble,
        snap: typeof value.snap === 'boolean' ? value.snap : defaults.snap,
        autoBounce: value.autoBounce === true,
        music: value.music === true,
        musicPosition: Number.isFinite(value.musicPosition) && value.musicPosition >= 0 ? value.musicPosition : 0,
        position,
      },
      error: null,
    };
  } catch (error) {
    return { preferences: defaults, error: `读取设置失败：${error.message}` };
  }
}

function countdown(iso) {
  if (!iso) return '重置时间未知';
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '重置时间无效';
  const minutes = Math.max(0, Math.ceil((timestamp - Date.now()) / 60000));
  if (minutes === 0) return '即将重置';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return days ? `重置 ${days}天${hours}时` : hours ? `重置 ${hours}时${rest}分` : `重置 ${rest}分`;
}

export function validateUsage(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('用量响应格式无效');
  }
  if (typeof value.ok !== 'boolean') throw new Error('用量响应状态无效');
  if (value.error != null && typeof value.error !== 'string') throw new Error('用量错误信息格式无效');
  if (!value.windows || typeof value.windows !== 'object') throw new Error('用量响应格式无效');
  if (value.updatedAt != null && (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)))) {
    throw new Error('用量更新时间无效');
  }
  for (const key of ['fiveHour', 'weekly']) {
    const window = value.windows[key];
    if (window == null) continue;
    if (typeof window !== 'object') throw new Error(`${key} 用量窗口格式无效`);
    if (window.usedPercent != null && (!Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100)) {
      throw new Error(`${key} 用量百分比无效`);
    }
    if (window.resetAt != null && (typeof window.resetAt !== 'string' || !Number.isFinite(Date.parse(window.resetAt)))) {
      throw new Error(`${key} 重置时间无效`);
    }
  }
  return value;
}

export function mountWidget({ baseUrl = '/minimax-plan-widget/', documentRef = document, windowRef = window } = {}) {
  windowRef[INSTANCE_KEY]?.dispose();
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, windowRef.location.href);
  if (base.origin !== windowRef.location.origin) throw new Error('Widget resources must be same-origin');
  const { preferences, error: initialStorageError } = loadPreferences(windowRef);
  const doc = documentRef;
  const host = element(doc, 'div');
  host.id = 'dsh-minimax-plan-widget';
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483000;width:0;height:0;';
  const shadow = host.attachShadow({ mode: 'open' });
  const stylesheet = element(doc, 'link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('widget.css', base).href;
  shadow.append(stylesheet);

  const widget = element(doc, 'div', 'widget is-active');
  widget.tabIndex = 0;
  widget.setAttribute('aria-label', 'MiniMax Plan 用量小组件，可用方向键移动');
  const stage = element(doc, 'div', 'stage');
  const bubble = element(doc, 'div', 'bubble');
  const bubbleOutline = svg(doc, '0 0 250 190');
  bubbleOutline.setAttribute('preserveAspectRatio', 'none');
  svgPath(doc, bubbleOutline, 'M125 8 C190 8 242 42 242 88 C242 134 190 168 125 168 C117 168 111 168 107 167 C104 184 88 185 81 163 C38 151 8 123 8 88 C8 42 60 8 125 8 Z');
  bubble.append(bubbleOutline);
  const bubbleText = element(doc, 'div', 'bubble-text');
  bubble.append(bubbleText);
  const dots = element(doc, 'div', 'thought-dots');
  dots.append(element(doc, 'span', 'dot dot-large'), element(doc, 'span', 'dot dot-small'));
  const character = element(doc, 'img', 'character');
  character.alt = '';
  character.draggable = false;
  const characterHit = element(doc, 'div', 'character-hit');
  characterHit.append(character);
  const controls = element(doc, 'div', 'controls');
  // Hand-drawn curves: gently uneven teeth and off-round center, legible at 21px.
  const settingsButton = iconButton(doc, '打开设置', 'settings-button', 'M10.1 3.2 Q11.7 2.7 13.2 3.1 L13.8 5.3 Q14.8 5.5 15.6 6.1 L17.7 5.3 Q19 6.1 19.6 7.5 L18.5 9.4 Q19 10.2 19.1 11.2 L21.1 12 Q21.4 13.5 20.7 14.9 L18.5 15.2 Q18.1 16.2 17.4 16.9 L17.8 19 Q16.7 20.1 15.2 20.4 L13.6 18.9 Q12.5 19.2 11.6 19 L10.3 20.8 Q8.7 20.6 7.5 19.7 L7.5 17.5 Q6.6 17 6 16.2 L3.8 16.2 Q2.9 14.9 2.9 13.4 L4.8 12.2 Q4.7 11.1 5.1 10.2 L3.7 8.5 Q4.2 7 5.4 6 L7.5 6.6 Q8.3 5.9 9.3 5.6 Z M12.1 8.7 C16.5 8.5 16.5 15.7 11.9 15.5 C7.7 15.3 7.9 8.5 12.1 8.7');
  settingsButton.setAttribute('aria-expanded', 'false');
  const refreshButton = iconButton(doc, '刷新用量', 'refresh-button', 'M4.2 9.4 C4.9 5.7 8.4 3.5 12.2 4.1 C15.9 4.4 18.5 6.8 19.3 10 M15.1 8.2 Q17.1 9.5 19.5 10.4 Q20 7.9 19.9 5.6 M19.7 14.3 C19 18.3 15.3 20.5 11.4 19.8 C7.7 19.4 5.1 17.1 4.6 13.9 M8.8 15.6 Q6.8 14.3 4.4 13.5 Q3.9 15.8 4.1 18.2');
  controls.append(settingsButton, refreshButton);
  const frame = element(doc, 'div', 'resize-frame');
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const node = element(doc, 'span', `handle handle-${handle}`);
    node.dataset.handle = handle;
    node.setAttribute('aria-hidden', 'true');
    frame.append(node);
  }
  stage.append(bubble, dots, characterHit, controls, frame);

  const status = element(doc, 'div', 'status', '正在读取用量…');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  bubble.append(status);

  const panel = element(doc, 'div', 'settings-panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', '小组件设置');
  const panelTitle = element(doc, 'div', 'panel-title', '小组件设置');
  panel.append(panelTitle);
  const expressionLabel = element(doc, 'div', 'field-label', '表情');
  panel.append(expressionLabel);
  const expressionGroup = element(doc, 'div', 'expression-group');
  const expressionButtons = new Map();
  for (const [id, label] of EXPRESSIONS) {
    const button = element(doc, 'button', 'expression-button', label);
    button.type = 'button';
    button.dataset.expression = id;
    button.setAttribute('aria-pressed', String(preferences.expression === id));
    expressionButtons.set(id, button);
    expressionGroup.append(button);
  }
  panel.append(expressionGroup);
  const sizeLabel = element(doc, 'label', 'field-label', '大小');
  const sizeInput = element(doc, 'input', 'size-input');
  sizeInput.type = 'range';
  sizeInput.min = '180';
  sizeInput.max = '440';
  sizeInput.step = '1';
  sizeInput.value = String(preferences.size);
  sizeLabel.append(sizeInput);
  panel.append(sizeLabel);
  function checkboxRow(label, checked) {
    const row = element(doc, 'label', 'toggle-row');
    const input = element(doc, 'input');
    input.type = 'checkbox';
    input.checked = checked;
    row.append(input, element(doc, 'span', '', label));
    return { row, input };
  }
  const bubbleToggle = checkboxRow('显示气泡', preferences.bubble);
  const snapToggle = checkboxRow('松手吸附到最近边缘', preferences.snap);
  const autoToggle = checkboxRow('自动 Q 弹', preferences.autoBounce);
  const musicToggle = checkboxRow('Q 弹音乐', preferences.music);
  panel.append(bubbleToggle.row, snapToggle.row, autoToggle.row, musicToggle.row);
  const resetButton = element(doc, 'button', 'reset-button', '重置位置、大小和音乐进度');
  resetButton.type = 'button';
  panel.append(resetButton);
  const errorDetails = element(doc, 'div', 'error-details');
  errorDetails.hidden = true;
  errorDetails.setAttribute('role', 'alert');
  panel.append(errorDetails);
  widget.append(stage, panel);
  shadow.append(widget);
  (doc.body || doc.documentElement).append(host);

  let disposed = false;
  let position = preferences.position
    ? settlePosition({ ...preferences.position, width: preferences.size }, windowRef.innerWidth, windowRef.innerHeight, preferences.snap)
    : defaultPosition(windowRef.innerWidth, windowRef.innerHeight, preferences.size, preferences.snap);
  let usage = null;
  let requestError = null;
  let storageError = initialStorageError;
  let streamError = null;
  let styleError = null;
  let imageError = null;
  let musicError = null;
  let loading = true;
  let controller = null;
  let pollTimer = null;
  let clockTimer = null;
  let revealTimer = null;
  let hideTimer = null;
  let settleTimer = null;
  let opacityTimer = null;
  let eventSource = null;
  let gesture = null;
  const elasticAnimations = new Map();
  const listeners = [];
  const on = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push([target, type, handler, options]);
  };
  const clearTimer = (id) => { if (id != null) windowRef.clearTimeout(id); };
  let motionActive = false;
  const audio = doc.createElement('audio');
  audio.preload = 'metadata';
  const music = createMotionMusic(audio, {
    position: preferences.musicPosition,
    enabled: preferences.music,
    onPosition(value) { preferences.musicPosition = value; savePreferences(); },
    onError(value) { musicError = value; renderStatus(); },
  });
  audio.src = new URL('assets/q-bounce.m4a', base).href;

  function setMotionActive(value) {
    motionActive = value;
    music.setActive(value && !doc.hidden);
  }

  function stopElasticMotion() {
    for (const animation of elasticAnimations.values()) animation.cancel();
    elasticAnimations.clear();
    setMotionActive(false);
  }

  function animateElasticMotion(pressed, automatic = false) {
    setMotionActive(true);
    // Animate artwork only: layout, drag coordinates, resize handles and settings stay stable.
    for (const [node, strength] of [[character, 1], [bubble, .7], [dots, .8]]) {
      const current = windowRef.getComputedStyle(node).transform;
      elasticAnimations.get(node)?.cancel();
      const shape = (x, y) => `scale(${1 + x * strength}, ${1 + y * strength})`;
      const frames = automatic ? [
        { transform: 'scale(1, 1)', offset: 0 },
        { transform: shape(.24, -.32), offset: .28 },
        { transform: shape(.24, -.32), offset: .38 },
        { transform: shape(-.17, .24), offset: .65 },
        { transform: 'scale(1, 1)', offset: 1 },
      ] : pressed ? [
        { transform: current },
        { transform: shape(.24, -.32) },
      ] : [
        { transform: current, offset: 0 },
        { transform: shape(-.17, .24), offset: .17 },
        { transform: shape(.12, -.16), offset: .36 },
        { transform: shape(-.07, .10), offset: .55 },
        { transform: shape(.035, -.05), offset: .73 },
        { transform: shape(-.015, .025), offset: .87 },
        { transform: 'scale(1, 1)', offset: 1 },
      ];
      const animation = node.animate(frames, {
        duration: automatic ? 700 : pressed ? 130 : 900,
        iterations: automatic ? Infinity : 1,
        easing: pressed ? 'cubic-bezier(.2, .8, .3, 1)' : 'ease-in-out',
        fill: 'forwards',
      });
      elasticAnimations.set(node, animation);
      if (doc.hidden) animation.pause();
      if (!automatic) animation.onfinish = () => {
        if (elasticAnimations.get(node) !== animation) return;
        if (!pressed) {
          animation.cancel();
          elasticAnimations.delete(node);
        }
        if ([...elasticAnimations.values()].every(value => value.playState === 'finished')) setMotionActive(false);
      };
    }
  }

  function activateOpacity() {
    clearTimer(opacityTimer);
    opacityTimer = null;
    widget.classList.add('is-active');
  }

  function scheduleDim() {
    clearTimer(opacityTimer);
    opacityTimer = null;
    if (disposed || gesture || widget.matches(':hover')) return;
    opacityTimer = windowRef.setTimeout(() => {
      opacityTimer = null;
      widget.classList.remove('is-active');
    }, 3000);
  }

  function showPosition(animate = false) {
    if (animate) {
      host.style.transition = 'left .32s cubic-bezier(.2, .85, .3, 1), top .32s cubic-bezier(.2, .85, .3, 1), width .32s ease, height .32s ease';
      stage.style.transition = 'transform .32s ease';
      clearTimer(settleTimer);
      settleTimer = windowRef.setTimeout(() => { host.style.transition = 'none'; stage.style.transition = 'none'; }, 340);
    } else { host.style.transition = 'none'; stage.style.transition = 'none'; }
    host.style.left = `${position.x}px`;
    host.style.top = `${position.y}px`;
    host.style.width = `${position.width}px`;
    host.style.height = `${widgetHeight(position.width)}px`;
    stage.style.transform = `scale(${position.width / DESIGN_WIDTH})`;
    // Clip only at the viewport, including during exaggerated squash/stretch.
    // The fixed settings panel is a sibling, so it is neither transformed nor clipped.
    const scale = position.width / DESIGN_WIDTH;
    stage.style.clipPath = `inset(${-position.y / scale}px ${-(windowRef.innerWidth - position.x - position.width) / scale}px ${-(windowRef.innerHeight - position.y - widgetHeight(position.width)) / scale}px ${-position.x / scale}px)`;
  }

  function savePreferences() {
    try {
      windowRef.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...preferences,
        position: { x: position.x, y: position.y },
      }));
      storageError = null;
    } catch (error) {
      storageError = `保存设置失败：${error.message}`;
    }
    renderStatus();
  }

  function displayWindow(key) {
    const value = usage?.windows[key];
    return {
      used: value?.usedPercent == null ? '—' : `${Math.round(value.usedPercent)}% 已用`,
      reset: countdown(value?.resetAt),
    };
  }

  function renderUsage() {
    bubbleText.replaceChildren(renderTemplate(TEMPLATE, {
      fiveHour: displayWindow('fiveHour'), weekly: displayWindow('weekly'),
    }, doc));
    bubble.hidden = !preferences.bubble;
    dots.hidden = !preferences.bubble;
    widget.classList.toggle('bubble-hidden', !preferences.bubble);
    (preferences.bubble ? bubble : stage).append(status);
  }

  function renderStatus() {
    const errors = [requestError, storageError, streamError, styleError, imageError, musicError].filter(Boolean);
    status.textContent = errors.length ? requestError
      ? (usage?.updatedAt ? '旧数据可能过期 · 查看设置' : '读取失败 · 查看设置')
      : '挂件异常 · 查看设置' : loading ? '正在读取用量…'
      : usage?.updatedAt ? `更新于 ${new Date(usage.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
      : '暂无更新时间';
    status.classList.toggle('error', errors.length > 0);
    errorDetails.hidden = errors.length === 0;
    errorDetails.textContent = errors.join('\n');
    refreshButton.classList.toggle('loading', loading);
  }

  function renderExpression() {
    const filename = EXPRESSIONS.find(([id]) => id === preferences.expression)[2];
    character.src = new URL(`assets/${filename}`, base).href;
    for (const [id, button] of expressionButtons) button.setAttribute('aria-pressed', String(id === preferences.expression));
  }

  function schedulePoll() {
    clearTimer(pollTimer);
    pollTimer = null;
    if (!disposed && !doc.hidden) pollTimer = windowRef.setTimeout(() => refresh(), 60000);
  }

  async function refresh(force = false) {
    if (disposed || doc.hidden) return;
    controller?.abort();
    controller = new AbortController();
    const active = controller;
    loading = true;
    requestError = null;
    renderStatus();
    try {
      const endpoint = new URL('usage', base);
      if (force) endpoint.searchParams.set('refresh', '1');
      const response = await windowRef.fetch(endpoint.href, { credentials: 'same-origin', signal: active.signal, cache: 'no-store' });
      if (response.status === 404 || response.status === 410) { dispose(); return; }
      if (response.status === 401) throw new Error('登录已失效，请重新登录 DSH Web');
      if (response.status === 403) throw new Error('登录或访问检查失败，请重新登录 DSH Web');
      if (!response.ok) throw new Error(`读取用量失败（HTTP ${response.status}）`);
      const value = validateUsage(await response.json());
      if (disposed || controller !== active) return;
      const hasCache = value.updatedAt && Object.values(value.windows).some(window => window && (window.usedPercent != null || window.resetAt != null));
      if (value.ok || hasCache) usage = value;
      requestError = value.ok ? null : value.error || '读取用量失败，旧数据可能过期';
      renderUsage();
    } catch (error) {
      if (disposed || active.signal.aborted) return;
      requestError = error instanceof Error ? error.message : String(error);
    } finally {
      if (!disposed && controller === active) {
        controller = null;
        loading = false;
        renderStatus();
        schedulePoll();
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    controller?.abort();
    eventSource?.close();
    stopElasticMotion();
    music.dispose();
    for (const id of [pollTimer, revealTimer, hideTimer, settleTimer, opacityTimer]) clearTimer(id);
    if (clockTimer != null) windowRef.clearInterval(clockTimer);
    for (const [target, type, handler, options] of listeners) target.removeEventListener(type, handler, options);
    host.remove();
    if (windowRef[INSTANCE_KEY]?.dispose === dispose) delete windowRef[INSTANCE_KEY];
  }

  function closeSettings(restoreFocus = true) {
    if (panel.hidden) return;
    panel.hidden = true;
    settingsButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) settingsButton.focus();
  }

  function placeSettings() {
    if (panel.hidden) return;
    // Pin the panel in viewport coordinates only on open/window resize, never on slider input.
    panel.style.maxHeight = `${Math.max(1, windowRef.innerHeight - 16)}px`;
    const anchor = settingsButton.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = Math.max(8, Math.min(anchor.left, windowRef.innerWidth - width - 8));
    const top = Math.max(8, Math.min(anchor.bottom - height, windowRef.innerHeight - height - 8));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.maxHeight = `${Math.max(1, windowRef.innerHeight - top - 8)}px`;
  }

  function openSettings() {
    panel.hidden = false;
    placeSettings();
    settingsButton.setAttribute('aria-expanded', 'true');
    expressionButtons.get(preferences.expression).focus();
  }

  function finishGesture(event) {
    if (!gesture || (event && event.pointerId !== gesture.id)) return;
    const resized = Boolean(gesture.handle);
    const wasMoving = gesture.moved || (resized && position.width !== gesture.start.width);
    gesture = null;
    widget.classList.remove('pressed', 'resizing');
    if (preferences.autoBounce) animateElasticMotion(false, true);
    else if (!resized) animateElasticMotion(false);
    position = resized
      ? clampPosition(position, windowRef.innerWidth, windowRef.innerHeight)
      : settlePosition(position, windowRef.innerWidth, windowRef.innerHeight, preferences.snap);
    if (resized && wasMoving) {
      preferences.size = position.width;
      sizeInput.min = String(Math.min(180, position.width));
      sizeInput.value = String(position.width);
    }
    showPosition(wasMoving);
    if (wasMoving) savePreferences();
    scheduleDim();
  }

  on(stage, 'pointerdown', (event) => {
    if (gesture || event.button !== 0 || event.target.closest('button') || event.target.closest('.settings-panel')) return;
    activateOpacity();
    clearTimer(revealTimer);
    revealTimer = null;
    clearTimer(hideTimer);
    hideTimer = null;
    let handle = event.target.closest('.handle')?.dataset.handle || null;
    if (!handle && event.target.closest('.resize-frame')) {
      const bounds = stage.getBoundingClientRect();
      const scale = position.width / DESIGN_WIDTH;
      handle = hitTestCharacterFrame(
        (event.clientX - bounds.left) / scale,
        (event.clientY - bounds.top) / scale,
      );
    }
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, start: { ...position }, handle, moved: false };
    stage.setPointerCapture(event.pointerId);
    widget.classList.add('pressed');
    if (handle) widget.classList.add('resizing');
    if (handle) stopElasticMotion();
    else if (!preferences.autoBounce) animateElasticMotion(true);
    else music.retry();
    event.preventDefault();
  });
  function updateFrameHover(event) {
    if (event.pointerType === 'touch' || gesture || event.target.closest('button')) return;
    const bounds = stage.getBoundingClientRect();
    const scale = position.width / DESIGN_WIDTH;
    const x = (event.clientX - bounds.left) / scale;
    const y = (event.clientY - bounds.top) / scale;
    const right = CHARACTER_RECT.x + CHARACTER_RECT.width;
    const bottom = CHARACTER_RECT.y + CHARACTER_RECT.height;
    const nearBox = x >= CHARACTER_RECT.x - 12 && x <= right + 12
      && y >= CHARACTER_RECT.y - 12 && y <= bottom + 12;
    const edgeDistance = Math.min(
      Math.abs(x - CHARACTER_RECT.x), Math.abs(x - right),
      Math.abs(y - CHARACTER_RECT.y), Math.abs(y - bottom),
    );
    if (nearBox && edgeDistance <= 20) {
      clearTimer(hideTimer);
      hideTimer = null;
      if (!widget.classList.contains('frame-visible') && revealTimer == null) {
        revealTimer = windowRef.setTimeout(() => {
          revealTimer = null;
          widget.classList.add('frame-visible');
        }, 450);
      }
    } else {
      clearTimer(revealTimer);
      revealTimer = null;
      if (widget.classList.contains('frame-visible') && hideTimer == null) {
        hideTimer = windowRef.setTimeout(() => {
          hideTimer = null;
          if (!gesture && !widget.matches(':focus-within')) widget.classList.remove('frame-visible');
        }, 500);
      }
    }
  }

  on(stage, 'pointerenter', updateFrameHover);
  on(stage, 'pointermove', (event) => {
    updateFrameHover(event);
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) gesture.moved = true;
    position = gesture.handle
      ? resizeFromHandle(gesture.start, gesture.handle, dx, dy, windowRef.innerWidth, windowRef.innerHeight)
      : clampPosition({ ...gesture.start, x: gesture.start.x + dx, y: gesture.start.y + dy }, windowRef.innerWidth, windowRef.innerHeight);
    showPosition();
  });
  on(stage, 'pointerup', finishGesture);
  on(stage, 'pointercancel', finishGesture);
  on(stage, 'lostpointercapture', finishGesture);
  on(stage, 'pointerleave', () => {
    clearTimer(revealTimer);
    revealTimer = null;
    clearTimer(hideTimer);
    hideTimer = windowRef.setTimeout(() => {
      hideTimer = null;
      if (!gesture && !widget.matches(':focus-within')) widget.classList.remove('frame-visible');
    }, 500);
  });
  on(widget, 'pointerenter', activateOpacity);
  on(widget, 'pointerdown', () => music.retry());
  on(widget, 'pointerleave', scheduleDim);
  on(widget, 'focusin', (event) => {
    if (event.target === widget) widget.classList.add('frame-visible');
    else if (!gesture) widget.classList.remove('frame-visible');
  });
  on(widget, 'focusout', (event) => { if (!widget.contains(event.relatedTarget)) widget.classList.remove('frame-visible'); });
  on(widget, 'keydown', (event) => {
    if (event.key === 'Escape') { closeSettings(); return; }
    if (event.target !== widget || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 20 : 10;
    position.x += event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
    position.y += event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
    position = clampPosition(position, windowRef.innerWidth, windowRef.innerHeight);
    showPosition(true);
    savePreferences();
  });
  on(settingsButton, 'click', () => panel.hidden ? openSettings() : closeSettings());
  on(refreshButton, 'click', () => refresh(true));
  on(expressionGroup, 'click', (event) => {
    const id = event.target.closest('button')?.dataset.expression;
    if (!id) return;
    preferences.expression = id;
    renderExpression();
    savePreferences();
  });
  on(sizeInput, 'input', () => {
    stopElasticMotion();
    preferences.size = Number(sizeInput.value);
    position.width = fitWidth(preferences.size, windowRef.innerWidth, windowRef.innerHeight);
    position = settlePosition(position, windowRef.innerWidth, windowRef.innerHeight, preferences.snap);
    showPosition();
    savePreferences();
  });
  on(sizeInput, 'change', () => { if (preferences.autoBounce) animateElasticMotion(false, true); });
  on(autoToggle.input, 'change', () => {
    preferences.autoBounce = autoToggle.input.checked;
    if (preferences.autoBounce) animateElasticMotion(false, true);
    else stopElasticMotion();
    savePreferences();
  });
  on(musicToggle.input, 'change', () => {
    preferences.music = musicToggle.input.checked;
    music.setEnabled(preferences.music);
    savePreferences();
  });
  on(bubbleToggle.input, 'change', () => { preferences.bubble = bubbleToggle.input.checked; renderUsage(); savePreferences(); });
  on(snapToggle.input, 'change', () => {
    preferences.snap = snapToggle.input.checked;
    position = settlePosition(position, windowRef.innerWidth, windowRef.innerHeight, preferences.snap);
    showPosition(true);
    savePreferences();
  });
  on(resetButton, 'click', () => {
    stopElasticMotion();
    music.reset();
    preferences.size = DESIGN_WIDTH;
    sizeInput.min = '180';
    sizeInput.value = String(DESIGN_WIDTH);
    position = defaultPosition(windowRef.innerWidth, windowRef.innerHeight, DESIGN_WIDTH, preferences.snap);
    showPosition();
    savePreferences();
    if (preferences.autoBounce) animateElasticMotion(false, true);
  });
  on(doc, 'pointerdown', (event) => {
    const path = event.composedPath();
    if (!panel.hidden && !path.includes(panel) && !path.includes(settingsButton)) closeSettings(false);
  }, true);
  on(windowRef, 'resize', () => {
    position = settlePosition({ ...position, width: preferences.size }, windowRef.innerWidth, windowRef.innerHeight, preferences.snap);
    // Window shrink must clamp immediately: an animated old position can overflow meanwhile.
    showPosition();
    placeSettings();
    savePreferences();
  });
  on(doc, 'visibilitychange', () => {
    music.setActive(motionActive && !doc.hidden);
    for (const animation of elasticAnimations.values()) {
      if (doc.hidden && animation.playState === 'running') animation.pause();
      else if (!doc.hidden && animation.playState === 'paused') animation.play();
    }
    if (doc.hidden) { clearTimer(pollTimer); pollTimer = null; controller?.abort(); }
    else refresh();
  });
  on(windowRef, 'pagehide', dispose);
  on(stylesheet, 'error', () => { styleError = '小组件样式加载失败'; renderStatus(); });
  on(stylesheet, 'load', () => { styleError = null; renderStatus(); });
  on(character, 'error', () => { imageError = '角色图片加载失败'; renderStatus(); });
  on(character, 'load', () => { imageError = null; renderStatus(); });

  renderExpression();
  renderUsage();
  renderStatus();
  showPosition();
  if (preferences.autoBounce) animateElasticMotion(false, true);
  clockTimer = windowRef.setInterval(() => { if (!doc.hidden && usage) renderUsage(); }, 30000);
  if (typeof windowRef.EventSource === 'function') {
    try {
      eventSource = new windowRef.EventSource(new URL('events', base).href, { withCredentials: true });
      on(eventSource, 'dispose', dispose);
      on(eventSource, 'open', () => { streamError = null; renderStatus(); });
      on(eventSource, 'error', () => { streamError = '卸载通知连接中断，仍会定时检查'; renderStatus(); });
    } catch (error) {
      streamError = `卸载通知连接失败：${error.message}`;
      renderStatus();
    }
  } else {
    streamError = '浏览器不支持卸载通知，仍会定时检查';
    renderStatus();
  }
  const instance = { dispose, refresh: () => refresh(true), host };
  windowRef[INSTANCE_KEY] = instance;
  scheduleDim();
  refresh();
  return instance;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mountWidget(), { once: true });
  } else {
    mountWidget();
  }
}
