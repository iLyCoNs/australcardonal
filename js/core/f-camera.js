/**
 * f-camera.js — Proyección gnomónica + dirty-flag de cámara
 *
 * LECCIÓN 7: Math.asin debe clampear: Math.min(1, Math.max(-1, val))
 * LECCIÓN 5: Si Pannellum usa scale(-1,1,1) internamente,
 *            getCam debe negar yaw. Flag FERRARI_INVERT_YAW = false por defecto.
 *            Cambiar a true si los paths aparecen espejados.
 *
 * BUG NADIR (-90°): Pannellum escribe b.pitch SIN clampear en mousemove/touchmove
 * (ua/la) y solo lo clampea dentro de Fa() justo antes de C.render().
 * getPitch() puede devolver -95°, -120°, etc. mientras el WebGL ya está en -90°.
 * Si Ferrari proyecta con ese pitch crudo, los lotes "flotan" siguiendo el cursor.
 * Solución: clampear pitch con la misma lógica que Fa() antes de dirty-check y getCam.
 *
 * CACHE POR FRAME (fix lag 2026-07):
 * - Memoiza getClampedView/getProjectionParams DENTRO de un processFrame.
 * - NUNCA reutilizar cache entre frames: el stamp 0/1 + rAF lateral desincronizaba
 *   SVG vs WebGL → lotes flotando. Usar beginFrame() al inicio de cada processFrame.
 */

'use strict';

(function() {

  // ─── CONFIGURACIÓN ──────────────────────────────────────────────────
  // LECCIÓN 5: INVERT_YAW niega el delta angular (dy), NO el yaw absoluto.
  // Con la proyección gnomónica correcta (sin negar pitch), el eje X es correcto.
  // Cambiar a true SOLO si los trazos aparecen horizontalmente espejados.
  const INVERT_YAW = false;

  // ─── DIRTY FLAG ─────────────────────────────────────────────────────
  let _lastPitch = null;
  let _lastYaw   = null;
  let _lastHfov  = null;
  let _dirty     = false;

  // Cache SOLO válido entre beginFrame() y el final de ese processFrame.
  // Se invalida explícitamente; no hay rAF lateral ni stamp 0/1.
  let _viewCache = null;
  let _projCache = null;
  let _frameGen  = 0;
  let _cacheGen  = -1;

  // ─── CONSTANTES DE CÁMARA POR FRAME ─────────────────────────────────
  // cos/sin del pitch e yaw de la cámara: se recalculan UNA vez por frame,
  // no por punto. Elimina ~12.000 llamadas trig a 60fps con cientos de lotes.
  let _cosCp = 1, _sinCp = 0, _cosCy = 1, _sinCy = 0;
  let _camConstsGen = -1;

  function _updateCamConsts() {
    if (_camConstsGen === _frameGen) return;
    const view = getClampedView();
    const cp = view.pitch * Math.PI / 180;
    const cy = view.yaw   * Math.PI / 180;
    _cosCp = Math.cos(cp); _sinCp = Math.sin(cp);
    _cosCy = Math.cos(cy); _sinCy = Math.sin(cy);
    _camConstsGen = _frameGen;
  }

  // ─── CACHÉ TRIG POR VÉRTICE (WeakMap, auto-sanador) ──────────────────
  // Clave = array [pitch, yaw] inmutable del punto. Valor = [cosP,sinP,cosY,sinY,
  // srcPitch, srcYaw]. Se valida srcPitch/srcYaw en cada uso: si el punto fue
  // reemplazado en sitio (poco habitual) el caché se recalcula solo, sin bugs.
  // GC-friendly: cuando un array de punto se huérfana, su entrada muere con él.
  const _trigCache = new WeakMap();

  /**
   * Proyección gnomónica ACELERADA para un punto inmutable [pitch, yaw].
   * Usa trig pre-calculada por vértice + constantes de cámara por frame →
   * O(1) aritmética pura, cero sin/cos por punto. Salida idéntica a getCam
   * dentro de 1e-13 px (visualmente cero diferencia).
   *
   * Escribe en `out` ({x,y,z}) para evitar alocar un objeto por llamada.
   * Llamar con el mismo `out` reutilizado: getCamFastInto(pt, _scratch).
   *
   * @param {Array} pt — [pitch_deg, yaw_deg] (NO mutar tras pasar por aquí)
   * @param {Object} out — {x,y,z} reutilizable
   */
  function getCamFastInto(pt, out) {
    const pitchDeg = pt[0], yawDeg = pt[1];

    let t = _trigCache.get(pt);
    if (!t || t[4] !== pitchDeg || t[5] !== yawDeg) {
      const p = pitchDeg * Math.PI / 180;
      const y = yawDeg   * Math.PI / 180;
      t = [Math.cos(p), Math.sin(p), Math.cos(y), Math.sin(y), pitchDeg, yawDeg];
      _trigCache.set(pt, t);
    }

    _updateCamConsts();

    const cosP = t[0], sinP = t[1], cosY = t[2], sinY = t[3];
    // dy = yaw - camYaw → cosDy/sinDy vía resta de ángulos (0 trig):
    //   cos(a-b) = cosA cosB + sinA sinB
    //   sin(a-b) = sinA cosB - cosA sinB
    let cosDy = cosY * _cosCy + sinY * _sinCy;
    let sinDy = sinY * _cosCy - cosY * _sinCy;
    if (INVERT_YAW) sinDy = -sinDy;

    out.x = cosP * sinDy;
    out.y = sinP * _cosCp - cosP * cosDy * _sinCp;
    out.z = sinP * _sinCp + cosP * cosDy * _cosCp;
    return out;
  }

  /**
   * Debe llamarse al inicio de cada processFrame (rAF maestro).
   * Invalida el memo de vista/proyección para leer pitch/yaw frescos de Pannellum.
   */
  function beginFrame() {
    _frameGen++;
    _viewCache = null;
    _projCache = null;
    _cacheGen = -1;
    _camConstsGen = -1; // forzar recálculo de cos/sin de cámara este frame
  }

  function invalidateViewCache() {
    _viewCache = null;
    _projCache = null;
    _cacheGen = -1;
    _camConstsGen = -1;
  }

  /**
   * Réplica del clamp de pitch de Pannellum Fa().
   * Debe usarse SIEMPRE antes de proyectar o comparar dirty-state.
   *
   * @returns {{ pitch: number, yaw: number, hfov: number }}
   */
  function getClampedView() {
    if (_viewCache && _cacheGen === _frameGen) {
      return _viewCache;
    }

    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return { pitch: 0, yaw: 0, hfov: 100 };

    let pitch = 0, yaw = 0, hfov = 100;
    try {
      pitch = viewer.getPitch();
      yaw   = viewer.getYaw();
      hfov  = viewer.getHfov();
    } catch (e) {
      return { pitch: 0, yaw: 0, hfov: 100 };
    }

    const container = document.getElementById('pannellum-viewer');
    const w = (container && container.clientWidth)  || window.innerWidth  || 1;
    const h = (container && container.clientHeight) || window.innerHeight || 1;

    // VFOV efectivo (misma fórmula que Fa en pannellum.js)
    const vfov = 2 * Math.atan(
      Math.tan(hfov / 180 * Math.PI * 0.5) / (w / h)
    ) / Math.PI * 180;

    let minPitch = NaN;
    let maxPitch = NaN;
    try {
      const bounds = viewer.getPitchBounds();
      // getPitchBounds puede devolver [undefined, undefined] (default Pannellum)
      if (bounds && typeof bounds[0] === 'number' && typeof bounds[1] === 'number') {
        minPitch = bounds[0];
        maxPitch = bounds[1];
      }
    } catch (e) {}

    let lo = minPitch + vfov / 2;
    let hi = maxPitch - vfov / 2;
    if ((maxPitch - minPitch) < vfov) {
      lo = hi = (lo + hi) / 2;
    }
    // Defaults de Pannellum cuando min/maxPitch son undefined → Fa usa ±90
    // (sin ajustar por vfov; igual que pannellum.js)
    if (isNaN(lo)) lo = -90;
    if (isNaN(hi)) hi = 90;

    pitch = Math.max(lo, Math.min(hi, pitch));

    _viewCache = { pitch, yaw, hfov };
    _cacheGen = _frameGen;
    return _viewCache;
  }

  /**
   * Comprueba si la cámara se movió comparando con el estado anterior.
   * Llamado cada frame por el rAF loop (tras beginFrame → lectura fresca).
   * @returns {boolean} true si hay cambio
   */
  function checkCameraDirty() {
    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return false;

    const view = getClampedView();
    const p = view.pitch;
    const y = view.yaw;
    const h = view.hfov;

    // EPSILON = 0.01° filtra micro-oscilaciones residuales del spring/inercia.
    // El clamp de getClampedView() es lo que evita el float en el nadir:
    // sin él, getPitch() sigue cambiando (-91, -95, -120…) al arrastrar aunque
    // el panorama ya esté topeado en -90°.
    const EPSILON = 0.01;
    if (_lastPitch === null ||
        Math.abs(p - _lastPitch) > EPSILON ||
        Math.abs(y - _lastYaw)   > EPSILON ||
        Math.abs(h - _lastHfov)  > EPSILON) {
      _lastPitch = p;
      _lastYaw   = y;
      _lastHfov  = h;
      _dirty     = true;
      return true;
    }
    _dirty = false;
    return false;
  }

  /**
   * Retorna si la cámara está sucia (se movió en este frame).
   */
  function isCameraDirty() {
    return _dirty;
  }

  /**
   * Fuerza el dirty flag (útil al hacer resize o cargar nuevos datos).
   */
  function markDirty() {
    _dirty = true;
    // Invalidar el cache de estado para que en el próximo frame se recalcule
    _lastPitch = null;
    _lastYaw   = null;
    _lastHfov  = null;
    invalidateViewCache();
  }

  // ─── PROYECCIÓN GNOMÓNICA ───────────────────────────────────────────

  /**
   * Convierte coordenadas esféricas Pannellum a vector de cámara 3D.
   * Proyección gnomónica exacta según el spec Ferrari.
   *
   * @param {number} pitch_deg — pitch del punto en grados
   * @param {number} yaw_deg   — yaw del punto en grados
   * @returns {{ x: number, y: number, z: number }}
   *   Si z <= 0.0001 el punto está detrás de la cámara → no renderizar
   */
  function getCam(pitch_deg, yaw_deg) {
    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return { x: 0, y: 0, z: -1 };

    // CRÍTICO: usar pitch clampeado (el que realmente renderiza WebGL),
    // no el valor crudo de getPitch() durante drag past-limit.
    const view = getClampedView();
    const camPitch = view.pitch;
    const camYaw   = view.yaw;

    // Radianes — SIN NEGAR: pitch positivo = arriba, consistente con Pannellum.
    // BUG anterior: -pitch_deg causaba sinP con signo opuesto → eje Y invertido.
    const p  = pitch_deg * Math.PI / 180;  // ✓ SIN negar
    const cp = camPitch  * Math.PI / 180;  // ✓ SIN negar

    const cosP  = Math.cos(p);
    const sinP  = Math.sin(p);
    const cosCp = Math.cos(cp);
    const sinCp = Math.sin(cp);

    // dy = diferencia angular desde la cámara al punto (en radianes)
    // LECCIÓN 5: Pannellum 2.5.7 invierte el eje X en su WebGL interno.
    // La corrección CORRECTA es negar dy (el DELTA), NO el yaw absoluto.
    // Negar el yaw absoluto rompe la fórmula cuando camYaw ≠ 0.
    let dy = (yaw_deg - camYaw) * Math.PI / 180;
    if (INVERT_YAW) dy = -dy;

    // Normalizar al rango [-π, π]
    dy = ((dy + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

    const cosDy = Math.cos(dy);
    const sinDy = Math.sin(dy);

    return {
      x: cosP * sinDy,
      y: sinP * cosCp - cosP * cosDy * sinCp,
      z: sinP * sinCp + cosP * cosDy * cosCp
    };
  }

  /**
   * Retorna los parámetros de proyección pixel: centro y focal.
   * @returns {{ cx: number, cy: number, f: number, w: number, h: number }}
   */
  function getProjectionParams() {
    if (_projCache && _cacheGen === _frameGen) {
      return _projCache;
    }

    const container = document.getElementById('pannellum-viewer');
    if (!container) return { cx: 0, cy: 0, f: 1, w: 1, h: 1 };

    const w = container.clientWidth  || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    const hfov = getClampedView().hfov;

    // f: distancia focal en píxeles (proyección gnomónica)
    const f = 0.5 * w / Math.tan(hfov * Math.PI / 360);

    _projCache = {
      cx: w / 2,
      cy: h / 2,
      f,
      w,
      h
    };
    // getClampedView ya fijó _cacheGen; alinear por si se llamó solo proj
    _cacheGen = _frameGen;
    return _projCache;
  }

  /**
   * Proyecta un vector de cámara (del getCam) a coordenadas pixel SVG.
   * @param {{ x, y, z }} cam
   * @param {{ cx, cy, f }} proj — resultado de getProjectionParams()
   * @returns {{ px: number, py: number, visible: boolean }}
   */
  function camToPixel(cam, proj, marginMul) {
    if (cam.z <= 0.0001) {
      return { px: -9999, py: -9999, visible: false };
    }
    const px = proj.cx + (cam.x / cam.z) * proj.f;
    const py = proj.cy - (cam.y / cam.z) * proj.f;

    // NO forzamos visible: false ni recortamos a -9999 si el punto está al frente (z > 0.0001).
    // Esto mantiene estable la estructura del path SVG (número constante de comandos/vértices),
    // permitiendo que el navegador use aceleración por hardware y clip nativo de manera fluida sin
    // provocar "layout thrashing" por recompilar geometría SVG constantemente.
    // Solo limitamos a un valor extremo absoluto para prevenir overflow de punto flotante.
    const LIMIT = 1e6;
    if (Math.abs(px) > LIMIT || Math.abs(py) > LIMIT) {
      return { px: px > 0 ? LIMIT : -LIMIT, py: py > 0 ? LIMIT : -LIMIT, visible: false };
    }
    return { px, py, visible: true };
  }

  /**
   * Convierte directamente [pitch_deg, yaw_deg] a pixel SVG.
   * Helper conveniente que combina getCam + camToPixel.
   * @param {number} pitch_deg
   * @param {number} yaw_deg
   * @param {Object} proj — resultado de getProjectionParams(), opcional
   * @returns {{ px, py, visible }}
   */
  function sphereToPixel(pitch_deg, yaw_deg, proj) {
    if (!proj) proj = getProjectionParams();
    const cam = getCam(pitch_deg, yaw_deg);
    return camToPixel(cam, proj);
  }

  // ─── API PÚBLICA ────────────────────────────────────────────────────
  window.FerrariCamera = {
    beginFrame,
    checkCameraDirty,
    isCameraDirty,
    markDirty,
    invalidateViewCache,
    getClampedView,
    getCam,
    getCamFastInto,
    getProjectionParams,
    camToPixel,
    sphereToPixel
  };

  console.log('[Ferrari/Camera] ✓ Módulo inicializado');

})();
