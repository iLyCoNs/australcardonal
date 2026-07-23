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
    if (!_buyerNearby.enabled || _cachedToolMode()) return false;
    if (!_isNearbyTipo(pin.tipo)) return false;
    if (!_buyerNearby.show || !pin.id || pin.id !== _buyerNearby.spotlightId) return true;
    return false;
  }

  function _editorHidesPin(pin) {
    if (!_editorHideNearby) return false;
    if (!_cachedToolMode()) return false;
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
      if (!on) el.classList.remove('is-open');
      el._kpkFront = on;
      el._kpkDim = !!_frontId && !on;
    });
  }

  /** Trae un pin al frente y lo expande (horizonte: Maps/Waze/meta) */
  function openPin(id) {
    if (!id) return;
    _bringFront(id);
    if (!_layer) return;
    const el = _layer.querySelector('.f-geo-pin[data-id="' + id + '"]');
    if (!el) return;
    _clearOpenPins(id);
    el.classList.add('is-open', 'is-front');
  }

  function _clearOpenPins(exceptId) {
    if (!_layer) return;
    _layer.querySelectorAll('.f-geo-pin.is-open').forEach(el => {
      if (exceptId && el.dataset.id === exceptId) return;
      el.classList.remove('is-open');
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

  /**
   * @param {boolean} [camMoved] si false y no hay dirty/drag → no-op (ahorra trabajo en idle quieto)
   */
  function update(camMoved) {
    if (_dirty || _draggingId) {
      _dirty = false;
      _frameToolMode = null;
      _rebuild();
      return;
    }
    if (camMoved === false) return;
    _frameToolMode = null;
    _repositionAll();
  }

  /** Cache por frame: evita N× query del panel en _placeEl */
  let _frameToolMode = null;
  function _cachedToolMode() {
    if (_frameToolMode == null) _frameToolMode = _isToolMode();
    return _frameToolMode;
  }

  function _syncEditability() {
    if (!_layer) return;
    const editable = _isToolMode();
    if (_lastEditable === editable) return;
    _lastEditable = editable;
    _layer.classList.toggle('is-readonly', !editable);
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
      const wantAmenity = pin.tipo === 'amenidad';
      const wantHorizon = (pin.tipo || 'horizonte') === 'horizonte';
      const isAmenityEl = !!(el && el.classList.contains('f-geo-pin--amenity'));
      const isMistEl = !!(el && (el.querySelector('.fgp-card--hz') || el.querySelector('.fgp-card--vert') || el.querySelector('.fgp-card--mist')));
      if (el && (wantAmenity !== isAmenityEl || (!wantAmenity && wantHorizon !== isMistEl))) {
        el.remove();
        _elMap.delete(pin.id);
        el = null;
      }
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
    _lastEditable = null; // forzar sync tras rebuild
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
    if (pin.tipo === 'amenidad') {
      return _createAmenityEl(pin);
    }
    const el = document.createElement('div');
    el.className = 'f-geo-pin';
    el.dataset.id = pin.id;
    const isHorizon = (pin.tipo || 'horizonte') === 'horizonte';
    if (isHorizon) {
      el.innerHTML = `
      <div class="fgp-card fgp-card--hz">
        <div class="fgp-hz">
          <div class="fgp-glass fgp-hz__core">
            <span class="fgp-hz__ico" title="Ubicación" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>
            </span>
            <span class="fgp-title"></span>
            <span class="fgp-hz__ico" title="Rumbo" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="12 5 14.2 12 12 10.5 9.8 12" fill="currentColor" stroke="none"/><polygon points="12 19 9.8 12 12 13.5 14.2 12" fill="currentColor" stroke="none" opacity="0.45"/></svg>
            </span>
          </div>
          <div class="fgp-hz__reveal">
            <button type="button" class="fgp-glass fgp-hz__app" data-act="waze" title="Waze" aria-label="Abrir en Waze">
              <img src="${ICON_WAZE}" alt="" width="16" height="16" decoding="async">
            </button>
            <button type="button" class="fgp-glass fgp-hz__app" data-act="maps" title="Google Maps" aria-label="Abrir en Google Maps">
              <img src="${ICON_MAPS}" alt="" width="16" height="16" decoding="async">
            </button>
            <button type="button" class="fgp-glass fgp-hz__app fgp-hz__app--edit fgp-btn" data-act="edit" title="Editar" aria-label="Editar">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <div class="fgp-glass fgp-hz__meta">
              <span class="fgp-meta-item">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 16l2-6h10l2 6"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/><path d="M7 10V8a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/></svg>
                <span class="fgp-meta-dist">—</span>
              </span>
              <span class="fgp-meta-sep" aria-hidden="true"></span>
              <span class="fgp-meta-item">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 1.5"/></svg>
                <span class="fgp-meta-eta">—</span>
              </span>
            </div>
          </div>
        </div>
      </div>
      <div class="fgp-tip fgp-tip--hz" aria-hidden="true">
        <span class="fgp-tip-glow"></span>
        <span class="fgp-tip-core"></span>
      </div>`;
    } else {
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
      </div>`;
    }

    _bindPinPointer(el);
    _fillPinEl(el, pin);
    return el;
  }

  function _createAmenityEl(pin) {
    const el = document.createElement('div');
    el.className = 'f-geo-pin f-geo-pin--amenity';
    el.dataset.id = pin.id;
    el.innerHTML = `
      <div class="kpk-amenity-mark" role="button" tabindex="0">
        <span class="kam-ring" aria-hidden="true"></span>
        <span class="kam-ico" aria-hidden="true"></span>
        <span class="kam-label"></span>
      </div>
      <button type="button" class="kam-del fgp-btn" data-act="delete" title="Eliminar" aria-label="Eliminar">×</button>
    `;
    _bindPinPointer(el);
    _fillPinEl(el, pin);
    return el;
  }

  function _bindPinPointer(el) {
    const onPointerDown = (e) => {
      if (e.button != null && e.button !== 0) return;
      _bringFront(el.dataset.id);
      if (e.target.closest('[data-act]') || e.target.closest('.kam-del')) {
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
        const cap = e.target.closest('.kpk-amenity-mark') || e.target.closest('.fgp-card') || e.target.closest('.fgp-tip') || el;
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
      const btn = e.target.closest('[data-act]') || e.target.closest('.kam-del');
      const tool = _isToolMode();
      const id = el.dataset.id;

      if (!btn) {
        if (_dragMoved) return;
        if (tool) {
          if (window.FerrariGeoEditor) window.FerrariGeoEditor.open(id);
          return;
        }
        // Horizonte: 1er toque = expandir (Maps/Waze + km/min); 2º toque = ficha info
        const p0 = window.FerrariGeo && window.FerrariGeo.getPin(id);
        if (p0 && p0.tipo === 'horizonte') {
          const wasOpen = el.classList.contains('is-open');
          _clearOpenPins(id);
          if (!wasOpen) {
            el.classList.add('is-open');
            return;
          }
        }
        if (window.FerrariGeoEditor && window.FerrariGeoEditor.openInfo) {
          window.FerrariGeoEditor.openInfo(id);
        }
        return;
      }

      const act = btn.dataset.act;
      const p = window.FerrariGeo.getPin(id);
      if (!p) return;
      if (act === 'delete') {
        if (!tool) return;
        window.FerrariGeo.removePin(id);
        if (window.FerrariAmenities && window.FerrariAmenities.refreshLegend) {
          window.FerrariAmenities.refreshLegend();
        }
        return;
      }
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
  }

  function _fillPinEl(el, pin) {
    el.dataset.tipo = pin.tipo || 'horizonte';
    el.dataset.cat = pin.categoria || 'otro';
    const meta = window.FerrariGeo.categoryMeta(pin.tipo, pin.categoria);

    if (pin.tipo === 'amenidad') {
      el.classList.add('f-geo-pin--amenity');
      const ico = el.querySelector('.kam-ico');
      const lab = el.querySelector('.kam-label');
      const cat = window.FerrariAmenitiesCatalog;
      const item = cat ? cat.get(pin.icon || pin.categoria) : null;
      if (ico) ico.innerHTML = item && item.svg ? item.svg : '';
      if (lab) lab.textContent = pin.titulo || (item && item.label) || meta.label || '';
      const scale = Math.max(0.75, Math.min(1.45, Number(pin.scale) || 1));
      el.style.setProperty('--kam-scale', String(scale));
      const del = el.querySelector('.kam-del');
      if (del) del.style.display = '';
      return;
    }

    const icon = el.querySelector('.fgp-icon');
    const title = el.querySelector('.fgp-title');
    const sub = el.querySelector('.fgp-sub');
    const metaDist = el.querySelector('.fgp-meta-dist');
    const metaEta = el.querySelector('.fgp-meta-eta');
    if (icon) icon.textContent = meta.emoji || '📍';
    if (title) {
      const raw = String(pin.titulo || meta.label || '').trim();
      const shown = pin.tipo === 'horizonte' ? raw.toUpperCase() : raw;
      const maxLen = pin.tipo === 'horizonte' ? 22 : 18;
      title.textContent = shown.length > maxLen ? shown.slice(0, maxLen - 1) + '…' : shown;
      title.title = raw;
    }

    let line2 = meta.label;
    let distTxt = '—';
    let etaTxt = '—';
    const routeDist = pin._routeDistM != null ? pin._routeDistM : pin.routeDistM;
    const routeSec = pin._routeSec != null ? pin._routeSec : pin.routeSec;
    if (routeDist != null && window.FerrariGeo.formatDistance) {
      distTxt = window.FerrariGeo.formatDistance(routeDist);
      etaTxt = routeSec != null && window.FerrariGeo.formatEtaSeconds
        ? window.FerrariGeo.formatEtaSeconds(routeSec)
        : '—';
    } else if (pin._distM != null && window.FerrariGeo.formatDistance) {
      distTxt = window.FerrariGeo.formatDistance(pin._distM);
      etaTxt = window.FerrariGeo.formatEtaMinutes
        ? String(window.FerrariGeo.formatEtaMinutes(pin._distM)).replace(/^≈\s*/, '')
        : '—';
    }
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
    if (metaDist) metaDist.textContent = distTxt;
    if (metaEta) metaEta.textContent = etaTxt;

    const hasGps = pin.lat != null && pin.lng != null;
    el.querySelectorAll('[data-act="maps"], [data-act="waze"]').forEach(b => {
      b.style.display = '';
      b.classList.toggle('is-disabled', !hasGps);
    });
  }

  function _placeEl(el, pin) {
    if (_editorHidesPin(pin) || _buyerHidesPin(pin)) {
      if (el.style.display !== 'none') el.style.display = 'none';
      return;
    }
    _pinPt[0] = pin.pitch;
    _pinPt[1] = pin.yaw;
    const cam = window.FerrariCamera.getCamFastInto(_pinPt, _pinCam);
    if (cam.z <= 0.0001) {
      if (el.style.display !== 'none') el.style.display = 'none';
      return;
    }
    const proj = window.FerrariCamera.getProjectionParams();
    const { px, py } = window.FerrariCamera.camToPixel(cam, proj);

    if (px < -120 || py < -40 || px > proj.w + 120 || py > proj.h + 120) {
      if (el.style.display !== 'none') el.style.display = 'none';
      return;
    }
    if (el.style.display === 'none') el.style.display = '';

    const tx = px.toFixed(1);
    const ty = py.toFixed(1);
    const nextT = 'translate(' + tx + 'px, ' + ty + 'px)';
    if (el._kpkT !== nextT) {
      el._kpkT = nextT;
      el.style.transform = nextT;
    }

    // Profundidad: más cerca → más arriba en la pila (salvo el pin en foco)
    const depthZ = Math.max(1, Math.min(40, Math.round(cam.z * 28)));
    const nextZ = el.dataset.id !== _frontId ? String(depthZ) : '80';
    if (el.style.zIndex !== nextZ) el.style.zIndex = nextZ;

    // Solo voltear si el tip está pegado al borde superior (card siempre ancla abajo al lugar)
    const flipDown = py < 58;
    const isFront = el.dataset.id === _frontId;
    const isDimmed = !!_frontId && !isFront;
    if (el._kpkFlip !== flipDown) {
      el._kpkFlip = flipDown;
      el.classList.toggle('is-flip', flipDown);
    }
    if (el._kpkFront !== isFront) {
      el._kpkFront = isFront;
      el.classList.toggle('is-front', isFront);
    }
    if (el._kpkDim !== isDimmed) {
      el._kpkDim = isDimmed;
      el.classList.toggle('is-dimmed', isDimmed);
    }
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

  function setAmenitySpotlight(id) {
    _bringFront(id || null);
    markDirty();
  }

  window.FerrariGeoPins = {
    markDirty,
    update,
    rebuild: () => { _dirty = true; _rebuild(); },
    consumeInteractGuard,
    isDragging,
    bringFront: _bringFront,
    clearFront: _clearFront,
    openPin,
    setBuyerNearbyFilter,
    setAmenitySpotlight,
    setEditorNearbyHidden,
    isEditorNearbyHidden
  };

  console.log('[Ferrari/GeoPins] ✓ Módulo inicializado');

})();
