/**
 * f-geo-pins.js — Render + drag de pins geo (horizonte / ruta / poi)
 * Overlay HTML slim encima del SVG (z-index HUD).
 * Drag / edición solo en modo herramienta (panel abierto).
 */

'use strict';

(function () {

  let _layer = null;
  let _dirty = true;
  let _draggingId = null;
  let _dragMoved = false;
  let _frontId = null;
  /** id → HTMLElement del pin (evita querySelector por pin cada frame) */
  let _elMap = new Map();
  /** Evita que herramientas geo creen un pin al soltar/clickear uno existente */
  let _interactGuardUntil = 0;
  /** Scratch para getCamFastInto en _placeEl (evita 6 trig + alloc por pin por frame) */
  const _pinPt  = [0, 0];
  const _pinCam = { x: 0, y: 0, z: 0 };
  /** Última edición cacheada para _syncEditability (evita querySelectorAll por frame) */
  let _lastEditable = null;

  /** Modo comprador: ocultar pins cercanos (poi/ruta) salvo spotlight del dock */
  let _buyerNearby = {
    enabled: false,
    show: false,
    spotlightId: null
  };

  /** Modo edición (panel herramientas): ocultar pins Cercanos para no tapar Horizonte */
  let _editorHideNearby = (function () {
    try {
      // Default ON (ocultos) salvo que el editor haya elegido mostrarlos
      return localStorage.getItem('kpk_editor_hide_nearby') !== '0';
    } catch (e) {
      return true;
    }
  })();

  const ICON_MAPS = 'assets/icons/google-maps.svg';
  const ICON_WAZE = 'assets/icons/waze.svg?v=2';

  function setBuyerNearbyFilter(opts) {
    opts = opts || {};
    const next = {
      enabled: !!opts.enabled,
      show: !!opts.show,
      spotlightId: opts.spotlightId || null
    };
    if (
      next.enabled === _buyerNearby.enabled &&
      next.show === _buyerNearby.show &&
      next.spotlightId === _buyerNearby.spotlightId
    ) {
      return;
    }
    _buyerNearby = next;
    if (!next.show || !next.spotlightId) {
      if (_frontId && (!_buyerNearby.enabled || !_buyerNearby.show)) {
        _clearFront();
      }
    } else {
      _bringFront(next.spotlightId);
    }
    markDirty();
  }

  function _isNearbyTipo(tipo) {
    return tipo === 'poi' || tipo === 'ruta';
  }

  function _buyerHidesPin(pin) {
    if (!_buyerNearby.enabled || _isToolMode()) return false;
    if (!_isNearbyTipo(pin.tipo)) return false;
    if (!_buyerNearby.show || !pin.id || pin.id !== _buyerNearby.spotlightId) return true;
    return false;
  }

  function _editorHidesPin(pin) {
    if (!_editorHideNearby) return false;
    if (!_isToolMode()) return false;
    return _isNearbyTipo(pin.tipo);
  }

  function setEditorNearbyHidden(hidden) {
    _editorHideNearby = !!hidden;
    try {
      localStorage.setItem('kpk_editor_hide_nearby', _editorHideNearby ? '1' : '0');
    } catch (e) {}
    markDirty();
    return _editorHideNearby;
  }

  function isEditorNearbyHidden() {
    return !!_editorHideNearby;
  }

  function _armInteractGuard(ms) {
    _interactGuardUntil = Date.now() + (ms || 450);
  }

  function consumeInteractGuard() {
    if (Date.now() < _interactGuardUntil) return true;
    return false;
  }

  function isDragging() {
    return !!_draggingId;
  }

  function _bringFront(id) {
    _frontId = id || null;
    if (!_layer) return;
    _layer.querySelectorAll('.f-geo-pin').forEach(el => {
      const on = el.dataset.id === _frontId;
      el.classList.toggle('is-front', on);
      el.classList.toggle('is-dimmed', !!_frontId && !on);
    });
  }

  function _clearFront() {
    if (!_frontId) return;
    _bringFront(null);
  }

  function _isToolMode() {
    if (window.FerrariPanel && typeof window.FerrariPanel.isToolMode === 'function') {
      return window.FerrariPanel.isToolMode();
    }
    const panel = document.getElementById('kpk-panel');
    return !!(panel && panel.classList.contains('kpk-panel--open'));
  }

  function _ensureLayer() {
    if (_layer) return _layer;
    _layer = document.createElement('div');
    _layer.id = 'f-geo-pins-layer';
    const host = document.getElementById('panorama-container') || document.body;
    host.appendChild(_layer);
    return _layer;
  }

  function markDirty() { _dirty = true; }

  function update() {
    if (!_dirty && !_draggingId) {
      _repositionAll();
      _syncEditability();
      return;
    }
    _dirty = false;
    _rebuild();
  }

  function _syncEditability() {
    if (!_layer) return;
    const editable = _isToolMode();
    if (_lastEditable === editable) return; // sin cambios → nada que hacer
    _lastEditable = editable;
    _layer.classList.toggle('is-readonly', !editable);
    _elMap.forEach(el => {
      const e = el.querySelector('.fgp-btn--edit');
      if (e) e.style.display = editable ? '' : 'none';
    });
  }

  function _rebuild() {
    const layer = _ensureLayer();
    const pins = (window.FerrariGeo && window.FerrariGeo.pins) || [];
    // Reconstruir mapa id→el desde el DOM (barato, solo pasa en _dirty)
    _elMap.clear();
    Array.from(layer.querySelectorAll('.f-geo-pin')).forEach(el => {
      _elMap.set(el.dataset.id, el);
    });

    const seen = new Set();
    pins.forEach(pin => {
      seen.add(pin.id);
      let el = _elMap.get(pin.id);
      if (!el) {
        el = _createPinEl(pin);
        layer.appendChild(el);
        _elMap.set(pin.id, el);
      } else {
        _fillPinEl(el, pin);
      }
      _placeEl(el, pin);
    });

    _elMap.forEach((el, id) => {
      if (!seen.has(id)) {
        el.remove();
        _elMap.delete(id);
      }
    });
    _syncEditability();
  }

  function _repositionAll() {
    if (!window.FerrariGeo) return;
    _ensureLayer();
    const pins = window.FerrariGeo.pins;
    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];
      const el = _elMap.get(pin.id);
      if (el) _placeEl(el, pin);
    }
  }

  function _createPinEl(pin) {
    const el = document.createElement('div');
    el.className = 'f-geo-pin';
    el.dataset.id = pin.id;
    el.innerHTML = `
      <div class="fgp-card">
        <div class="fgp-icon" aria-hidden="true"></div>
        <div class="fgp-body">
          <div class="fgp-title"></div>
          <div class="fgp-sub"></div>
        </div>
        <div class="fgp-actions">
          <button type="button" class="fgp-btn fgp-btn--brand" data-act="maps" title="Google Maps" aria-label="Google Maps">
            <img src="${ICON_MAPS}" alt="" width="16" height="16" decoding="async">
          </button>
          <button type="button" class="fgp-btn fgp-btn--brand" data-act="waze" title="Waze" aria-label="Waze">
            <img src="${ICON_WAZE}" alt="" width="16" height="16" decoding="async">
          </button>
          <button type="button" class="fgp-btn fgp-btn--edit" data-act="edit" title="Editar" aria-label="Editar">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
        </div>
        <div class="fgp-stem" aria-hidden="true"></div>
      </div>
      <div class="fgp-tip" aria-hidden="true">
        <span class="fgp-tip-glow"></span>
        <span class="fgp-tip-core"></span>
      </div>
    `;

    const onPointerDown = (e) => {
      if (e.button != null && e.button !== 0) return;
      _bringFront(el.dataset.id);
      if (e.target.closest('.fgp-btn')) {
        _armInteractGuard(400);
        return;
      }
      _armInteractGuard(600);
      if (!_isToolMode()) return;
      e.preventDefault();
      e.stopPropagation();
      const id = el.dataset.id;
      _draggingId = id;
      _dragMoved = false;
      el.classList.add('is-dragging');
      try {
        const cap = e.target.closest('.fgp-card') || e.target.closest('.fgp-tip') || el;
        cap.setPointerCapture && cap.setPointerCapture(e.pointerId);
      } catch (err) { /* ok */ }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('mousedown', (e) => {
      if (window.PointerEvent) return;
      onPointerDown(e);
    });
    el.addEventListener('pointerenter', () => {
      if (!_draggingId) _bringFront(el.dataset.id);
    });

    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _armInteractGuard(400);
      _bringFront(el.dataset.id);
      const btn = e.target.closest('.fgp-btn');
      const tool = _isToolMode();
      const id = el.dataset.id;

      if (!btn) {
        if (_dragMoved) return;
        if (tool) {
          if (window.FerrariGeoEditor) window.FerrariGeoEditor.open(id);
        } else if (window.FerrariGeoEditor && window.FerrariGeoEditor.openInfo) {
          window.FerrariGeoEditor.openInfo(id);
        }
        return;
      }

      const act = btn.dataset.act;
      const p = window.FerrariGeo.getPin(id);
      if (!p) return;
      if (act === 'edit') {
        if (!tool) return;
        if (window.FerrariGeoEditor) window.FerrariGeoEditor.open(p.id);
      } else if ((act === 'maps' || act === 'waze') && p.lat != null && p.lng != null) {
        const links = window.FerrariGeo.mapsLinks(p.lat, p.lng);
        window.open(act === 'maps' ? links.google : links.waze, '_blank');
      } else {
        window.FerrariUI && window.FerrariUI.showToast('Este pin no tiene coordenadas GPS.', 'info');
      }
    });

    _fillPinEl(el, pin);
    return el;
  }

  function _fillPinEl(el, pin) {
    el.dataset.tipo = pin.tipo || 'horizonte';
    el.dataset.cat = pin.categoria || 'otro';
    const meta = window.FerrariGeo.categoryMeta(pin.tipo, pin.categoria);
    const icon = el.querySelector('.fgp-icon');
    const title = el.querySelector('.fgp-title');
    const sub = el.querySelector('.fgp-sub');
    if (icon) icon.textContent = meta.emoji || '📍';
    if (title) {
      title.textContent = pin.titulo || meta.label;
      title.title = pin.titulo || meta.label || '';
    }

    let line2 = meta.label;
    if (window.FerrariGeo.formatPinDistanceEta) {
      const m = window.FerrariGeo.formatPinDistanceEta(pin);
      if (m && m !== '—') line2 = m;
      else if (pin.lat != null) line2 = 'Sin origen dron';
    } else if (pin._routeDistM != null && pin._routeSec != null) {
      line2 = `${window.FerrariGeo.formatDistance(pin._routeDistM)} · ${window.FerrariGeo.formatEtaSeconds(pin._routeSec)}`;
    } else if (pin._distM != null) {
      line2 = `≈ ${window.FerrariGeo.formatDistance(pin._distM)} · ${window.FerrariGeo.formatEtaMinutes(pin._distM)}`;
    } else if (pin.lat != null) {
      line2 = 'Sin origen dron';
    }
    if (sub) sub.textContent = line2;

    const hasGps = pin.lat != null && pin.lng != null;
    el.querySelectorAll('[data-act="maps"], [data-act="waze"]').forEach(b => {
      b.classList.toggle('is-disabled', !hasGps);
    });
  }

  function _placeEl(el, pin) {
    if (_editorHidesPin(pin) || _buyerHidesPin(pin)) {
      el.style.display = 'none';
      return;
    }
    _pinPt[0] = pin.pitch;
    _pinPt[1] = pin.yaw;
    const cam = window.FerrariCamera.getCamFastInto(_pinPt, _pinCam);
    if (cam.z <= 0.0001) {
      el.style.display = 'none';
      return;
    }
    const proj = window.FerrariCamera.getProjectionParams();
    const { px, py } = window.FerrariCamera.camToPixel(cam, proj);

    if (px < -120 || py < -40 || px > proj.w + 120 || py > proj.h + 120) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;

    // Profundidad: más cerca → más arriba en la pila (salvo el pin en foco)
    const depthZ = Math.max(1, Math.min(40, Math.round(cam.z * 28)));
    if (el.dataset.id !== _frontId) {
      el.style.zIndex = String(depthZ);
    } else {
      el.style.zIndex = '80';
    }

    // Solo voltear si el tip está pegado al borde superior (card siempre ancla abajo al lugar)
    const flipDown = py < 58;
    el.classList.toggle('is-flip', flipDown);
    el.classList.toggle('is-front', el.dataset.id === _frontId);
    el.classList.toggle('is-dimmed', !!_frontId && el.dataset.id !== _frontId);
  }

  function _dragToEvent(e) {
    if (!_draggingId) return;
    if (!_isToolMode()) {
      _endDrag();
      return;
    }
    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return;
    _dragMoved = true;
    _armInteractGuard(600);
    let coords;
    try { coords = viewer.mouseEventToCoords(e); } catch (err) { return; }
    if (!coords) return;
    window.FerrariGeo.updatePin(_draggingId, {
      pitch: coords[0],
      yaw: coords[1],
      lockYaw: true
    });
  }

  function _endDrag() {
    if (!_draggingId) return;
    _armInteractGuard(500);
    const layer = _ensureLayer();
    const el = layer.querySelector(`.f-geo-pin[data-id="${_draggingId}"]`);
    if (el) el.classList.remove('is-dragging');
    _draggingId = null;
    setTimeout(() => { _dragMoved = false; }, 80);
  }

  document.addEventListener('pointermove', _dragToEvent);
  document.addEventListener('pointerup', _endDrag);
  document.addEventListener('pointercancel', _endDrag);
  document.addEventListener('mousemove', (e) => {
    if (window.PointerEvent) return;
    _dragToEvent(e);
  });
  document.addEventListener('mouseup', () => {
    if (window.PointerEvent) return;
    _endDrag();
  });

  document.addEventListener('ferrari:panel-toggle', () => {
    _syncEditability();
  });

  document.addEventListener('pointerdown', (e) => {
    if (!_frontId) return;
    if (e.target && e.target.closest && e.target.closest('.f-geo-pin')) return;
    _clearFront();
  }, true);

  window.FerrariGeoPins = {
    markDirty,
    update,
    rebuild: () => { _dirty = true; _rebuild(); },
    consumeInteractGuard,
    isDragging,
    bringFront: _bringFront,
    clearFront: _clearFront,
    setBuyerNearbyFilter,
    setEditorNearbyHidden,
    isEditorNearbyHidden
  };

  console.log('[Ferrari/GeoPins] ✓ Módulo inicializado');

})();
