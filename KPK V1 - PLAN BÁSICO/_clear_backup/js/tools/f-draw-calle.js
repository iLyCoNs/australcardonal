/**
 * f-draw-calle.js — Herramienta de dibujo de calles (recta y curva Arq2)
 *
 * Tipos: 'calle' (polilínea recta), 'calle-curva-arq2' (polilínea libre)
 *
 * Controles:
 *   Click       → agregar punto de calle (con snap magnético a bordes de lotes)
 *   Doble-click → finalizar tramo
 *   Enter       → finalizar
 *   Backspace   → deshacer último punto
 *   Escape      → cancelar
 *
 * Snap magnético:
 *   Cuando el cursor se acerca a un vértice de lote dentro de SNAP_PX píxeles,
 *   el punto se "imanta" a ese vértice y aparece un anillo cyan indicador.
 */

'use strict';

(function() {

  let _activeTool   = null;
  let _bound        = false;
  let _currentWidth = 18;  // px — se controla con el slider
  let _snapPoint    = null; // { pitch, yaw } | null — punto magnético activo
  let _snapCircle   = null; // SVGCircleElement — indicador visual de snap

  const SNAP_PX = 22; // distancia en píxeles para activar el imán

  // ─── ACTIVACIÓN ───────────────────────────────────────────────────

  function activate(tipo) {
    window.FerrariTools.deactivateAllTools();

    _activeTool = tipo;
    document.getElementById('panorama-container').classList.add('drawing-active');
    window.FerrariOverlay.startDrawing([]);
    _setPannellumDraggable(false);

    // Mostrar el panel de ancho
    const widthPanel = document.getElementById('calle-width-panel');
    if (widthPanel) widthPanel.style.display = '';

    window.FerrariHUD && window.FerrariHUD.showDraw(tipo);
    window.FerrariUI  && window.FerrariUI.showToast(
      `Herramienta: ${_label(tipo)}. Click para colocar puntos.`, 'info'
    );

    console.log('[Ferrari/DrawCalle] Herramienta activada:', tipo);
  }

  function deactivate() {
    if (!_activeTool) return;
    _activeTool = null;
    _snapPoint  = null;
    document.getElementById('panorama-container').classList.remove('drawing-active');
    window.FerrariOverlay.clearOverlay();
    _setPannellumDraggable(true);

    // Ocultar panel de ancho y snap indicator
    const widthPanel = document.getElementById('calle-width-panel');
    if (widthPanel) widthPanel.style.display = 'none';
    _removeSnapIndicator();

    window.FerrariHUD && window.FerrariHUD.hideDraw();
    console.log('[Ferrari/DrawCalle] Herramienta desactivada');
  }

  function isActive()      { return _activeTool !== null; }
  function getActiveTool() { return _activeTool; }

  // ─── SNAP MAGNÉTICO ───────────────────────────────────────────────

  /**
   * Busca el vértice de lote más cercano al cursor (en espacio píxel).
   * Si está dentro de SNAP_PX, retorna { pitch, yaw } del vértice.
   * Si no, retorna null.
   * @param {number} pitch — pitch del cursor
   * @param {number} yaw   — yaw del cursor
   * @returns {{ pitch: number, yaw: number } | null}
   */
  function _findSnapPoint(pitch, yaw) {
    const lines = window.allDrawnLines || [];
    if (!window.FerrariCamera) return null;

    const proj = window.FerrariCamera.getProjectionParams();

    // Proyectar cursor a pixels para comparar distancias
    const curCam = window.FerrariCamera.getCam(pitch, yaw);
    if (curCam.z <= 0.0001) return null;
    const curPx = window.FerrariCamera.camToPixel(curCam, proj);

    let bestDist = SNAP_PX;
    let bestPt   = null;

    // 1) Snap a ejes/vértices de otras calles (para unir la red)
    // NOTA: No se snap a lotes — el usuario ajusta bordes manualmente
    // con la herramienta Editar para conservar calidad premium.
    if (window.FerrariStreetNetwork && window.FerrariStreetNetwork.findStreetSnap) {
      const streetSnap = window.FerrariStreetNetwork.findStreetSnap(pitch, yaw, bestDist);
      if (streetSnap) {
        bestPt = streetSnap;
        bestDist = Math.min(bestDist, 0.001);
      }
    }

    // 2) Snap a vértices del calco KMZ (también con diseño vacío)
    if (window.FerrariKmzCalco && window.FerrariKmzCalco.findSnapPoint) {
      const kmzSnap = window.FerrariKmzCalco.findSnapPoint(pitch, yaw, bestDist);
      if (kmzSnap) {
        bestPt = kmzSnap;
      }
    }

    return bestPt;
  }

  /**
   * Actualiza el anillo visual de snap en el SVG overlay.
   * Se crea una vez y se reposiciona cada frame de mousemove.
   */
  function _updateSnapIndicator(snap) {
    const overlay = document.getElementById('kpk-draw-overlay');
    if (!overlay) return;

    if (!snap) {
      _removeSnapIndicator();
      return;
    }

    // Crear el círculo indicador si no existe
    if (!_snapCircle) {
      const SVG_NS = 'http://www.w3.org/2000/svg';
      _snapCircle  = document.createElementNS(SVG_NS, 'circle');
      _snapCircle.setAttribute('r', 10);
      _snapCircle.classList.add('snap-indicator');
      overlay.appendChild(_snapCircle);
    }

    _snapCircle.setAttribute('cx', snap.px.toFixed(2));
    _snapCircle.setAttribute('cy', snap.py.toFixed(2));
  }

  function _removeSnapIndicator() {
    if (_snapCircle && _snapCircle.parentNode) {
      _snapCircle.remove();
      _snapCircle = null;
    }
  }

  // ─── EVENTOS ──────────────────────────────────────────────────────

  function bindEvents() {
    if (_bound) return;
    _bound = true;

    const container = document.getElementById('pannellum-viewer');
    container.addEventListener('click',      _onClick,     false);
    container.addEventListener('dblclick',   _onDblClick,  false);
    container.addEventListener('mousemove',  _onMouseMove, false);
    container.addEventListener('touchstart', _onTouchStart, { passive: false });
    container.addEventListener('touchend',   _onTouchEnd,   { passive: false });
    document.addEventListener('keydown', _onKeyDown, false);

    // Slider de ancho de calle
    const slider  = document.getElementById('calle-width-slider');
    const display = document.getElementById('calle-width-value');
    if (slider) {
      slider.addEventListener('input', function() {
        _currentWidth = parseInt(slider.value, 10);
        if (display) display.textContent = _currentWidth + 'px';

        // Actualizar var(--val) para la barra de progreso CSS
        const pct = ((_currentWidth - 8) / 52) * 100;
        slider.style.setProperty('--val', pct + '%');

        // Calcular ancho angular basado en la focal actual (px -> grados)
        // d = f * tan(alpha/2) => alpha = 2 * atan(d/f)
        const proj = window.FerrariCamera.getProjectionParams();
        const f = proj.f || 1;
        const d_half = _currentWidth / 2;
        const alpha = 2 * Math.atan(d_half / f) * 180 / Math.PI;

        // Actualizar en vivo todas las calles ya dibujadas
        const lines = window.allDrawnLines;
        if (lines) {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.tipo === 'calle' || line.tipo === 'calle-curva-arq2') {
              line.anchoAngular = alpha;
              line._streetPolyDirty = true;
            }
          }
          // Persistir el cambio en localStorage
          if (window.FerrariState && window.FerrariState.saveToStorage) {
            window.FerrariState.saveToStorage();
          }
        }

        // Avisar al RAF loop que debe recalcular los SVG paths
        if (window.FerrariRAF && window.FerrariRAF.markDataDirty) {
          window.FerrariRAF.markDataDirty();
        }
      });
    }

    console.log('[Ferrari/DrawCalle] ✓ Eventos registrados');
  }

  function _onClick(e) {
    if (!_activeTool) return;
    if (e.button !== 0) return;

    // Usar snap si está activo, o las coordenadas normales
    let pitch, yaw;
    if (_snapPoint) {
      pitch = _snapPoint.pitch;
      yaw   = _snapPoint.yaw;
    } else {
      const coords = _getCoords(e);
      if (!coords) return;
      [pitch, yaw] = coords;
    }

    window.FerrariOverlay.addPoint(pitch, yaw);
    _updateHUD();
  }

  function _onDblClick(e) {
    if (!_activeTool) return;
    e.preventDefault();
    e.stopPropagation();
    const pts = window.FerrariOverlay.getActivePoints();
    if (pts.length >= 2) {
      window.FerrariOverlay.removeLastPoint();
      _finishLine();
    }
  }

  function _onMouseMove(e) {
    if (!_activeTool) return;
    const coords = _getCoords(e);
    if (!coords) return;

    // Calcular snap magnético
    const snap = _findSnapPoint(coords[0], coords[1]);
    _snapPoint = snap ? { pitch: snap.pitch, yaw: snap.yaw } : null;
    _updateSnapIndicator(snap);

    // El cursor del overlay sigue el snap si está activo
    const pitch = snap ? snap.pitch : coords[0];
    const yaw   = snap ? snap.yaw   : coords[1];
    window.FerrariOverlay.setCursor(pitch, yaw);
  }

  function _onTouchStart(e) { if (_activeTool) e.preventDefault(); }

  function _onTouchEnd(e) {
    if (!_activeTool) return;
    e.preventDefault();
    if (!e.changedTouches.length) return;
    const coords = _getCoords(e.changedTouches[0]);
    if (!coords) return;

    const snap = _findSnapPoint(coords[0], coords[1]);
    const pitch = snap ? snap.pitch : coords[0];
    const yaw   = snap ? snap.yaw   : coords[1];

    window.FerrariOverlay.addPoint(pitch, yaw);
    _updateHUD();
  }

  function _onKeyDown(e) {
    if (!_activeTool) return;
    switch(e.key) {
      case 'Enter':
        e.preventDefault();
        if (window.FerrariOverlay.getActivePoints().length >= 2) _finishLine();
        break;
      case 'Escape':
        e.preventDefault();
        window.FerrariOverlay.clearOverlay();
        window.FerrariOverlay.startDrawing([]);
        _removeSnapIndicator();
        _updateHUD();
        window.FerrariUI && window.FerrariUI.showToast('Dibujo cancelado.', 'info');
        break;
      case 'Backspace':
        e.preventDefault();
        window.FerrariOverlay.removeLastPoint();
        _updateHUD();
        break;
      case 'z':
      case 'Z':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          window.FerrariOverlay.removeLastPoint();
          _updateHUD();
        }
        break;
    }
  }

  // ─── LÓGICA ───────────────────────────────────────────────────────

  function _finishLine() {
    const pts  = window.FerrariOverlay.getActivePoints();
    const tipo = _activeTool;

    if (pts.length < 2) {
      window.FerrariUI && window.FerrariUI.showToast('Se necesitan al menos 2 puntos.', 'error');
      return;
    }

    const proj = window.FerrariCamera.getProjectionParams();
    const f = proj.f || 1;
    const d_half = _currentWidth / 2;
    const alpha = 2 * Math.atan(d_half / f) * 180 / Math.PI;

    // Guardar ancho angular en el modelo de datos para persistencia (FOV-invariante)
    const id = window.FerrariState.addLine({
      tipo,
      puntos:       pts,
      anchoAngular: alpha,
      createdAt:    Date.now()
    });

    // Unir con la red: empalmes en T + cruces + mismo cuerpo visual
    let mergeMsg = '';
    if (window.FerrariStreetNetwork && window.FerrariStreetNetwork.integrateStreet) {
      const result = window.FerrariStreetNetwork.integrateStreet(id);
      if (result.merged) {
        mergeMsg = ' · unida a la red';
        // Forzar sync DOM por si se insertaron vértices en otras calles
        if (window.DOMCache) window.DOMCache.version++;
        window.FerrariCamera.markDirty();
        if (window.FerrariRAF && window.FerrariRAF.markDataDirty) {
          window.FerrariRAF.markDataDirty();
        }
      }
    }

    console.log('[Ferrari/DrawCalle] Calle guardada:', id, '→', pts.length, 'puntos, ancho:', _currentWidth);
    window.FerrariUI && window.FerrariUI.showToast(
      `Calle guardada (${pts.length} pts, ${_currentWidth}px)${mergeMsg}`,
      'success'
    );

    _removeSnapIndicator();
    window.FerrariOverlay.startDrawing([]);
    _updateHUD();
  }

  // ─── HELPERS ────────────────────────────────────────────────────

  function _getCoords(e) {
    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return null;
    try {
      return viewer.mouseEventToCoords(e);
    } catch(err) {
      return _manualCoords(e);
    }
  }

  function _manualCoords(e) {
    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return null;
    const container = document.getElementById('pannellum-viewer');
    const rect = container.getBoundingClientRect();
    const x = (e.clientX || e.pageX) - rect.left;
    const y = (e.clientY || e.pageY) - rect.top;
    const w = rect.width, h = rect.height;
    let hfov = 90, pitch = 0, yaw = 0;
    try { hfov = viewer.getHfov(); pitch = viewer.getPitch(); yaw = viewer.getYaw(); } catch(e) {}
    const f   = 1 / Math.tan(hfov * Math.PI / 360);
    const nx  = (x / w) * 2 - 1;
    const ny2 = (1 - (y / h) * 2) * h / w;
    const n   = Math.sqrt(nx * nx + ny2 * ny2 + f * f);
    const sp  = Math.sin(pitch * Math.PI / 180), cp = Math.cos(pitch * Math.PI / 180);
    const pitchOut = Math.asin(Math.min(1, Math.max(-1, (ny2 * cp + f * sp) / n))) * 180 / Math.PI;
    const yawOut   = Math.atan2(nx, f * cp - ny2 * sp) * 180 / Math.PI + yaw;
    return [pitchOut, yawOut];
  }

  function _setPannellumDraggable(enabled) {
    const pnlm = document.querySelector('#pannellum-viewer .pnlm-container');
    if (pnlm) pnlm.style.pointerEvents = enabled ? 'auto' : 'none';
  }

  function _label(tipo) {
    return { 'calle': 'Calle Recta', 'calle-curva-arq2': 'Calle Curva' }[tipo] || tipo;
  }

  function _updateHUD() {
    const pts = window.FerrariOverlay.getActivePoints();
    window.FerrariHUD && window.FerrariHUD.updateDraw(_activeTool, pts.length);
  }

  // ─── API PÚBLICA ────────────────────────────────────────────────────
  window.FerrariDrawCalle = {
    activate,
    deactivate,
    isActive,
    getActiveTool,
    bindEvents
  };

  console.log('[Ferrari/DrawCalle] ✓ Módulo inicializado');

})();
