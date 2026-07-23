/**
 * f-street-network.js — Unión de calles en una sola red con intersecciones
 *
 * - Detecta cruces entre ejes (plano del suelo)
 * - Inserta vértices de intersección en ambas calles
 * - Snap de extremos a ejes cercanos (empalmes en T)
 * - Asigna redId compartido a calles conectadas
 * - Expone helpers de render para el asfalto unificado
 */

'use strict';

(function() {

  const ALTITUDE = 120;
  const ENDPOINT_SNAP_M = 8;   // metros en plano suelo para empalme T
  const VERTEX_DEDUP_M = 1.2;  // no insertar si ya hay vértice cerca
  const CROSS_EPS = 0.015;     // evita cruces en los extremos exactos (0..1)

  function _isCalle(line) {
    return line && (line.tipo === 'calle' || line.tipo === 'calle-curva-arq2');
  }

  function _toGround(pt) {
    return window.FerrariMathScale.pitchYawToGround(pt[0], pt[1], ALTITUDE);
  }

  function _toSphere(x, z) {
    const s = window.FerrariMathScale.groundToPitchYaw(x, z, ALTITUDE);
    return [s.pitch, s.yaw];
  }

  function _dist2(a, b) {
    const dx = a.x - b.x, dz = a.z - b.z;
    return dx * dx + dz * dz;
  }

  function _segIntersect(a1, a2, b1, b2) {
    const dax = a2.x - a1.x, daz = a2.z - a1.z;
    const dbx = b2.x - b1.x, dbz = b2.z - b1.z;
    const den = dax * dbz - daz * dbx;
    if (Math.abs(den) < 1e-12) return null;

    const t = ((b1.x - a1.x) * dbz - (b1.z - a1.z) * dbx) / den;
    const u = ((b1.x - a1.x) * daz - (b1.z - a1.z) * dax) / den;

    if (t < CROSS_EPS || t > 1 - CROSS_EPS || u < CROSS_EPS || u > 1 - CROSS_EPS) {
      return null;
    }

    return {
      x: a1.x + t * dax,
      z: a1.z + t * daz,
      t, u
    };
  }

  function _closestOnSegment(p, a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-12) return { x: a.x, z: a.z, t: 0, dist2: _dist2(p, a) };
    let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const q = { x: a.x + t * dx, z: a.z + t * dz };
    return { x: q.x, z: q.z, t, dist2: _dist2(p, q) };
  }

  /**
   * Inserta un punto esférico en la polilínea si no hay vértice cercano.
   * @returns {boolean} true si insertó
   */
  function _insertPointOnPolyline(line, spherePt, preferSegIdx, preferT) {
    if (!line.puntos || line.puntos.length < 2) return false;

    const gNew = _toGround(spherePt);
    const dedup2 = VERTEX_DEDUP_M * VERTEX_DEDUP_M;

    for (let i = 0; i < line.puntos.length; i++) {
      if (_dist2(_toGround(line.puntos[i]), gNew) < dedup2) return false;
    }

    let bestIdx = -1;
    let bestDist = Infinity;

    if (typeof preferSegIdx === 'number' && preferSegIdx >= 0 && preferSegIdx < line.puntos.length - 1) {
      bestIdx = preferSegIdx + 1;
    } else {
      for (let i = 0; i < line.puntos.length - 1; i++) {
        const a = _toGround(line.puntos[i]);
        const b = _toGround(line.puntos[i + 1]);
        const c = _closestOnSegment(gNew, a, b);
        if (c.dist2 < bestDist) {
          bestDist = c.dist2;
          bestIdx = i + 1;
        }
      }
    }

    if (bestIdx < 0) return false;
    line.puntos.splice(bestIdx, 0, spherePt);
    return true;
  }

  function _ensureRedId(line) {
    if (!line.redId) {
      line.redId = window.FerrariState.generateId();
    }
    return line.redId;
  }

  function _mergeRedIds(a, b) {
    const idA = _ensureRedId(a);
    const idB = _ensureRedId(b);
    if (idA === idB) return idA;
    // Unificar: todas las calles con idB pasan a idA
    const lines = window.allDrawnLines || [];
    for (let i = 0; i < lines.length; i++) {
      if (_isCalle(lines[i]) && lines[i].redId === idB) {
        lines[i].redId = idA;
      }
    }
    b.redId = idA;
    return idA;
  }

  /**
   * Empalma extremos de `line` a ejes de otras calles (intersección en T).
   */
  function _snapEndpointsToNetwork(line) {
    const others = (window.allDrawnLines || []).filter(l => _isCalle(l) && l.id !== line.id);
    if (!others.length || !line.puntos || line.puntos.length < 2) return false;

    let changed = false;
    const snap2 = ENDPOINT_SNAP_M * ENDPOINT_SNAP_M;
    const endIndexes = [0, line.puntos.length - 1];

    for (const ei of endIndexes) {
      const gEnd = _toGround(line.puntos[ei]);
      let best = null;

      for (const other of others) {
        if (!other.puntos || other.puntos.length < 2) continue;
        for (let i = 0; i < other.puntos.length - 1; i++) {
          const a = _toGround(other.puntos[i]);
          const b = _toGround(other.puntos[i + 1]);
          const c = _closestOnSegment(gEnd, a, b);
          if (c.dist2 < snap2 && (!best || c.dist2 < best.dist2)) {
            best = { other, segIdx: i, t: c.t, x: c.x, z: c.z, dist2: c.dist2 };
          }
        }
      }

      if (!best) continue;

      const sphere = _toSphere(best.x, best.z);
      line.puntos[ei] = sphere;
      _insertPointOnPolyline(best.other, sphere, best.segIdx, best.t);
      _mergeRedIds(line, best.other);
      changed = true;
    }

    return changed;
  }

  /**
   * Detecta cruces de ejes e inserta vértices de intersección.
   */
  function _splitAtCrossings(line) {
    const others = (window.allDrawnLines || []).filter(l => _isCalle(l) && l.id !== line.id);
    if (!others.length || !line.puntos || line.puntos.length < 2) return false;

    let changed = false;
    // Re-escanear mientras haya cruces nuevos (pocas iteraciones)
    for (let pass = 0; pass < 8; pass++) {
      let found = false;

      outer:
      for (let i = 0; i < line.puntos.length - 1; i++) {
        const a1 = _toGround(line.puntos[i]);
        const a2 = _toGround(line.puntos[i + 1]);

        for (const other of others) {
          if (!other.puntos || other.puntos.length < 2) continue;

          for (let j = 0; j < other.puntos.length - 1; j++) {
            const b1 = _toGround(other.puntos[j]);
            const b2 = _toGround(other.puntos[j + 1]);
            const hit = _segIntersect(a1, a2, b1, b2);
            if (!hit) continue;

            const sphere = _toSphere(hit.x, hit.z);
            const insA = _insertPointOnPolyline(line, sphere, i, hit.t);
            const insB = _insertPointOnPolyline(other, sphere, j, hit.u);
            if (insA || insB) {
              _mergeRedIds(line, other);
              changed = true;
              found = true;
              break outer; // reiniciar tras mutar índices
            }
          }
        }
      }

      if (!found) break;
    }

    return changed;
  }

  /**
   * Tras crear/editar una calle: empalmes + cruces + redId.
   * @param {string} lineId
   * @returns {{ merged: boolean, redId: string|null }}
   */
  function integrateStreet(lineId) {
    const line = window.FerrariState.getLine(lineId);
    if (!_isCalle(line)) return { merged: false, redId: null };

    _ensureRedId(line);
    const snapped = _snapEndpointsToNetwork(line);
    const crossed = _splitAtCrossings(line);
    const merged = snapped || crossed;

    // Si toca a otra calle solo por cercanía de cualquier vértice, unificar red
    if (!merged) {
      const others = (window.allDrawnLines || []).filter(l => _isCalle(l) && l.id !== line.id);
      const near2 = ENDPOINT_SNAP_M * ENDPOINT_SNAP_M;
      for (const pt of line.puntos) {
        const g = _toGround(pt);
        for (const other of others) {
          for (const op of other.puntos || []) {
            if (_dist2(g, _toGround(op)) < near2) {
              _mergeRedIds(line, other);
              line._streetPolyDirty = true;
              other._streetPolyDirty = true;
              return { merged: true, redId: line.redId };
            }
          }
        }
      }
    }

    line._streetPolyDirty = true;
    return { merged, redId: line.redId };
  }

  /**
   * Snap magnético en pantalla hacia ejes/vértices de calles existentes.
   * @returns {{ pitch, yaw, px, py, kind } | null}
   */
  function findStreetSnap(pitch, yaw, snapPx) {
    const lines = window.allDrawnLines;
    if (!lines || !lines.length) return null;

    const proj = window.FerrariCamera.getProjectionParams();
    const curCam = window.FerrariCamera.getCam(pitch, yaw);
    if (curCam.z <= 0.0001) return null;
    const cur = window.FerrariCamera.camToPixel(curCam, proj);

    let bestDist = snapPx;
    let best = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!_isCalle(line) || !line.puntos) continue;

      // Vértices
      for (let j = 0; j < line.puntos.length; j++) {
        const pt = line.puntos[j];
        const cam = window.FerrariCamera.getCam(pt[0], pt[1]);
        if (cam.z <= 0.0001) continue;
        const px = window.FerrariCamera.camToPixel(cam, proj);
        const dist = Math.hypot(px.px - cur.px, px.py - cur.py);
        if (dist < bestDist) {
          bestDist = dist;
          best = { pitch: pt[0], yaw: pt[1], px: px.px, py: px.py, kind: 'vertex' };
        }
      }

      // Punto más cercano en segmentos (proyección pantalla → coords vía mouse-like)
      for (let j = 0; j < line.puntos.length - 1; j++) {
        const p1 = line.puntos[j];
        const p2 = line.puntos[j + 1];
        const c1 = window.FerrariCamera.getCam(p1[0], p1[1]);
        const c2 = window.FerrariCamera.getCam(p2[0], p2[1]);
        if (c1.z <= 0.0001 || c2.z <= 0.0001) continue;
        const s1 = window.FerrariCamera.camToPixel(c1, proj);
        const s2 = window.FerrariCamera.camToPixel(c2, proj);

        const dx = s2.px - s1.px, dy = s2.py - s1.py;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-6) continue;
        let t = ((cur.px - s1.px) * dx + (cur.py - s1.py) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const sx = s1.px + t * dx;
        const sy = s1.py + t * dy;
        const dist = Math.hypot(sx - cur.px, sy - cur.py);
        if (dist < bestDist) {
          // Interpolar pitch/yaw en el eje (aprox. lineal en esfera corta)
          const pitchS = p1[0] + (p2[0] - p1[0]) * t;
          let dyaw = p2[1] - p1[1];
          if (dyaw > 180) dyaw -= 360;
          if (dyaw < -180) dyaw += 360;
          const yawS = p1[1] + dyaw * t;
          bestDist = dist;
          best = { pitch: pitchS, yaw: yawS, px: sx, py: sy, kind: 'edge' };
        }
      }
    }

    return best;
  }

  window.FerrariStreetNetwork = {
    integrateStreet,
    findStreetSnap,
    isCalle: _isCalle
  };

  console.log('[Ferrari/StreetNetwork] ✓ Módulo inicializado');

})();
