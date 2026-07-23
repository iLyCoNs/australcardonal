/**
 * f-draggable.js — Arrastre unificado de widgets (mouse + touch + pen)
 * Uso: FerrariDrag.attach(el, { handle: '.header', ignore: 'button,a,input,...' })
 */
'use strict';

(function () {
  const DEFAULT_IGNORE =
    'button, a, input, select, textarea, label, iframe, .kpk-widget-close, .kpk-fw-close, .kpk-tw-close, .kpk-cal__close, .kpk-ai-close, .kpk-spectator-close, .kpk-mbp-btn, [contenteditable="true"]';

  /** @type {WeakMap<Element, object>} */
  const _attached = new WeakMap();

  function _clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function _matchHandle(el, handleOpt, target) {
    if (!handleOpt) return el;
    if (typeof handleOpt === 'string') {
      const hit = target.closest(handleOpt);
      return hit && el.contains(hit) ? hit : null;
    }
    if (handleOpt.nodeType === 1) {
      return handleOpt.contains(target) || handleOpt === target ? handleOpt : null;
    }
    return null;
  }

  function _pinToViewport(el, left, top) {
    const w = el.offsetWidth || el.getBoundingClientRect().width;
    const h = el.offsetHeight || el.getBoundingClientRect().height;
    const maxL = Math.max(0, window.innerWidth - w);
    const maxT = Math.max(0, window.innerHeight - h);
    el.style.setProperty('left', _clamp(left, 0, maxL) + 'px', 'important');
    el.style.setProperty('top', _clamp(top, 0, maxT) + 'px', 'important');
  }

  /**
   * Convierte posición CSS (right/bottom/transform/centering) a left/top absolutos.
   */
  function _freezePosition(el) {
    const rect = el.getBoundingClientRect();
    el.classList.add('is-user-positioned');
    el.style.setProperty('position', 'fixed', 'important');
    el.style.setProperty('right', 'auto', 'important');
    el.style.setProperty('bottom', 'auto', 'important');
    el.style.setProperty('margin', '0', 'important');
    el.style.setProperty('transform', 'none', 'important');
    el.style.setProperty('left', rect.left + 'px', 'important');
    el.style.setProperty('top', rect.top + 'px', 'important');
    if (!el.style.width) {
      el.style.setProperty('width', rect.width + 'px', 'important');
    }
    return rect;
  }

  function attach(el, opts) {
    if (!el || el.nodeType !== 1) return null;
    opts = opts || {};

    const prev = _attached.get(el);
    if (prev) {
      prev.opts = Object.assign({}, prev.opts, opts);
      _styleHandle(el, prev.opts);
      return prev;
    }

    const state = {
      el: el,
      opts: Object.assign(
        {
          handle: null,
          ignore: DEFAULT_IGNORE,
          bounds: 'viewport',
          cursor: true
        },
        opts
      ),
      dragging: false,
      pointerId: null,
      offX: 0,
      offY: 0
    };

    function onPointerDown(e) {
      if (e.button != null && e.button !== 0) return;
      if (e.pointerType === 'mouse' && e.buttons !== 1) return;

      const ignoreSel = state.opts.ignore || DEFAULT_IGNORE;
      if (ignoreSel && e.target.closest && e.target.closest(ignoreSel)) return;

      const handle = _matchHandle(el, state.opts.handle, e.target);
      if (!handle) return;

      e.preventDefault();
      e.stopPropagation();

      const rect = el.classList.contains('is-user-positioned')
        ? el.getBoundingClientRect()
        : _freezePosition(el);

      state.dragging = true;
      state.pointerId = e.pointerId;
      state.offX = e.clientX - rect.left;
      state.offY = e.clientY - rect.top;

      el.classList.add('is-dragging');
      el.style.transition = 'none';
      el.style.zIndex = String(Math.max(100000, parseInt(getComputedStyle(el).zIndex, 10) || 0) + 2);

      try {
        handle.setPointerCapture(e.pointerId);
      } catch (err) {}

      document.body.classList.add('kpk-widget-dragging');
    }

    function onPointerMove(e) {
      if (!state.dragging) return;
      if (state.pointerId != null && e.pointerId !== state.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      _pinToViewport(el, e.clientX - state.offX, e.clientY - state.offY);
    }

    function endDrag(e) {
      if (!state.dragging) return;
      if (e && state.pointerId != null && e.pointerId !== state.pointerId) return;
      state.dragging = false;
      state.pointerId = null;
      el.classList.remove('is-dragging');
      document.body.classList.remove('kpk-widget-dragging');
    }

    el.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', endDrag, true);
    window.addEventListener('pointercancel', endDrag, true);

    // Re-clamp al rotar / resize viewport
    function onResize() {
      if (!el.classList.contains('is-user-positioned')) return;
      const rect = el.getBoundingClientRect();
      _pinToViewport(el, rect.left, rect.top);
    }
    window.addEventListener('resize', onResize);

    state.destroy = function () {
      el.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', endDrag, true);
      window.removeEventListener('pointercancel', endDrag, true);
      window.removeEventListener('resize', onResize);
      el.classList.remove('is-dragging', 'is-user-positioned', 'kpk-is-draggable');
      document.body.classList.remove('kpk-widget-dragging');
      _attached.delete(el);
    };

    el.classList.add('kpk-is-draggable');
    _styleHandle(el, state.opts);
    _attached.set(el, state);
    return state;
  }

  function _styleHandle(el, opts) {
    if (!opts || !opts.cursor) return;
    if (typeof opts.handle !== 'string') return;
    try {
      el.querySelectorAll(opts.handle).forEach(function (h) {
        h.classList.add('kpk-drag-handle');
      });
    } catch (e) {}
  }

  /** Atajo: adjunta si el nodo existe. */
  function attachIf(idOrEl, opts) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    return el ? attach(el, opts) : null;
  }

  window.FerrariDrag = {
    attach: attach,
    attachIf: attachIf,
    DEFAULT_IGNORE: DEFAULT_IGNORE
  };

  console.log('[Ferrari/Drag] ✓ Módulo cargado');
})();
