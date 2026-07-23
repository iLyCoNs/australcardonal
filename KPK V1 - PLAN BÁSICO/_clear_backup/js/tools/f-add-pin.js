/**
 * f-add-pin.js — Herramienta para inyectar un Smart Pin a un lote
 *
 * Hit-test similar a f-eraser.js pero solo aplica para lotes.
 * Click sobre un lote → le asigna hasSmartPin: true y abre el panel.
 */

'use strict';

(function() {

  let _active = false;
  let _bound  = false;
  const HIT_THRESHOLD_PX = 20;

  // ─── ACTIVACIÓN ───────────────────────────────────────────────────

  function activate() {
    window.FerrariTools.deactivateAllTools();

    _active = true;
    document.getElementById('panorama-container').classList.add('pin-active');
    window.FerrariUI && window.FerrariUI.showToast('Pin: clic en el interior de un lote libre para añadir un Smart Pin.', 'info');
    console.log('[Ferrari/AddPin] Activado');
  }

  function deactivate() {
    if (!_active) return;
    _active = false;
    document.getElementById('panorama-container').classList.remove('pin-active');
    console.log('[Ferrari/AddPin] Desactivado');
  }

  function isActive() { return _active; }

  // ─── EVENTOS ──────────────────────────────────────────────────────

  function bindEvents() {
    if (_bound) return;
    _bound = true;

    const container = document.getElementById('pannellum-viewer');
    container.addEventListener('click', _onClick, false);

    console.log('[Ferrari/AddPin] ✓ Eventos registrados');
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
      if (!line.tipo.startsWith('lote') && !line.tipo.startsWith('franja')) continue;

      const dist = _minDistToLine(line.puntos, cursor.px, cursor.py, proj);
      if (dist < bestDist) {
        bestDist = dist;
        bestId   = line.id;
      }
    }

    // Ahora el click principal se maneja desde el SVG nativo en f-svg-sync.js
    // Mantenemos este onClick como fallback por si acaso, pero ampliamos el threshold
    if (bestId && bestDist <= 60) {
      injectPin(bestId);
    } else {
      window.FerrariUI && window.FerrariUI.showToast('Haz clic dentro o en el borde de un lote libre.', 'info');
    }
  }

  // ─── LÓGICA PRINCIPAL ──────────────────────────────────────────────

  function injectPin(id) {
    if (!_active) return;
    
    const line = window.FerrariState.getLine(id);
    if (line && !line.hasSmartPin) {
      // Pin anclado al centroide: sin pinPosition/pinPos manual
      window.FerrariState.updateLine(id, {
        hasSmartPin: true,
        estado: 'disponible',
        pinPosition: null,
        pinPos: null
      });
      
      // Forzar recreación del SVG eliminando el nodo viejo del caché
      if (window.DOMCache && window.DOMCache.paths) {
        const entry = window.DOMCache.paths.get(id);
        if (entry && entry.gNode) entry.gNode.remove();
        window.DOMCache.paths.delete(id);
      }
      if (window.FerrariSVGSync) window.FerrariSVGSync.syncSVGElements();

      window.FerrariCamera.markDirty();
    }
    
    // Desactivamos la herramienta de pin y abrimos el panel
    if (window.FerrariUI && window.FerrariUI.openLotePanel) {
      window.FerrariUI.openLotePanel(id);
    }
  }

  // ─── HIT TEST ────────────────────────────────────────────────────

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
  window.FerrariAddPin = {
    activate,
    deactivate,
    isActive,
    bindEvents,
    injectPin
  };

  console.log('[Ferrari/AddPin] ✓ Módulo inicializado');

})();
