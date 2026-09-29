export const DESIGN_WIDTH = 300;
export const DESIGN_HEIGHT = 330;
export const MIN_WIDTH = 180;
export const MAX_WIDTH = 440;
export const EDGE_GAP = 16;
export const CHARACTER_RECT = Object.freeze({ x: 115, y: 148, width: 175, height: 172 });

export function fitWidth(width, viewportWidth, viewportHeight) {
  const available = Math.max(1, Math.min(viewportWidth - 2 * EDGE_GAP, (viewportHeight - 2 * EDGE_GAP) * DESIGN_WIDTH / DESIGN_HEIGHT));
  return Math.min(MAX_WIDTH, Math.max(1, Math.min(Math.max(MIN_WIDTH, width), available)));
}

export function widgetHeight(width) {
  return width * DESIGN_HEIGHT / DESIGN_WIDTH;
}

export function clampPosition(position, viewportWidth, viewportHeight) {
  const width = fitWidth(position.width, viewportWidth, viewportHeight);
  const height = widgetHeight(width);
  return {
    x: Math.min(Math.max(0, position.x), Math.max(0, viewportWidth - width)),
    y: Math.min(Math.max(0, position.y), Math.max(0, viewportHeight - height)),
    width,
  };
}

export function defaultPosition(viewportWidth, viewportHeight, preferredWidth = DESIGN_WIDTH, snap = false) {
  const width = fitWidth(preferredWidth, viewportWidth, viewportHeight);
  return clampPosition({
    x: viewportWidth - width - (snap ? 0 : EDGE_GAP),
    y: viewportHeight - widgetHeight(width) - (snap ? 0 : EDGE_GAP),
    width,
  }, viewportWidth, viewportHeight);
}

export function settlePosition(position, viewportWidth, viewportHeight, snap = true) {
  const next = clampPosition(position, viewportWidth, viewportHeight);
  if (!snap) return next;
  const right = viewportWidth - next.width;
  const bottom = viewportHeight - widgetHeight(next.width);
  // Always dock to the nearest edge; preserve position along that edge.
  const distances = [next.x, right - next.x, next.y, bottom - next.y];
  const edge = distances.indexOf(Math.min(...distances));
  if (edge === 0) next.x = 0;
  else if (edge === 1) next.x = right;
  else if (edge === 2) next.y = 0;
  else next.y = bottom;
  return next;
}

export function hitTestCharacterFrame(x, y, tolerance = 14) {
  const { x: left, y: top, width, height } = CHARACTER_RECT;
  const right = left + width;
  const bottom = top + height;
  if (x < left - tolerance || x > right + tolerance || y < top - tolerance || y > bottom + tolerance) return null;
  const west = Math.abs(x - left);
  const east = Math.abs(x - right);
  const north = Math.abs(y - top);
  const south = Math.abs(y - bottom);
  const horizontal = Math.min(west, east) <= tolerance ? west <= east ? 'w' : 'e' : '';
  const vertical = Math.min(north, south) <= tolerance ? north <= south ? 'n' : 's' : '';
  return vertical + horizontal || null;
}

// Keep docked widget edges fixed; otherwise anchor the opposite character edge/corner.
export function resizeFromHandle(start, handle, dx, dy, viewportWidth, viewportHeight) {
  if (!['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].includes(handle)) {
    throw new Error(`Unknown resize handle: ${handle}`);
  }
  const { x, y, width, height } = CHARACTER_RECT;
  const startScale = start.width / DESIGN_WIDTH;
  const dockLeft = Math.abs(start.x) < .5;
  const dockRight = Math.abs(start.x + start.width - viewportWidth) < .5;
  const dockTop = Math.abs(start.y) < .5;
  const dockBottom = Math.abs(start.y + widgetHeight(start.width) - viewportHeight) < .5;
  const anchorDesignX = dockLeft ? 0 : dockRight ? DESIGN_WIDTH
    : handle.includes('w') ? x + width : handle.includes('e') ? x : x + width / 2;
  const anchorDesignY = dockTop ? 0 : dockBottom ? DESIGN_HEIGHT
    : handle.includes('n') ? y + height : handle.includes('s') ? y : y + height / 2;
  // A corner on a docked edge can still resize along its other, free axis.
  const horizontal = handle.includes('w') && !dockLeft ? -dx / (anchorDesignX - x)
    : handle.includes('e') && !dockRight ? dx / (x + width - anchorDesignX) : null;
  const vertical = handle.includes('n') && !dockTop ? -dy / (anchorDesignY - y)
    : handle.includes('s') && !dockBottom ? dy / (y + height - anchorDesignY) : null;
  const deltaScale = horizontal == null ? vertical ?? 0 : vertical == null ? horizontal
    : Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical;
  const anchorX = start.x + startScale * anchorDesignX;
  const anchorY = start.y + startScale * anchorDesignY;
  const maxScale = Math.min(
    fitWidth(MAX_WIDTH, viewportWidth, viewportHeight) / DESIGN_WIDTH,
    anchorDesignX > 0 ? anchorX / anchorDesignX : Infinity,
    anchorDesignX < DESIGN_WIDTH ? (viewportWidth - anchorX) / (DESIGN_WIDTH - anchorDesignX) : Infinity,
    anchorDesignY > 0 ? anchorY / anchorDesignY : Infinity,
    anchorDesignY < DESIGN_HEIGHT ? (viewportHeight - anchorY) / (DESIGN_HEIGHT - anchorDesignY) : Infinity,
  );
  const minScale = Math.min(MIN_WIDTH / DESIGN_WIDTH, maxScale);
  const scale = Math.min(maxScale, Math.max(minScale, startScale + deltaScale));
  return {
    x: anchorX - scale * anchorDesignX,
    y: anchorY - scale * anchorDesignY,
    width: scale * DESIGN_WIDTH,
  };
}
