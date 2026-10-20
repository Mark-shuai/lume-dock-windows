// Pure pointer policy; coordinates are Electron display-independent screen points.
// Activation stays narrow. Once shown, the Dock, its bottom gap and taskbar form
// one continuous retention area so a fast edge approach cannot immediately exit.
function createAutoHidePolicy({ hideDelay = 700, revealHold = 1000, edgeSize = 4, sideSlop = 12 } = {}) {
  let awaySince = null;
  let holdUntil = 0;
  function reset() { awaySince = null; holdUntil = 0; }
  function update({ cursor, bounds, display, workArea, visible, now }) {
    const onDisplay = cursor.x >= display.x && cursor.x < display.x + display.width && cursor.y >= display.y && cursor.y < display.y + display.height;
    const withinX = cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width;
    const atEdge = onDisplay && withinX && (Math.abs(cursor.y - (workArea.y + workArea.height)) <= edgeSize || cursor.y >= display.y + display.height - edgeSize);
    const retained = visible && onDisplay && cursor.x >= bounds.x - sideSlop && cursor.x < bounds.x + bounds.width + sideSlop && cursor.y >= bounds.y - sideSlop;
    if (atEdge || retained) {
      awaySince = null;
      if (!visible) holdUntil = now + revealHold;
      return true;
    }
    if (!visible) { awaySince = null; return false; }
    awaySince ??= now;
    return now < holdUntil || now - awaySince < hideDelay;
  }
  return { update, reset };
}
module.exports = { createAutoHidePolicy };
