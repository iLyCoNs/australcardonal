/**
 * f-svg-paths.js — Actualización de paths SVG con proyección gnomónica
 *
 * REGLAS:
 * - SIEMPRE verificar cam.z > 0.0001 antes de proyectar (Lección 7)
 * - Puntos fuera de pantalla → d="M -9999 -9999" (NO display:none — Lección 6)
 * - Solo se llama desde el rAF loop cuando la cámara está dirty
 * - Usa DOMCache.paths para O(1) lookup por lineId (NUNCA querySelectorAll)
 */

'use strict';

(function() {

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ─── CACHES DE RENDIMIENTO (60 FPS) ─────────────────────────────────
  // Refs DOM estáticas: getElementById cada frame es evitable.
  let _elUnion    = null;
  let _elShared   = null;
  let _elUnshared = null;
  let _elHover    = null;
  let _elHandles  = null;
  let _hoveredLoteId = null;
  let _lastHoverD = '';
  let _lastPointerG = null;
  let _hoverBound = false;
  let _hoverRaf = 0;
  let _hoverMx = 0;
  let _hoverMy = 0;
  const _hoverCam = { x: 0, y: 0, z: 0 };
  const _hoverScreen = []; // reuse [[x,y], ...]
  // Scratch para conteo de segmentos sin regex por frame.
  const _segScratch = { seg: 0 };
  // Últimos valores aplicados (evita re-escribir atributos idénticos).
  let _lastBorderStroke = -1;
  let _lastBorderDash   = '';
  // Arrays reutilizados de partes de path (cero alocación por frame).
  const _unionParts     = [];
  const _sharedParts    = [];
  const _unsharedParts  = [];
  // Vectores de cámara scratch (reused): getCamFastInto escribe aquí.
  // 2 scratches para bordes (necesita cam1+cam2 simultáneos).
  const _camA = { x: 0, y: 0, z: 0 };
  const _camB = { x: 0, y: 0, z: 0 };
  // Scratch extra para _buildFallbackStreetPolyD (evita colisionar con _camA/_camB
  // que están en uso durante updateSVGPaths).
  const _camC = { x: 0, y: 0, z: 0 };
  // Reuso permanentes para edit handles (Set + array de posiciones).
  const _handleSet = new Set();
  const _handlePos = [];

  /**
   * Genera el atributo "d" de un path SVG a partir de puntos proyectados.
   * Si ningún punto es visible → retorna "M -9999 -9999".
   *
   * @param {Array} puntos  — [[pitch, yaw], ...]
   * @param {Object} proj   — resultado de getProjectionParams()
   * @param {boolean} close — cerrar el path (Z) para polígonos
   * @param {Object} [outSeg] — si se pasa, recibe { seg } = nº de comandos M/L
   *                            emitidos (evita regex .match() por frame)
   * @returns {string} valor del atributo d
   */
  function _buildPathD(puntos, proj, close, outSeg) {
    if (outSeg) outSeg.seg = 0;
    if (!puntos || puntos.length === 0) return 'M -9999 -9999';

    const FCam = window.FerrariCamera;

    // Fast path (polígonos cerrados): sin breaks posibles → string directo,
    // cero objetos intermedios (lotes + polígonos de calle = hot path 60fps).
    if (close) {
      let d = '';
      let count = 0;
      for (let i = 0; i < puntos.length; i++) {
        const pt = puntos[i];
        const cam = FCam.getCamFastInto(pt, _camA);
        if (cam.z <= 0.0001) continue;
        const pp = FCam.camToPixel(cam, proj);
        if (!pp.visible) continue;
        d += (count === 0 ? 'M ' : 'L ') + pp.px.toFixed(2) + ' ' + pp.py.toFixed(2) + ' ';
        count++;
      }
      if (count === 0) return 'M -9999 -9999';
      if (outSeg) outSeg.seg = count;
      return d + 'Z';
    }

    // Path abierto (ejes de calle): soporta breaks cuando un punto queda
    // detrás de cámara o fuera de margen — cada tramo inicia con M.
    let d = '';
    let hasVisible = false;
    let segCount = 0;
    let needMove = true;

    for (let i = 0; i < puntos.length; i++) {
      const pt = puntos[i];
      const cam = FCam.getCamFastInto(pt, _camA);

      if (cam.z <= 0.0001) { needMove = true; continue; }
      const pp = FCam.camToPixel(cam, proj);
      if (!pp.visible) { needMove = true; continue; }

      hasVisible = true;
      if (needMove) {
        d += 'M ' + pp.px.toFixed(2) + ' ' + pp.py.toFixed(2) + ' ';
        needMove = false;
      } else {
        d += 'L ' + pp.px.toFixed(2) + ' ' + pp.py.toFixed(2) + ' ';
      }
      segCount++;
    }

    if (!hasVisible) return 'M -9999 -9999';
    if (outSeg) outSeg.seg = segCount;
    return d.trim();
  }

  /**
   * Actualiza la capa de puntos de edición.
   * POOL de <circle>: reutiliza nodos y solo muta cx/cy.
   * Antes usaba layer.innerHTML = ... cada frame → lag severo y GC thrash
   * al arrastrar vértices (destroy/create de decenas de nodos @ 60fps).
   */
  function _updateEditHandles(proj) {
    if (!_elHandles) _elHandles = document.getElementById('layer-edit-handles');
    const layer = _elHandles;
    if (!layer) return;

    if (window.currentTool !== 'edit') {
      // Vaciar pool solo al salir del modo edit (no cada frame)
      if (layer.childNodes.length) {
        while (layer.firstChild) layer.removeChild(layer.firstChild);
      }
      return;
    }

    const lines = window.allDrawnLines;
    const FCam = window.FerrariCamera;
    _handleSet.clear();
    _handlePos.length = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.puntos === undefined) continue;

      for (let j = 0; j < line.puntos.length; j++) {
        const pt = line.puntos[j];
        const cam = FCam.getCamFastInto(pt, _camA);
        if (cam.z <= 0.0001) continue;

        const pp = FCam.camToPixel(cam, proj, 3);
        // Excluir handles que estén claramente fuera del viewport para evitar saturar el DOM con nodos <circle> invisibles
        if (pp.px < -20 || pp.px > proj.w + 20 || pp.py < -20 || pp.py > proj.h + 20) continue;

        // Dedupe a 1 decimal (vértices compartidos en el mismo pixel)
        const key = (pp.px * 10 | 0) + ',' + (pp.py * 10 | 0);
        if (_handleSet.has(key)) continue;
        _handleSet.add(key);

        _handlePos.push(pp.px, pp.py);
      }
    }

    const positions = _handlePos;
    const need = positions.length / 2;
    let nodes = layer.childNodes;

    // Mobile: stroke-width del handle escala con FOV (1px a 120°, 2px a zoom alto)
    const isMobileSW = window.innerWidth < 768;
    const baseF_sw = 0.5 * proj.w;
    const scaleFactorSw = proj.f / baseF_sw;
    const handleStroke = isMobileSW ? Math.max(1, Math.min(2, (scaleFactorSw - 0.577) * 0.317 + 1)).toFixed(1) : '2';

    // Crear círculos faltantes
    while (nodes.length < need) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('r', '6');
      c.setAttribute('fill', '#fff');
      c.setAttribute('stroke', '#ff0044');
      c.setAttribute('stroke-width', handleStroke);
      c.setAttribute('class', 'edit-handle');
      layer.appendChild(c);
      nodes = layer.childNodes;
    }

    // Actualizar posiciones de los activos
    for (let i = 0; i < need; i++) {
      const c = nodes[i];
      const px = positions[i * 2];
      const py = positions[i * 2 + 1];
      // setAttribute es más barato que recrear el nodo
      c.setAttribute('cx', px.toFixed(1));
      c.setAttribute('cy', py.toFixed(1));
      c.setAttribute('stroke-width', handleStroke);
      if (c.style.display === 'none') c.style.display = '';
    }

    // Ocultar sobrantes (no remove → evita churn de layout)
    for (let i = need; i < nodes.length; i++) {
      const c = nodes[i];
      if (c.style.display !== 'none') c.style.display = 'none';
    }
  }

  /**
   * Actualiza la capa de bordes globales (costuras compartidas y bordes libres).
   * Los bordes compartidos se dibujan punteados y los libres como neón sólido.
   */
  // ─── CACHE DE CLASIFICACIÓN DE ARISTAS (solo cambia con geometría, no con cámara) ──
  let _edgeCacheVersion = -1;
  let _edgeCacheArray   = [];  // [{ p1: [pitch,yaw], p2: [pitch,yaw], shared: boolean }]
  let _edgeCacheCount   = 0;

  function _rebuildEdgeCache() {
    const lines = window.allDrawnLines;
    const edgeCounts = {};
    const edgesArray = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.puntos || line.puntos.length < 2) continue;
      const isLote = (line.tipo === 'lote-libre' || line.tipo === 'lote-organico' || line.tipo === 'franja-grupo');
      if (!isLote) continue;

      const n = line.puntos.length;
      for (let j = 0; j < n; j++) {
        const p1 = line.puntos[j];
        const p2 = line.puntos[(j + 1) % n];
        const k1 = p1[0].toFixed(4) + ',' + p1[1].toFixed(4);
        const k2 = p2[0].toFixed(4) + ',' + p2[1].toFixed(4);
        const edgeKey = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
        if (!edgeCounts[edgeKey]) {
          edgeCounts[edgeKey] = 1;
          edgesArray.push({ p1: p1, p2: p2, key: edgeKey });
        } else {
          edgeCounts[edgeKey]++;
        }
      }
    }

    _edgeCacheArray = [];
    _edgeCacheCount = edgesArray.length;
    for (let i = 0; i < edgesArray.length; i++) {
      const e = edgesArray[i];
      _edgeCacheArray.push({ p1: e.p1, p2: e.p2, shared: edgeCounts[e.key] > 1 });
    }
    _edgeCacheVersion = window.DOMCache ? window.DOMCache.version : 0;
  }

  function _updateBorders(proj) {
    if (!_elShared || !_elUnshared) {
      _elShared   = document.getElementById('shared-edges-path');
      _elUnshared = document.getElementById('unshared-edges-path');
      if (!_elShared || !_elUnshared) return;
    }
    if (!_elHover) _elHover = document.getElementById('hover-lote-edges-path');

    const currentVersion = window.DOMCache ? window.DOMCache.version : 0;
    if (currentVersion !== _edgeCacheVersion) {
      _rebuildEdgeCache();
    }

    const FCam = window.FerrariCamera;
    _sharedParts.length = 0;
    _unsharedParts.length = 0;

    for (let i = 0; i < _edgeCacheCount; i++) {
      const e = _edgeCacheArray[i];
      const cam1 = FCam.getCamFastInto(e.p1, _camA);
      const cam2 = FCam.getCamFastInto(e.p2, _camB);

      if (cam1.z > 0.0001 && cam2.z > 0.0001) {
        const pt1 = FCam.camToPixel(cam1, proj);
        const pt2 = FCam.camToPixel(cam2, proj);
        if (!pt1.visible || !pt2.visible) continue;
        const lineStr = 'M ' + pt1.px.toFixed(2) + ' ' + pt1.py.toFixed(2) + ' L ' + pt2.px.toFixed(2) + ' ' + pt2.py.toFixed(2);

        if (e.shared) {
          _sharedParts.push(lineStr);
        } else {
          _unsharedParts.push(lineStr);
        }
      }
    }

    const dShared    = _sharedParts.length   ? _sharedParts.join(' ')   : 'M -9999 -9999';
    const dUnshared  = _unsharedParts.length ? _unsharedParts.join(' ') : 'M -9999 -9999';
    if (_elShared.getAttribute('d')   !== dShared)   _elShared.setAttribute('d', dShared);
    if (_elUnshared.getAttribute('d') !== dUnshared) _elUnshared.setAttribute('d', dUnshared);

    const baseF = 0.5 * proj.w;
    const scaleFactor = proj.f / baseF;
    const strokeW = Math.max(0.3, scaleFactor * 1.5);

    // Solo escribir atributos cuando el valor cambia (pan a fov fijo = constante)
    if (strokeW !== _lastBorderStroke) {
      _lastBorderStroke = strokeW;
      _elShared.style.strokeWidth = strokeW + 'px';
      _elUnshared.style.strokeWidth = strokeW + 'px';
    }

    const dashScale = Math.max(0.4, Math.min(2.5, scaleFactor));
    const dashBase = Math.round(8 * dashScale);
    const gapBase = Math.round(6 * dashScale);
    const dashStr = dashBase + ' ' + gapBase;
    if (dashStr !== _lastBorderDash) {
      _lastBorderDash = dashStr;
      _elShared.setAttribute('stroke-dasharray', dashStr);
    }

    _updateHoverEdges(proj, scaleFactor);
  }

  function _updateHoverEdges(proj, scaleFactor) {
    if (!_elHover) return;
    const FCam = window.FerrariCamera;
    let dHover = 'M -9999 -9999';

    if (_hoveredLoteId) {
      const lines = window.allDrawnLines;
      let line = null;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].id === _hoveredLoteId) { line = lines[i]; break; }
      }
      if (line && line.puntos && line.puntos.length >= 2) {
        const parts = [];
        const n = line.puntos.length;
        const closed = (
          line.tipo === 'lote-libre' ||
          line.tipo === 'lote-organico' ||
          line.tipo === 'franja-grupo' ||
          line.tipo === 'kprano-capsule'
        );
        const edgeCount = closed ? n : n - 1;
        for (let j = 0; j < edgeCount; j++) {
          const p1 = line.puntos[j];
          const p2 = line.puntos[(j + 1) % n];
          const cam1 = FCam.getCamFastInto(p1, _camA);
          const cam2 = FCam.getCamFastInto(p2, _camB);
          if (cam1.z <= 0.0001 || cam2.z <= 0.0001) continue;
          const pt1 = FCam.camToPixel(cam1, proj);
          const pt2 = FCam.camToPixel(cam2, proj);
          if (!pt1.visible || !pt2.visible) continue;
          parts.push('M ' + pt1.px.toFixed(2) + ' ' + pt1.py.toFixed(2) + ' L ' + pt2.px.toFixed(2) + ' ' + pt2.py.toFixed(2));
        }
        if (parts.length) dHover = parts.join(' ');
      }
    }

    if (dHover !== _lastHoverD) {
      _lastHoverD = dHover;
      _elHover.setAttribute('d', dHover);
    }

    const hoverW = Math.max(1.2, (scaleFactor || 1) * 2.4);
    _elHover.style.strokeWidth = hoverW + 'px';
    _elHover.classList.toggle('is-active', !!_hoveredLoteId && dHover !== 'M -9999 -9999');
  }

  function setHoveredLote(id) {
    const next = id || null;
    if (_hoveredLoteId === next) {
      // Aun si es el mismo id, refrescar edges al mover cámara
      return;
    }
    _hoveredLoteId = next;

    // Clase visual en el <g> del lote
    if (_lastPointerG) {
      _lastPointerG.classList.remove('is-pointer');
      _lastPointerG = null;
    }
    if (next && window.DOMCache && window.DOMCache.paths) {
      const entry = window.DOMCache.paths.get(next);
      if (entry && entry.gNode) {
        entry.gNode.classList.add('is-pointer');
        _lastPointerG = entry.gNode;
      }
    }

    try {
      if (!_elHover) _elHover = document.getElementById('hover-lote-edges-path');
      const FCam = window.FerrariCamera;
      if (FCam && FCam.getProjectionParams) {
        const proj = FCam.getProjectionParams();
        const baseF = 0.5 * proj.w;
        const scaleFactor = proj.f / baseF;
        _updateHoverEdges(proj, scaleFactor);
      }
    } catch (e) { /* ok */ }
  }

  function _pointInPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1];
      const xj = pts[j][0], yj = pts[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function _clientToSvg(clientX, clientY) {
    const svg = document.getElementById('loteo-svg');
    if (!svg) return null;
    try {
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const local = pt.matrixTransform(ctm.inverse());
      return { x: local.x, y: local.y };
    } catch (e) {
      const rect = svg.getBoundingClientRect();
      const vb = svg.viewBox && svg.viewBox.baseVal;
      if (!vb || !rect.width || !rect.height) {
        return { x: clientX - rect.left, y: clientY - rect.top };
      }
      return {
        x: (clientX - rect.left) * (vb.width / rect.width),
        y: (clientY - rect.top) * (vb.height / rect.height)
      };
    }
  }

  function _isLoteHoverable(line) {
    if (!line || !line.puntos || line.puntos.length < 3) return false;
    const t = line.tipo;
    return t === 'lote-libre' || t === 'lote-organico' || t === 'franja-grupo' || t === 'kprano-capsule';
  }

  function _hitTestLoteAt(clientX, clientY) {
    if (document.body.classList.contains('edit-tool-active')) return null;
    const pan = document.getElementById('panorama-container');
    if (pan && pan.classList.contains('drawing-active')) return null;

    const local = _clientToSvg(clientX, clientY);
    if (!local) return null;

    const FCam = window.FerrariCamera;
    if (!FCam || !FCam.getProjectionParams) return null;
    const proj = FCam.getProjectionParams();
    const lines = window.allDrawnLines;
    if (!lines || !lines.length) return null;

    // Recorrer de atrás hacia adelante (último dibujado = encima)
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!_isLoteHoverable(line)) continue;

      _hoverScreen.length = 0;
      let visible = 0;
      for (let k = 0; k < line.puntos.length; k++) {
        const cam = FCam.getCamFastInto(line.puntos[k], _hoverCam);
        if (cam.z <= 0.0001) continue;
        const pt = FCam.camToPixel(cam, proj);
        if (!pt.visible) continue;
        _hoverScreen.push([pt.px, pt.py]);
        visible++;
      }
      if (visible < 3) continue;
      if (_pointInPoly(local.x, local.y, _hoverScreen)) {
        return line.id;
      }
    }
    return null;
  }

  function _onHoverPointerMove(e) {
    _hoverMx = e.clientX;
    _hoverMy = e.clientY;
    if (_hoverRaf) return;
    _hoverRaf = requestAnimationFrame(() => {
      _hoverRaf = 0;
      const id = _hitTestLoteAt(_hoverMx, _hoverMy);
      setHoveredLote(id);
    });
  }

  function _onHoverPointerLeave() {
    setHoveredLote(null);
  }

  function bindHoverTracking() {
    if (_hoverBound) return;
    const host = document.getElementById('panorama-container');
    if (!host) return;
    _hoverBound = true;
    host.addEventListener('pointermove', _onHoverPointerMove, { passive: true });
    host.addEventListener('pointerleave', _onHoverPointerLeave, { passive: true });
  }

  // Auto-bind cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindHoverTracking);
  } else {
    bindHoverTracking();
  }

  /**
   * updateSVGPaths — Recalcula y actualiza todos los paths del DOMCache.
   * Llamado solo cuando la cámara está dirty (desde f-raf-loop.js).
   */
  function updateSVGPaths() {
    const lines = window.allDrawnLines;
    const cache = window.DOMCache.paths;
    const FCam  = window.FerrariCamera;
    const proj  = FCam.getProjectionParams();

    // Asfalto unificado: un solo path con subpaths → un cuerpo sin huecos en cruces
    _unionParts.length = 0;

    const D_EMPTY = 'M -9999 -9999';

    for (const line of lines) {
      const entry = cache.get(line.id);
      if (!entry) continue;

      const path = entry.pathEls[0];
      if (!path) continue;

      const isClosed = (
        line.tipo === 'lote-libre'         ||
        line.tipo === 'lote-organico'      ||
        line.tipo === 'franja-grupo'       ||
        line.tipo === 'franja-curva-grupo' ||
        line.tipo === 'kprano-capsule'
      );

      const isCalleType = (line.tipo === 'calle' || line.tipo === 'calle-curva-arq2');

      // ── Culling: si el centroide está muy lejos del viewport, saltar
      //    todo el cómputo pesado (trigonometría + string + DOM).
      //    Para lotes (closed) → culling normal por centroide.
      //    Para calles (open, largas) → quick-check cheap: si al menos 1
      //       punto del eje central está frente a la cámara, no skip.
      //       (El centroide de una calle larga puede estar fuera del
      //        viewport aunque tramos visibles crucen la pantalla.)
      let repPt = (line._pinCentroid && line._pinCentroid.length === 2)
        ? line._pinCentroid
        : null;
      if (!repPt && line.puntos && line.puntos.length > 0) {
        let sx = 0, sy = 0, sz = 0;
        for (let i = 0; i < line.puntos.length; i++) {
          const pr = line.puntos[i][0] * Math.PI / 180;
          const yr = line.puntos[i][1] * Math.PI / 180;
          sx += Math.cos(pr) * Math.sin(yr);
          sy += Math.sin(pr);
          sz += Math.cos(pr) * Math.cos(yr);
        }
        const len = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
        const centerPitch = Math.asin(Math.max(-1, Math.min(1, sy / len))) * 180 / Math.PI;
        const centerYaw   = Math.atan2(sx / len, sz / len) * 180 / Math.PI;
        repPt = [centerPitch, centerYaw];
        line._pinCentroid = repPt;
      }
      let skipHeavy = false;
      if (repPt) {
        // repPt = line._pinCentroid ([pitch,yaw]) o array generado; getCamFastInto
        // cachea por array (seguro: _pinCentroid se invalida al cambiar geometría).
        const cc = FCam.getCamFastInto(repPt, _camA);
        if (cc.z <= 0.0001) {
          if (isCalleType && line.puntos && line.puntos.length >= 2) {
            let anyFront = false;
            for (let k = 0; k < line.puntos.length; k += Math.max(1, Math.floor(line.puntos.length / 6))) {
              const tc = FCam.getCamFastInto(line.puntos[k], _camB);
              if (tc.z > 0.0001) {
                const tpx = proj.cx + (tc.x / tc.z) * proj.f;
                const tpy = proj.cy - (tc.y / tc.z) * proj.f;
                const tM = Math.max(proj.w, proj.h) * 2.5;
                if (tpx > -tM && tpx < proj.w + tM && tpy > -tM && tpy < proj.h + tM) { anyFront = true; break; }
              }
            }
            skipHeavy = !anyFront;
          } else skipHeavy = true;
        } else {
          const cpx = proj.cx + (cc.x / cc.z) * proj.f;
          const cpy = proj.cy - (cc.y / cc.z) * proj.f;
          // Escalamos el límite de culling con el nivel de zoom (scaleFactor) para que el descarte
          // se mantenga estable en espacio angular y los lotes no desaparezcan (pop out) al hacer zoom.
          const scaleFactor = proj.f / (0.5 * proj.w);
          const cullFactor = window.FerrariDevice && window.FerrariDevice.getTier() === 'low' ? 1.2 : 2;
          const cullM = Math.max(proj.w, proj.h) * cullFactor * Math.max(1, scaleFactor);
          if (cpx < -cullM || cpx > proj.w + cullM || cpy < -cullM || cpy > proj.h + cullM) {
            if (isCalleType && line.puntos && line.puntos.length >= 2) {
              let anyNear = false;
              for (let k = 0; k < line.puntos.length; k += Math.max(1, Math.floor(line.puntos.length / 6))) {
                const tc = FCam.getCamFastInto(line.puntos[k], _camB);
                if (tc.z > 0.0001) {
                  const tpx = proj.cx + (tc.x / tc.z) * proj.f;
                  const tpy = proj.cy - (tc.y / tc.z) * proj.f;
                  const tMext = Math.max(proj.w, proj.h) * 2.5;
                  if (tpx > -tMext && tpx < proj.w + tMext && tpy > -tMext && tpy < proj.h + tMext) { anyNear = true; break; }
                }
              }
              skipHeavy = !anyNear;
            } else skipHeavy = true;
          }
        }
      }
      if (skipHeavy) {
        path.setAttribute('d', D_EMPTY);
        if (entry.pathEls[1]) entry.pathEls[1].setAttribute('d', D_EMPTY);
        if (entry.pathEls[2]) entry.pathEls[2].setAttribute('d', D_EMPTY);
        if (entry.pinGroup) entry.pinGroup.style.display = 'none';
        continue;
      }

      let d = '';

      if (isCalleType) {
        const alpha = line.anchoAngular || 1.0;
        // Cache: no regenerar el polígono 3D si la geometría de la calle no cambió.
        // (Editar un lote no debe recalcular asfalto → evita lag en vértices traseros.)
        if (!line._streetPolygon || line._streetPolyDirty) {
          line._streetPolygon = _createStreetPolygon(line.puntos, alpha);
          line._streetPolyDirty = false;
          line._pinCentroid = null; // invalidar centroide al cambiar geometría
        }
        const polyPoints = line._streetPolygon;

        d = _buildPathD(polyPoints, proj, true, _segScratch);
        const polySegCnt = _segScratch.seg;

        const strokePx = 2 * proj.f * Math.tan((alpha / 2) * Math.PI / 180);

        // Ocultar fill individual — todo el cuerpo vive en #calles-asfalto-union
        // unificado. Se aplica UNA vez por entrada (no cada frame).
        if (!entry._calleFlat) {
          entry._calleFlat = true;
          path.style.filter = 'none';
          path.style.fill = '';
          path.style.stroke = '';
          path.style.strokeWidth = '';
          path.setAttribute('d', D_EMPTY);
        }

        const dCenter = _buildPathD(line.puntos, proj, false, _segScratch);
        const cSegCnt = _segScratch.seg;

        if (polySegCnt >= 4) {
          // Polígono 3D completo → añadir al cuerpo unificado
          _unionParts.push(d);
        } else if (cSegCnt >= 2) {
          // Eje central visible pero polígono 3D colapsado → construir
          // polígono mínimo desde el eje y añadir al cuerpo unificado
          const fallbackPoly = _buildFallbackStreetPolyD(
            line.puntos, alpha, D_EMPTY, proj,
            FCam, window.FerrariSVGPaths
          );
          if (fallbackPoly) _unionParts.push(fallbackPoly);
        }

        const centerStroke = strokePx * 0.08;
        const dash1        = strokePx * 0.8;
        const dash2        = strokePx * 0.5;

        if (entry.pathEls[1]) {
          if (cSegCnt >= 2) {
            entry.pathEls[1].setAttribute('d', dCenter);
            if (entry._lastCenterStroke !== centerStroke) {
              entry._lastCenterStroke = centerStroke;
              entry.pathEls[1].style.strokeWidth = centerStroke;
            }
            const dashStr = dash1 + ' ' + dash2;
            if (entry._lastCenterDash !== dashStr) {
              entry._lastCenterDash = dashStr;
              entry.pathEls[1].setAttribute('stroke-dasharray', dashStr);
            }
          } else {
            entry.pathEls[1].setAttribute('d', D_EMPTY);
          }
        }
      } else {
        d = _buildPathD(line.puntos, proj, isClosed);
        // Solo escribir d si cambió respecto del frame anterior (pan sutil = constante)
        if (entry._lastD !== d) {
          entry._lastD = d;
          path.setAttribute('d', d);
          if (entry.pathEls[1]) entry.pathEls[1].setAttribute('d', d);
          if (entry.pathEls[2]) entry.pathEls[2].setAttribute('d', d);
        }
      }
      
      // Sincronizar clases de estado solo cuando cambian (no cada frame)
      if (entry.gNode) {
        const estado = line.hasSmartPin ? (line.estado || 'disponible') : null;
        if (entry._lastEstado !== estado) {
          entry._lastEstado = estado;
          const cl = entry.gNode.classList;
          // Quitar status-* previos
          for (let ci = cl.length - 1; ci >= 0; ci--) {
            const c = cl[ci];
            if (c.indexOf('status-') === 0) cl.remove(c);
          }
          if (estado) cl.add('status-' + estado);
        }
      }
      // Smart Pins → ahora en HTML overlay (f-smart-pins.js).
      // Sin código aquí: cero operaciones DOM SVG por pin por frame.
    }



    // Path único de asfalto (todas las calles = un cuerpo con intersecciones)
    if (!_elUnion) {
      _elUnion = document.getElementById('calles-asfalto-union');
      if (!_elUnion) {
        const layer = document.getElementById('layer-calles-asfalto');
        if (layer) {
          _elUnion = document.createElementNS(SVG_NS, 'path');
          _elUnion.id = 'calles-asfalto-union';
          _elUnion.setAttribute('class', 'path-calle-union');
          layer.insertBefore(_elUnion, layer.firstChild);
        }
      }
    }
    if (_elUnion) {
      const dUnion = _unionParts.length ? _unionParts.join(' ') : D_EMPTY;
      if (_elUnion.getAttribute('d') !== dUnion) {
        _elUnion.setAttribute('d', dUnion);
      }
    }

    _updateBorders(proj);
    _updateEditHandles(proj);
  }

  // ─── 3D POLYGON HELPER ──────────────────────────────────────────────

  /**
   * Construye un polígono de calle mínimo para fallback cuando el polígono
   * 3D completo está colapsado pero el eje central tiene ≥ 2 puntos visibles.
   * Proyecta segmentos visibles del eje central → genera left/right y devuelve
   * el string d para el unionD unificado.
   * @returns {string|null} d string o null si no hay nada que dibujar
   */
  function _buildFallbackStreetPolyD(puntos, alphaDeg, D_EMPTY, proj, FerrariCamera, FerrariSVGPaths) {
    if (!puntos || puntos.length < 2) return null;
    const radiusDeg = alphaDeg / 2;
    const radiusRad = radiusDeg * Math.PI / 180;
    let outD = '';
    let lastPx = 0, lastPy = 0;
    let hasPrev = false;

    for (let i = 0; i < puntos.length; i++) {
      const cam = FerrariCamera.getCamFastInto(puntos[i], _camC);
      if (cam.z <= 0.0001) { hasPrev = false; continue; }
      const pp = FerrariCamera.camToPixel(cam, proj);
      if (!pp.visible) { hasPrev = false; continue; }
      const strokePx = 2 * proj.f * Math.tan(radiusRad);
      const half = strokePx / 2;

      if (!hasPrev) {
        // Punto aislado: círculo pequeño (M + L en 4 vértices)
        outD += ' M ' + (pp.px - half).toFixed(1) + ' ' + (pp.py - half).toFixed(1);
        outD += ' L ' + (pp.px + half).toFixed(1) + ' ' + (pp.py - half).toFixed(1);
        outD += ' L ' + (pp.px + half).toFixed(1) + ' ' + (pp.py + half).toFixed(1);
        outD += ' L ' + (pp.px - half).toFixed(1) + ' ' + (pp.py + half).toFixed(1);
        outD += ' Z';
        lastPx = pp.px; lastPy = pp.py;
        hasPrev = true;
      } else {
        // Segmento: rectángulo entre lastPx,lastPy → pp.px,pp.py + ancho
        const dx = pp.px - lastPx, dy = pp.py - lastPy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = -dy / len, uy = dx / len;
        const ox = ux * half, oy = uy * half;
        outD += ' M ' + (lastPx - ox).toFixed(1) + ' ' + (lastPy - oy).toFixed(1);
        outD += ' L ' + (pp.px - ox).toFixed(1) + ' ' + (pp.py - oy).toFixed(1);
        outD += ' L ' + (pp.px + ox).toFixed(1) + ' ' + (pp.py + oy).toFixed(1);
        outD += ' L ' + (lastPx + ox).toFixed(1) + ' ' + (lastPy + oy).toFixed(1);
        outD += ' Z';
        lastPx = pp.px; lastPy = pp.py;
      }
    }
    return outD || null;
  }

  function _createStreetPolygon(puntos, alphaDeg) {
    if (puntos.length < 2) return [];

    const W = (alphaDeg * Math.PI / 180) / 2; // mitad del ancho en radianes
    const lefts = [];
    const rights = [];

    // Helper: pitch/yaw a Cartesiano
    function toCartesian(p, y) {
      const pr = p * Math.PI / 180;
      const yr = y * Math.PI / 180;
      return {
        x: Math.cos(pr) * Math.sin(yr),
        y: Math.sin(pr),
        z: Math.cos(pr) * Math.cos(yr)
      };
    }

    // Helper: Cartesiano a pitch/yaw
    function toSpherical(v) {
      const p = Math.asin(Math.max(-1, Math.min(1, v.y))) * 180 / Math.PI;
      const y = Math.atan2(v.x, v.z) * 180 / Math.PI;
      return [p, y];
    }

    // Helper: producto cruz
    function cross(a, b) {
      return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
      };
    }

    // Helper: normalizar
    function normalize(v) {
      const len = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
      if (len === 0) return {x:0, y:0, z:0};
      return { x: v.x/len, y: v.y/len, z: v.z/len };
    }

    const pts3D = puntos.map(pt => toCartesian(pt[0], pt[1]));

    for (let i = 0; i < pts3D.length; i++) {
      const A = pts3D[i];
      let Dir;

      if (i === 0) {
        Dir = { x: pts3D[1].x - A.x, y: pts3D[1].y - A.y, z: pts3D[1].z - A.z };
      } else if (i === pts3D.length - 1) {
        Dir = { x: A.x - pts3D[i-1].x, y: A.y - pts3D[i-1].y, z: A.z - pts3D[i-1].z };
      } else {
        const d1 = normalize({ x: A.x - pts3D[i-1].x, y: A.y - pts3D[i-1].y, z: A.z - pts3D[i-1].z });
        const d2 = normalize({ x: pts3D[i+1].x - A.x, y: pts3D[i+1].y - A.y, z: pts3D[i+1].z - A.z });
        Dir = { x: d1.x + d2.x, y: d1.y + d2.y, z: d1.z + d2.z };
      }

      Dir = normalize(Dir);
      const N = A; 
      const R = normalize(cross(Dir, N)); 

      const tanW = Math.tan(W);
      const right3D = normalize({ x: A.x + R.x * tanW, y: A.y + R.y * tanW, z: A.z + R.z * tanW });
      const left3D  = normalize({ x: A.x - R.x * tanW, y: A.y - R.y * tanW, z: A.z - R.z * tanW });

      rights.push(toSpherical(right3D));
      lefts.push(toSpherical(left3D));
    }

    const poly = [];
    for (let i = 0; i < lefts.length; i++) poly.push(lefts[i]);
    for (let i = rights.length - 1; i >= 0; i--) poly.push(rights[i]);
    
    return poly;
  }

  // ─── API PÚBLICA ────────────────────────────────────────────────────
  window.FerrariSVGPaths = { 
    updateSVGPaths,
    calculateStreetPolygon: _createStreetPolygon,
    setHoveredLote,
    bindHoverTracking
  };

  console.log('[Ferrari/SVGPaths] ✓ Módulo inicializado');

})();
