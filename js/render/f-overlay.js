/**
 * f-overlay.js — Draw overlay: vértices activos durante el dibujo
 *
 * REGLAS CRÍTICAS:
 * - Radio de círculos SOLO via setAttribute('r', N) — NUNCA CSS r: (Lección 1)
 * - NUNCA usar transition en propiedad r (Lección 8)
 * - Animación de escala: transform: scale() con transform-box: fill-box (Lección cross-browser)
 * - Crear elementos SVG con createElementNS — NUNCA innerHTML (Lección 4)
 * - El overlay siempre renderiza en #kpk-draw-overlay
 *
 * Gestiona:
 * - Círculos de vértices ya colocados (persistentes durante el dibujo)
 * - Línea de preview (punto actual → cursor)
 * - Cursor crosshair (círculo en la posición del mouse)
 */

'use strict';

(function() {

  const SVG_NS    = 'http://www.w3.org/2000/svg';
  const R_NORMAL  = 5;    // radio normal de vértice
  const R_FIRST   = 7;    // radio del primer vértice (cierre)
  const R_CURSOR  = 4;    // radio del punto de cursor
  const R_HOVER   = 9;    // radio del primer vértice al hacer hover (cierre disponible)

  // Estado del overlay
  let _activePoints   = [];          // [[pitch,yaw], ...] puntos del dibujo activo
  let _cursorPitch    = null;
  let _cursorYaw      = null;
  let _circleEls      = [];          // SVGCircleElement[] — uno por vértice
  let _previewPath    = null;        // SVGPathElement — línea de preview
  let _cursorCircle   = null;        // SVGCircleElement — cursor
  let _closeHover     = false;       // true cuando el cursor está cerca del primer vértice

  // Scratch para getCamFastInto (evita 6 trig + alloc por punto por frame)
  const _ovPt   = [0, 0];
  const _ovCam  = { x: 0, y: 0, z: 0 };
  const _ovCamA = { x: 0, y: 0, z: 0 };
  const _ovCamB = { x: 0, y: 0, z: 0 };

  // ─── HELPERS ──────────────────────────────────────────────────────

  function _getOverlay() {
    return document.getElementById('kpk-draw-overlay');
  }

  function _createCircle(r, className) {
    const c = document.createElementNS(SVG_NS, 'circle');
    // CRÍTICO: Radio SOLO via setAttribute, NUNCA en CSS (Lección 1)
    c.setAttribute('r', r);
    c.setAttribute('cx', -9999);
    c.setAttribute('cy', -9999);
    if (className) c.setAttribute('class', className);
    return c;
  }

  function _createPath(className) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', 'M -9999 -9999');
    if (className) p.setAttribute('class', className);
    return p;
  }

  // ─── CONTROL DEL ESTADO ACTIVO ────────────────────────────────────

  /**
   * Inicia un nuevo dibujo activo, limpiando el estado anterior.
   */
  function startDrawing(initialPoints) {
    _activePoints = initialPoints ? [...initialPoints] : [];
    _closeHover   = false;
    _rebuildCircles();
  }

  /**
   * Agrega un punto al dibujo activo.
   * @param {number} pitch
   * @param {number} yaw
   */
  function addPoint(pitch, yaw) {
    _activePoints.push([pitch, yaw]);
    _addCircle(_activePoints.length - 1);
  }

  /**
   * Quita el último punto agregado (undo de vértice).
   */
  function removeLastPoint() {
    if (_activePoints.length === 0) return;
    _activePoints.pop();
    // Eliminar el último círculo del DOM
    const last = _circleEls.pop();
    if (last && last.parentNode) last.remove();
  }

  /**
   * Actualiza la posición del cursor.
   * @param {number} pitch
   * @param {number} yaw
   */
  function setCursor(pitch, yaw) {
    _cursorPitch = pitch;
    _cursorYaw   = yaw;
  }

  /**
   * Limpia completamente el overlay (cancelar dibujo).
   */
  function clearOverlay() {
    const overlay = _getOverlay();
    if (!overlay) return;

    // Eliminar cada elemento individualmente — NUNCA innerHTML (Lección 4)
    _circleEls.forEach(c => { if (c && c.parentNode) c.remove(); });
    _circleEls = [];

    if (_previewPath  && _previewPath.parentNode)  _previewPath.remove();
    if (_cursorCircle && _cursorCircle.parentNode)  _cursorCircle.remove();
    _previewPath  = null;
    _cursorCircle = null;

    _activePoints   = [];
    _cursorPitch    = null;
    _cursorYaw      = null;
    _closeHover     = false;
  }

  /**
   * Retorna si hay un dibujo activo en curso.
   */
  function hasActiveDrawing() {
    return _activePoints.length > 0 || _cursorPitch !== null;
  }

  /**
   * Retorna copia de los puntos activos.
   */
  function getActivePoints() {
    return _activePoints.map(p => [...p]);
  }

  // ─── RECONSTRUCCIÓN DE CÍRCULOS ───────────────────────────────────

  /**
   * Reconstruye todos los círculos desde cero (usado al iniciar).
   */
  function _rebuildCircles() {
    const overlay = _getOverlay();
    if (!overlay) return;

    // Limpiar círculos existentes sin innerHTML (Lección 4)
    _circleEls.forEach(c => { if (c && c.parentNode) c.remove(); });
    _circleEls = [];

    // Recrear uno por punto
    for (let i = 0; i < _activePoints.length; i++) {
      _addCircle(i);
    }

    // Asegurar preview path y cursor circle
    if (!_previewPath) {
      _previewPath = _createPath('path-lote-libre-preview');
      overlay.appendChild(_previewPath);
    }
    if (!_cursorCircle) {
      _cursorCircle = _createCircle(R_CURSOR, 'vertex-circle');
      overlay.appendChild(_cursorCircle);
    }
  }

  /**
   * Agrega un círculo nuevo para el índice dado.
   */
  function _addCircle(index) {
    const overlay = _getOverlay();
    if (!overlay) return;

    // Si falta el preview path o cursor circle, crearlos
    if (!_previewPath) {
      _previewPath = _createPath('path-lote-libre-preview');
      overlay.appendChild(_previewPath);
    }
    if (!_cursorCircle) {
      _cursorCircle = _createCircle(R_CURSOR, 'vertex-circle');
      overlay.appendChild(_cursorCircle);
    }

    const isFirst = index === 0;
    const r       = isFirst ? R_FIRST : R_NORMAL;
    const cls     = isFirst ? 'vertex-circle-first' : 'vertex-circle';
    const circle  = _createCircle(r, cls);

    // Insertar antes del preview path (orden de capas correcto)
    overlay.insertBefore(circle, _previewPath);
    _circleEls[index] = circle;
  }

  // Cache de preview de calle: no recalcular polígono si los puntos no cambiaron
  let _prevPolyKey = '';
  let _cachedPoly = [];

  // ─── RENDER LOOP ─────────────────────────────────────────────────

  /**
   * updateDrawOverlay — Actualizado cada frame por el rAF loop.
   * Solo cuando hasActiveDrawing() es true.
   * Proyecta todos los puntos activos y actualiza cx/cy de cada círculo.
   */
  function updateDrawOverlay() {
    if (!_activePoints.length && _cursorPitch === null) return;

    const proj = window.FerrariCamera.getProjectionParams();

    // ── Actualizar posición de círculos de vértices ───────────────
    for (let i = 0; i < _activePoints.length; i++) {
      const circle = _circleEls[i];
      if (!circle) continue;

      const [pitch, yaw] = _activePoints[i];
      _ovPt[0] = pitch; _ovPt[1] = yaw;
      const cam = window.FerrariCamera.getCamFastInto(_ovPt, _ovCam);

      if (cam.z <= 0.0001) {
        // Detrás de la cámara: mover fuera de pantalla
        circle.setAttribute('cx', -9999);
        circle.setAttribute('cy', -9999);
        continue;
      }

      const ppx = window.FerrariCamera.camToPixel(cam, proj);
      if (!ppx.visible) {
        circle.setAttribute('cx', -9999);
        circle.setAttribute('cy', -9999);
        continue;
      }

      circle.setAttribute('cx', ppx.px.toFixed(2));
      circle.setAttribute('cy', ppx.py.toFixed(2));

      // Hover del primer vértice (cierre de polígono disponible)
      if (i === 0 && _activePoints.length >= 3) {
        const isNear = _isCursorNearFirst(proj);
        if (isNear !== _closeHover) {
          _closeHover = isNear;
          // Animación de escala cross-browser con transform (Lección cross-browser)
          // NUNCA cambiar r aquí — solo setAttribute cuando hay hover visual de r
          // Se usa solo escala CSS
          circle.classList.toggle('vertex-circle-hover', isNear);
        }
      }
    }

    // ── Actualizar cursor circle ──────────────────────────────────
    if (_cursorCircle && _cursorPitch !== null) {
      _ovPt[0] = _cursorPitch; _ovPt[1] = _cursorYaw;
      const cam = window.FerrariCamera.getCamFastInto(_ovPt, _ovCam);
      if (cam.z > 0.0001) {
        const cp = window.FerrariCamera.camToPixel(cam, proj);
        if (cp.visible) {
          _cursorCircle.setAttribute('cx', cp.px.toFixed(2));
          _cursorCircle.setAttribute('cy', cp.py.toFixed(2));
        } else {
          _cursorCircle.setAttribute('cx', -9999);
          _cursorCircle.setAttribute('cy', -9999);
        }
        _cursorCircle.setAttribute('r', R_CURSOR);
      } else {
        _cursorCircle.setAttribute('cx', -9999);
        _cursorCircle.setAttribute('cy', -9999);
      }
    }

    // ── Actualizar línea de preview ───────────────────────────────
    if (_previewPath && _activePoints.length > 0 && _cursorPitch !== null) {
      let d = '';
      
      const activeBtn = document.querySelector('.kpk-tool-btn.active');
      const currentTool = activeBtn ? activeBtn.dataset.tool : null;
      const isCalle = currentTool === 'calle' || currentTool === 'calle-curva-arq2';

      let curPitch, curYaw;
      if (_closeHover && _activePoints.length >= 3) {
        curPitch = _activePoints[0][0];
        curYaw   = _activePoints[0][1];
      } else {
        curPitch = _cursorPitch;
        curYaw   = _cursorYaw;
      }

      if (isCalle && window.FerrariSVGPaths && window.FerrariSVGPaths.calculateStreetPolygon) {
        // Modo Calle: Dibujar polígono 3D con cache
        const pts = [..._activePoints, [curPitch, curYaw]];
        const slider = document.getElementById('calle-width-slider');
        const widthPx = slider ? parseInt(slider.value) : 18;
        
        let viewer = window.Ferrari && window.Ferrari.viewer;
        if (!viewer && window.pannellum) viewer = window.pannellum.viewer();
        const fov = viewer ? viewer.getHfov() : 100;
        const widthDeg = (widthPx / window.innerWidth) * fov;

        const polyKey = pts.map(p => p[0].toFixed(2)+','+p[1].toFixed(2)).join('|') + '|' + widthDeg.toFixed(2);
        if (polyKey !== _prevPolyKey) {
          _prevPolyKey = polyKey;
          _cachedPoly = window.FerrariSVGPaths.calculateStreetPolygon(pts, widthDeg);
        }
        const poly = _cachedPoly;
        for (let j = 0; j < poly.length; j++) {
          const cam = window.FerrariCamera.getCamFastInto(poly[j], _ovCam);
          if (cam.z > 0.0001) {
            const pxl = window.FerrariCamera.camToPixel(cam, proj);
            if (!pxl.visible) continue;
            d += (d === '') ? `M ${pxl.px.toFixed(2)} ${pxl.py.toFixed(2)} ` : `L ${pxl.px.toFixed(2)} ${pxl.py.toFixed(2)} `;
          }
        }
        if (d !== '') d += ' Z';
        
        // Aplicar el estilo final de la calle a la preview
        _previewPath.setAttribute('class', currentTool === 'calle-curva-arq2' ? 'path-calle-curva-arq2' : 'path-calle');
      } else {
        // Modo Lote Libre / Orgánico: Línea 2D conectando puntos
        let hasVisible = false;
        for (let i = 0; i < _activePoints.length; i++) {
          const pt = _activePoints[i];
          const cam = window.FerrariCamera.getCamFastInto(pt, _ovCam);
          if (cam.z > 0.0001) {
            const pxl = window.FerrariCamera.camToPixel(cam, proj);
            if (!pxl.visible) { hasVisible = false; continue; }
            d += (i === 0 || !hasVisible) ? `M ${pxl.px.toFixed(2)} ${pxl.py.toFixed(2)} ` : `L ${pxl.px.toFixed(2)} ${pxl.py.toFixed(2)} `;
            hasVisible = true;
          } else {
            hasVisible = false;
          }
        }
        if (hasVisible) {
          _ovPt[0] = curPitch; _ovPt[1] = curYaw;
          const curCam = window.FerrariCamera.getCamFastInto(_ovPt, _ovCam);
          if (curCam.z > 0.0001) {
            const cp = window.FerrariCamera.camToPixel(curCam, proj);
            if (cp.visible) {
              d += `L ${cp.px.toFixed(2)} ${cp.py.toFixed(2)}`;
            }
          }
        }
        // Aplicar el estilo preview normal
        _previewPath.setAttribute('class', 'path-lote-libre-preview');
      }

      _previewPath.setAttribute('d', d.trim() || 'M -9999 -9999');
    } else if (_previewPath) {
      _previewPath.setAttribute('d', 'M -9999 -9999');
    }
  }

  /**
   * Comprueba si el cursor está cerca del primer vértice (para cierre visual).
   */
  function _isCursorNearFirst(proj) {
    if (_cursorPitch === null || _activePoints.length < 3) return false;

    const firstPt  = _activePoints[0];
    const firstCam = window.FerrariCamera.getCamFastInto(firstPt, _ovCamA);
    _ovPt[0] = _cursorPitch; _ovPt[1] = _cursorYaw;
    const curCam  = window.FerrariCamera.getCamFastInto(_ovPt, _ovCamB);

    if (firstCam.z <= 0.0001 || curCam.z <= 0.0001) return false;

    const fp = window.FerrariCamera.camToPixel(firstCam, proj);
    const cp = window.FerrariCamera.camToPixel(curCam,   proj);

    if (!fp.visible || !cp.visible) return false;

    const dx = fp.px - cp.px;
    const dy = fp.py - cp.py;
    return Math.sqrt(dx * dx + dy * dy) < 18; // threshold 18px
  }

  /**
   * Retorna si el cursor está en zona de cierre (para f-draw-lote).
   */
  function isCloseHover() {
    return _closeHover;
  }

  // ─── API PÚBLICA ────────────────────────────────────────────────────
  window.FerrariOverlay = {
    startDrawing,
    addPoint,
    removeLastPoint,
    setCursor,
    clearOverlay,
    hasActiveDrawing,
    getActivePoints,
    updateDrawOverlay,
    isCloseHover
  };

  console.log('[Ferrari/Overlay] ✓ Módulo inicializado');

})();
