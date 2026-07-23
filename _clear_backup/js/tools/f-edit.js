/**
 * f-edit.js — Herramienta de Edición de Lotes y Calles
 *
 * REGLAS FERRARI:
 * - Arrastre libre por defecto (vértices traseros no se “pegan” a la calle).
 * - Shift: snap magnético a bordes de calle / vértices.
 * - Sin Shift: solo snap suave a vértices de OTROS lotes (fusión), radio chico.
 * - Edición múltiple: mover un vértice compartido mueve todos a la vez.
 * - Performance: no forzar rebuild de polígonos de calle al editar un lote.
 *
 * FIX LAG / PEGADO (2026-07):
 * - Los handles viven en #loteo-svg (hermano de #pannellum-viewer). Con lotes
 *   pointer-events:all, mousemove en el viewer se “comía” y el vértice se pegaba.
 * - Solución: pointer events a nivel document durante el drag + rAF-coalesce.
 * - En modo edit se desactivan pointer-events de lotes (CSS .edit-tool-active).
 */

'use strict';

(function() {

  let _active = false;
  let _bound = false;

  let _dragging = false;
  let _grabbedVertices = []; // Array de { line, pointIdx }
  let _shiftSnap = false;
  let _pointerId = null;

  // Coalesce de redibujado: 1 update visual por frame como máximo
  let _rafPending = false;
  let _needsVisual = false;

  // Radios en px de pantalla
  const SNAP_GRAB = 25;           // radio para agarrar un handle
  const SNAP_VERTEX_FREE = 10;    // fusión lote↔lote sin Shift
  const SNAP_VERTEX_SHIFT = 22;   // con Shift (incluye calles)
  const SNAP_EDGE_SHIFT = 14;     // borde de calle solo con Shift

  function _isCalle(line) {
    return line && (line.tipo === 'calle' || line.tipo === 'calle-curva-arq2');
  }

  function _isLote(line) {
    if (!line) return false;
    const t = line.tipo || '';
    return t.indexOf('lote') === 0 || t === 'franja-grupo' || t === 'franja-curva-grupo' || t === 'kprano-capsule';
  }

  function _markStreetDirty(line) {
    if (_isCalle(line)) line._streetPolyDirty = true;
  }

  function _hostEl() {
    return document.getElementById('panorama-container') ||
           document.getElementById('pannellum-viewer');
  }

  function _setPannellumDraggable(on) {
    try {
      const v = window.Ferrari && window.Ferrari.viewer;
      if (v && typeof v.setDraggable === 'function') v.setDraggable(!!on);
    } catch (e) { /* noop */ }
  }

  function _scheduleVisual() {
    _needsVisual = true;
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(function() {
      _rafPending = false;
      if (!_needsVisual) return;
      _needsVisual = false;
      // Solo data-dirty: la cámara no se mueve al editar vértices.
      // markDirty() de cámara invalidaba el cache y rehacía todo el pipeline.
      if (window.FerrariRAF && window.FerrariRAF.markDataDirty) {
        window.FerrariRAF.markDataDirty();
      }
      // Forzar un processFrame inmediato si el rAF maestro aún no corrió
      if (window.FerrariRAF && window.FerrariRAF.processFrame) {
        window.FerrariRAF.processFrame();
      }
    });
  }

  function _clientToViewer(e) {
    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return null;
    try {
      return viewer.mouseEventToCoords(e);
    } catch (err) {
      return null;
    }
  }

  function _viewerRect() {
    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return null;
    try {
      return viewer.getContainer().getBoundingClientRect();
    } catch (e) {
      const el = document.getElementById('pannellum-viewer');
      return el ? el.getBoundingClientRect() : null;
    }
  }

  // ─── EVENT HANDLERS ──────────────────────────────────────────────────

  function onPointerDown(e) {
    if (!_active) return;
    if (e.button != null && e.button !== 0) return;
    if (e.target && e.target.closest) {
      if (e.target.closest('.kpk-panel') ||
          e.target.closest('#kpk-fab') ||
          e.target.closest('.kpk-toast') ||
          e.target.closest('#kpk-lote-panel') ||
          e.target.closest('#f-geo-editor') ||
          e.target.closest('.kpk-brand-dock') ||
          e.target.closest('.kpk-buyer-dock')) {
        return;
      }
    }

    const host = _hostEl();
    if (host && e.target && !host.contains(e.target) && e.target !== host) {
      // Clic fuera del panorama: no editar
      return;
    }

    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return;

    const lines = window.allDrawnLines;
    if (!lines || lines.length === 0) return;

    const rect = _viewerRect();
    if (!rect) return;

    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Fuera del área del viewer → ignorar
    if (mx < -4 || my < -4 || mx > rect.width + 4 || my > rect.height + 4) return;

    let closestDist = Infinity;
    let closestPitch = null;
    let closestYaw = null;

    // Hit-test con vista fresca (no memo de un frame anterior)
    if (window.FerrariCamera.invalidateViewCache) {
      window.FerrariCamera.invalidateViewCache();
    }
    const proj = window.FerrariCamera.getProjectionParams();
    const grabR2 = SNAP_GRAB * SNAP_GRAB;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.puntos) continue;

      for (let j = 0; j < line.puntos.length; j++) {
        const pt = line.puntos[j];
        const cam = window.FerrariCamera.getCam(pt[0], pt[1]);
        if (cam.z <= 0.0001) continue;

        const screenPt = window.FerrariCamera.camToPixel(cam, proj);
        const dx = screenPt.px - mx;
        const dy = screenPt.py - my;
        const dist2 = dx * dx + dy * dy;

        if (dist2 < closestDist) {
          closestDist = dist2;
          closestPitch = pt[0];
          closestYaw = pt[1];
        }
      }
    }

    _grabbedVertices = [];

    if (closestDist <= grabR2) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.puntos) continue;

        for (let j = 0; j < line.puntos.length; j++) {
          const pt = line.puntos[j];
          if (Math.abs(pt[0] - closestPitch) < 0.00001 && Math.abs(pt[1] - closestYaw) < 0.00001) {
            _grabbedVertices.push({ line: line, pointIdx: j });
          }
        }
      }
    }

    if (_grabbedVertices.length > 0) {
      _dragging = true;
      _shiftSnap = !!e.shiftKey;
      _pointerId = e.pointerId != null ? e.pointerId : null;

      // setPointerCapture en el host: mousemove/up llegan aunque el cursor
      // cruce lotes, handles o salga del canvas.
      try {
        if (_pointerId != null && host && host.setPointerCapture) {
          host.setPointerCapture(_pointerId);
        }
      } catch (err) { /* noop */ }

      _setPannellumDraggable(false);

      e.preventDefault();
      e.stopPropagation();
    }
  }

  function _closestOnSegment(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
    if (l2 === 0) return { x: x1, y: y1 };
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
  }

  function onPointerMove(e) {
    if (!_active || !_dragging || _grabbedVertices.length === 0) return;

    // Si hay pointerId, ignorar otros punteros
    if (_pointerId != null && e.pointerId != null && e.pointerId !== _pointerId) return;

    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return;

    _shiftSnap = !!e.shiftKey;

    const coords = _clientToViewer(e);
    if (!coords || isNaN(coords[0]) || isNaN(coords[1])) return;

    let targetPitch = coords[0];
    let targetYaw = coords[1];

    const rect = _viewerRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let snapDistVertex = Infinity;
    let snapPitchVertex = null;
    let snapYawVertex = null;

    let snapDistEdge = Infinity;
    let snapPitchEdge = null;
    let snapYawEdge = null;

    const proj = window.FerrariCamera.getProjectionParams();
    const lines = window.allDrawnLines;
    const vertexRadius = _shiftSnap ? SNAP_VERTEX_SHIFT : SNAP_VERTEX_FREE;
    const vertexR2 = vertexRadius * vertexRadius;

    const editingOnlyLotes = _grabbedVertices.every(g => _isLote(g.line));
    const grabbedLines = new Set(_grabbedVertices.map(g => g.line));

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.puntos) continue;
      if (grabbedLines.has(line)) continue;
      if (!_shiftSnap && _isCalle(line) && editingOnlyLotes) continue;
      if (!_shiftSnap && _isLote(line) && !editingOnlyLotes) continue;

      for (let j = 0; j < line.puntos.length; j++) {
        const ptv = line.puntos[j];
        const cam = window.FerrariCamera.getCam(ptv[0], ptv[1]);
        if (cam.z <= 0.0001) continue;

        const screenPt = window.FerrariCamera.camToPixel(cam, proj);
        const dx = screenPt.px - mx;
        const dy = screenPt.py - my;
        const dist2 = dx * dx + dy * dy;

        if (dist2 < vertexR2 && dist2 < snapDistVertex) {
          snapDistVertex = dist2;
          snapPitchVertex = ptv[0];
          snapYawVertex = ptv[1];
        }
      }
    }

    // Bordes de calle: SOLO con Shift
    if (_shiftSnap) {
      const edgeR2 = SNAP_EDGE_SHIFT * SNAP_EDGE_SHIFT;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!_isCalle(line) || !line._streetPolygon || line._streetPolygon.length < 2) continue;

        const snapPoints = line._streetPolygon;
        for (let j = 0; j < snapPoints.length; j++) {
          const pt1 = snapPoints[j];
          const pt2 = snapPoints[(j + 1) % snapPoints.length];

          const cam1 = window.FerrariCamera.getCam(pt1[0], pt1[1]);
          const cam2 = window.FerrariCamera.getCam(pt2[0], pt2[1]);
          if (cam1.z <= 0.0001 || cam2.z <= 0.0001) continue;

          const s1 = window.FerrariCamera.camToPixel(cam1, proj);
          const s2 = window.FerrariCamera.camToPixel(cam2, proj);

          const closest = _closestOnSegment(mx, my, s1.px, s1.py, s2.px, s2.py);
          const dx = closest.x - mx;
          const dy = closest.y - my;
          const dist2 = dx * dx + dy * dy;

          if (dist2 < edgeR2 && dist2 < snapDistEdge) {
            snapDistEdge = dist2;
            const res = viewer.mouseEventToCoords({
              clientX: closest.x + rect.left,
              clientY: closest.y + rect.top
            });
            if (res && !isNaN(res[0]) && !isNaN(res[1])) {
              snapPitchEdge = res[0];
              snapYawEdge = res[1];
            }
          }
        }
      }
    }

    // Comparar distancias en espacio al cuadrado (aprox para prioridad)
    if (snapPitchVertex !== null && snapPitchEdge !== null) {
      // 4px de preferencia al vértice ≈ 16 en dist²
      if (snapDistVertex <= snapDistEdge + 16) {
        targetPitch = snapPitchVertex;
        targetYaw = snapYawVertex;
      } else {
        targetPitch = snapPitchEdge;
        targetYaw = snapYawEdge;
      }
    } else if (snapPitchVertex !== null) {
      targetPitch = snapPitchVertex;
      targetYaw = snapYawVertex;
    } else if (snapPitchEdge !== null) {
      targetPitch = snapPitchEdge;
      targetYaw = snapYawEdge;
    }

    for (let i = 0; i < _grabbedVertices.length; i++) {
      const g = _grabbedVertices[i];
      g.line.puntos[g.pointIdx] = [targetPitch, targetYaw];
      // Invalidar pin cacheado en el lote (se recalcula en paths)
      if (g.line.pinPosition) g.line.pinPosition = null;
      if (g.line.pinPos) g.line.pinPos = null;
      g.line._pinCentroid = null;
      _markStreetDirty(g.line);
    }

    _scheduleVisual();
    e.preventDefault();
    e.stopPropagation();
  }

  function onPointerUp(e) {
    if (!_active || !_dragging) return;
    if (_pointerId != null && e.pointerId != null && e.pointerId !== _pointerId) return;

    const host = _hostEl();
    try {
      if (_pointerId != null && host && host.releasePointerCapture) {
        if (host.hasPointerCapture && host.hasPointerCapture(_pointerId)) {
          host.releasePointerCapture(_pointerId);
        }
      }
    } catch (err) { /* noop */ }

    if (window.FerrariStreetNetwork && window.FerrariStreetNetwork.integrateStreet) {
      const seen = new Set();
      for (let i = 0; i < _grabbedVertices.length; i++) {
        const line = _grabbedVertices[i].line;
        if (!line || seen.has(line.id)) continue;
        seen.add(line.id);
        if (_isCalle(line)) {
          line._streetPolyDirty = true;
          window.FerrariStreetNetwork.integrateStreet(line.id);
        }
      }
      if (window.DOMCache) window.DOMCache.version++;
    }

    _dragging = false;
    _grabbedVertices = [];
    _shiftSnap = false;
    _pointerId = null;

    // Restaurar drag de cámara (edit mode sigue activo)
    _setPannellumDraggable(true);

    _scheduleVisual();
    e.stopPropagation();
  }

  function onPointerCancel(e) {
    if (!_dragging) return;
    onPointerUp(e);
  }

  // ─── API DE HERRAMIENTA ──────────────────────────────────────────────

  function bindEvents() {
    if (_bound) return;
    _bound = true;

    // Capture en document: funciona aunque el cursor esté sobre el SVG hermano,
    // handles, o lotes (y sobrevive a setPointerCapture).
    // Pointer Events OR mouse — nunca ambos (doble fire en Chrome/Edge).
    if (window.PointerEvent) {
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('pointermove', onPointerMove, true);
      document.addEventListener('pointerup', onPointerUp, true);
      document.addEventListener('pointercancel', onPointerCancel, true);
    } else {
      document.addEventListener('mousedown', onPointerDown, true);
      document.addEventListener('mousemove', onPointerMove, true);
      document.addEventListener('mouseup', onPointerUp, true);
    }
  }

  function activate() {
    if (window.FerrariTools && window.FerrariTools.deactivateAllTools) {
      window.FerrariTools.deactivateAllTools();
    }
    window.currentTool = 'edit';
    _active = true;
    _dragging = false;
    _grabbedVertices = [];
    _pointerId = null;

    const host = _hostEl();
    if (host) host.classList.add('edit-tool-active');
    document.body.classList.add('edit-tool-active');

    if (window.DOMCache) window.DOMCache.version++;
    if (window.FerrariCamera) window.FerrariCamera.markDirty();
    if (window.FerrariRAF && window.FerrariRAF.markDataDirty) {
      window.FerrariRAF.markDataDirty();
    }

    if (window.FerrariUI && window.FerrariUI.showToast) {
      window.FerrariUI.showToast('Edición: arrastre libre · Shift = pegar a calle', 'info');
    } else if (window.FerrariToast) {
      window.FerrariToast.show('Edición: arrastre libre · Shift = pegar a calle', 'info');
    }
  }

  function deactivate() {
    if (_dragging) {
      _dragging = false;
      _grabbedVertices = [];
      _pointerId = null;
      _setPannellumDraggable(true);
    }

    _active = false;

    const host = _hostEl();
    if (host) host.classList.remove('edit-tool-active');
    document.body.classList.remove('edit-tool-active');

    if (window.DOMCache) window.DOMCache.version++;
    if (window.FerrariCamera) window.FerrariCamera.markDirty();
    if (window.FerrariRAF && window.FerrariRAF.markDataDirty) {
      window.FerrariRAF.markDataDirty();
    }
  }

  function isActive() { return _active; }
  function isDragging() { return _dragging; }

  window.FerrariEdit = {
    bindEvents,
    activate,
    deactivate,
    isActive,
    isDragging
  };

  console.log('[Ferrari/Edit] ✓ Módulo inicializado');

})();
