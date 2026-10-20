window.createDockMotion = function createDockMotion(row) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = null;
  let pointer = null;
  let cells = [];
  let scales = [];
  let offsets = [];
  let lastTime = null;
  let overflowFrame = null;
  let metrics = [];
  let metricsDirty = true;
  let radius = 95;
  let rowWidth = 1;
  let wanted = [];
  let extra = [];
  let nativeVisible = true;
  let visible = !document.hidden;
  const dock = row.closest('.dock');
  const previous = document.getElementById('dockScrollPrev');
  const next = document.getElementById('dockScrollNext');
  function syncNavigation() {
    const scrollable = row.classList.contains('is-scrollable');
    if (previous) { previous.hidden = !scrollable; previous.disabled = row.scrollLeft <= 1; }
    if (next) { next.hidden = !scrollable; next.disabled = row.scrollLeft >= row.scrollWidth - row.clientWidth - 1; }
  }
  function syncOverflow() {
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const contentWidth = cells.reduce((sum, cell) => {
      const style = getComputedStyle(cell);
      return sum + cell.offsetWidth + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
    }, 0) + Math.max(0, cells.length - 1) * gap;
    // Measure untransformed content against the original shelf width. The
    // scrollable viewport moves inside the glass, so its own width is not the threshold.
    dock.style.width = `${Math.ceil(contentWidth + 192)}px`;
    row.classList.toggle('is-scrollable', contentWidth + 192 > dock.clientWidth + 1);
    metricsDirty = true;
    syncNavigation();
  }
  function measure() {
    radius = parseFloat(getComputedStyle(row).getPropertyValue('--icon-size')) * 1.484375 || 95;
    rowWidth = row.clientWidth;
    metrics = cells.map(cell => ({ center: cell.offsetLeft + cell.offsetWidth / 2,
      width: cell.offsetWidth, height: cell.offsetHeight, separator: cell.classList.contains('dock-separator') }));
    metricsDirty = false;
  }
  new ResizeObserver(() => {
    metricsDirty = true;
    if (!visible || overflowFrame !== null) return;
    overflowFrame = requestAnimationFrame(() => { overflowFrame = null; syncOverflow(); schedule(); });
  }).observe(row);
  function enabled() { return !reduced.matches && !document.body.classList.contains('no-magnify'); }
  function tick(time) {
    frame = null;
    if (metricsDirty) measure();
    const canMove = enabled();
    const elapsed = lastTime === null ? 1000 / 60 : Math.min(100, time - lastTime);
    lastTime = time;
    const easing = canMove ? 1 - Math.pow(.78, elapsed / (1000 / 60)) : 1;
    const center = pointer === null ? null : pointer - row.getBoundingClientRect().left + row.scrollLeft;
    let total = 0;
    for (let index = 0; index < cells.length; index++) {
      const distance = center === null || !canMove || metrics[index].separator ? Infinity : Math.abs(center - metrics[index].center);
      wanted[index] = 1 + .62 * Math.exp(-Math.pow(distance / radius, 2));
      extra[index] = (wanted[index] - 1) * metrics[index].width;
      total += extra[index];
    }
    let prefix = 0;
    let settling = false;
    cells.forEach((cell, index) => {
      const targetOffset = prefix + extra[index] / 2 - total / 2;
      prefix += extra[index];
      scales[index] += (wanted[index] - scales[index]) * easing;
      offsets[index] += (targetOffset - offsets[index]) * easing;
      cell.style.setProperty('--dock-scale', scales[index].toFixed(4));
      cell.style.setProperty('--dock-shift', `${offsets[index].toFixed(2)}px`);
      cell.style.setProperty('--icon-rise', `${((scales[index] - 1) * metrics[index].height).toFixed(2)}px`);
      if (Math.abs(wanted[index] - scales[index]) > .001 || Math.abs(targetOffset - offsets[index]) > .05) settling = true;
    });
    const expansion = scales.reduce((sum, scale, index) => sum + (scale - 1) * metrics[index].width, 0) * Math.max(0, rowWidth - 148) / Math.max(1, rowWidth) / 2;
    dock.style.setProperty('--glass-expansion', `${expansion.toFixed(2)}px`);
    if (settling) frame = requestAnimationFrame(tick);
    else lastTime = null;
  }
  function schedule() { if (visible && frame === null) frame = requestAnimationFrame(tick); }
  function setVisible(value) {
    nativeVisible = value;
    visible = nativeVisible && !document.hidden;
    if (visible) { syncOverflow(); schedule(); return; }
    if (frame !== null) cancelAnimationFrame(frame);
    if (overflowFrame !== null) cancelAnimationFrame(overflowFrame);
    frame = overflowFrame = lastTime = pointer = null;
    // A hidden Dock has no animation to finish. Restore neutral values once.
    cells.forEach((cell, index) => {
      scales[index] = 1; offsets[index] = 0;
      cell.style.setProperty('--dock-scale', '1');
      cell.style.setProperty('--dock-shift', '0px');
      cell.style.setProperty('--icon-rise', '0px');
    });
    dock.style.setProperty('--glass-expansion', '0px');
  }
  document.addEventListener('visibilitychange', () => setVisible(nativeVisible));
  row.addEventListener('pointermove', (event) => { if (event.pointerType !== 'touch' && pointer !== event.clientX) { pointer = event.clientX; schedule(); } });
  row.addEventListener('pointerleave', () => { pointer = null; schedule(); });
  row.addEventListener('focusin', (event) => {
    const cell = event.target.closest('.dock-item');
    if (cell) {
      if (row.classList.contains('is-scrollable')) {
        const start = cell.offsetLeft - 96;
        const end = cell.offsetLeft + cell.offsetWidth + 96 - row.clientWidth;
        if (row.scrollLeft > start) row.scrollLeft = start;
        else if (row.scrollLeft < end) row.scrollLeft = end;
        syncNavigation();
      }
      const rect = cell.getBoundingClientRect(); pointer = rect.left + rect.width / 2; schedule();
    }
  });
  row.addEventListener('focusout', () => { pointer = null; schedule(); });
  row.addEventListener('scroll', () => { pointer = null; schedule(); syncNavigation(); }, { passive: true });
  const scrollPage = direction => row.scrollBy({ left: direction * Math.max(120, row.clientWidth - 192), behavior: reduced.matches ? 'instant' : 'smooth' });
  previous?.addEventListener('click', () => scrollPage(-1));
  next?.addEventListener('click', () => scrollPage(1));
  row.addEventListener('wheel', event => {
    if (!row.classList.contains('is-scrollable') || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const multiplier = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? row.clientWidth : 1;
    row.scrollLeft += event.deltaY * multiplier;
    event.preventDefault();
  }, { passive: false });
  reduced.addEventListener('change', schedule);
  return {
    setVisible,
    refresh() {
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      lastTime = null;
      pointer = null;
      cells = [...row.querySelectorAll('.dock-item')];
      scales = cells.map(() => 1);
      offsets = cells.map(() => 0);
      wanted = new Array(cells.length);
      extra = new Array(cells.length);
      syncOverflow();
      schedule();
    },
    reset() { pointer = null; schedule(); },
  };
};
