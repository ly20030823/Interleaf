export interface Point { x: number; y: number }
export interface Viewport { width: number; height: number }

// Keep the title bar reachable even after resizing to a very small window.
export function clampFloatingPosition(point: Point, size: Viewport, viewport: Viewport): Point {
  const margin = 8;
  return {
    x: Math.max(margin, Math.min(point.x, Math.max(margin, viewport.width - size.width - margin))),
    y: Math.max(margin, Math.min(point.y, Math.max(margin, viewport.height - size.height - margin))),
  };
}
