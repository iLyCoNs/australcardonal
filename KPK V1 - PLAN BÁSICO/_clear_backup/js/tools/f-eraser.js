/**
 * f-eraser.js — Herramienta borrador
 *
 * Hit-test por proximidad angular a elementos existentes.
 * Click sobre un elemento → lo elimina de allDrawnLines.
 * El sistema de dirty-flag se encarga de quitarlo del SVG.
 */

'use strict';

(function() {

  let _active = false;
  let _bound  = false;
  const HIT_THRESHOLD_PX = 18; // píxeles de tolerancia para hit-test

  // ─── ACTIVACIÓN ───────────────────────────────────────────────────

  function activate() {
    window.FerrariTools.deactivateAllTools();

    _active = true;
    document.getElementById('panorama-container').classList.add('eraser-active');
    window.FerrariUI && window.FerrariUI.showToast('Borrador: click sobre una línea para eliminarla.', 'info');
    console.log('[Ferrari/Eraser] Activado');
  }

  function deactivate() {
    if (!_active) return;
    _active = false;
    document.getElementById('panorama-container').classList.remove('eraser-active');
    console.log('[Ferrari/Eraser] Desactivado');
  }

  function isActive() { return _active; }

  // ─── EVENTOS ──────────────────────────────────────────────────────

  function bindEvents() {
    if (_bound) return;
    _bound = true;

    const container = document.getElementById('pannellum-viewer');
    container.addEventListener('click',     _onClick,     false);
    container.addEventListener('mousemove', _onMouseMove, false);

    console.log('[Ferrari/Eraser] ✓ Eventos registrados');
  }

  function _onClick(e) {
    if (!_active) return;
    if (e.button !== 0) return;

    const proj   = window.FerrariCamera.getProjectionParams();
    const coords = _getCoords(e);
    if (!coords) return;

    const cam    = window.FerrariCamera.getCam(coords[0], coords[1]);
    if (cam.z <= 0.0001) return;
    const cursor = window.FerrariCamera.camToPixel(cam, proj);

    // Hit-test: encontrar la línea más cercana al click
    let bestId   = null;
    let bestDist = Infinity;

    for (const line of window.allDrawnLines) {
      const dist = _minDistToLine(line.puntos, cursor.px, cursor.py, proj);
      if (dist < bestDist) {
        bestDist = dist;
        bestId   = line.id;
      }
    }

    if (bestId && bestDist <= HIT_THRESHOLD_PX) {
      window.FerrariState.removeLine(bestId);
      window.FerrariUI && window.FerrariUI.showToast('Elemento eliminado.', 'success');
      console.log('[Ferrari/Eraser] Eliminado:', bestId);
    } else {
      window.FerrariUI && window.FerrariUI.showToast('No se encontró ningún elemento en esa zona.', 'info');
    }
  }

  function _onMouseMove(e) {
    if (!_active) return;
    // Highlight hover — resaltar visualmente el elemento más cercano
    // (funcionalidad opcional: solo cambia cursor)
  }

  // ─── HIT TEST ────────────────────────────────────────────────────

  /**
   * Distancia mínima en píxeles desde el punto (cx, cy) a los
   * segmentos proyectados de una línea.
   */
  function _minDistToLine(puntos, cx, cy, proj) {
    if (!puntos || puntos.length === 0) return Infinity;

    let minDist = Infinity;

    for (let i = 0; i < puntos.length; i++) {
      const cam = window.FerrariCamera.getCam(puntos[i][0], puntos[i][1]);
      if (cam.z <= 0.0001) continue;
      const { px, py } = window.FerrariCamera.camToPixel(cam, proj);

      // Distancia al vértice
      const dv = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      if (dv < minDist) minDist = dv;

      // Distancia al segmento (i → i+1)
      if (i < puntos.length - 1) {
        const cam2 = window.FerrariCamera.getCam(puntos[i+1][0], puntos[i+1][1]);
        if (cam2.z <= 0.0001) continue;
        const p2 = window.FerrariCamera.camToPixel(cam2, proj);
        const ds = _distToSegment(cx, cy, px, py, p2.px, p2.py);
        if (ds < minDist) minDist = ds;
      }
    }

    return minDist;
  }

  /**
   * Distancia de punto (px, py) al segmento (ax,ay)–(bx,by).
   */
  function _distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);

    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const nx = ax + t * dx;
    const ny = ay + t * dy;
    return Math.sqrt((px - nx) ** 2 + (py - ny) ** 2);
  }

  function _getCoords(e) {
    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return null;
    try {
      return viewer.mouseEventToCoords(e);
    } catch(err) {
      return null;
    }
  }

  // ─── API PÚBLICA ────────────────────────────────────────────────────
  window.FerrariEraser = {
    activate,
    deactivate,
    isActive,
    bindEvents
  };

  console.log('[Ferrari/Eraser] ✓ Módulo inicializado');

})();
