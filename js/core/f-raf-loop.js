/**
 * f-raf-loop.js — requestAnimationFrame maestro Ferrari360
 *
 * ARQUITECTURA 60 FPS:
 * ─ checkCameraDirty() cada frame (O(1))
 * ─ updateSVGPaths()   SOLO si cámara movió
 * ─ syncSVGElements()  SOLO si DOMCache.version cambió (delta)
 * ─ updateDrawOverlay() SOLO si hay dibujo activo
 *
 * NUNCA hacer querySelectorAll ni innerHTML en el rAF loop.
 */

'use strict';

(function() {

  let _rafId       = null;
  let _running     = false;
  let _frameCount  = 0;
  let _dataDirty   = false; // true cuando los datos cambiaron (ej: slider de ancho)
  let _lastErrFrame = -1;  // watchdog: throttle de logs de error del proceso por frame

  // ─── LOGICA DEL FRAME ─────────────────────────────────────────────────

  function processFrame() {
    // 0. Nuevo frame de proyección: invalidar cache de pitch/yaw/focal.
    //    Sin esto el memo de f-camera puede reutilizar vista de un frame
    //    anterior → SVG desfasado del WebGL = lotes "flotando".
    if (window.FerrariCamera && window.FerrariCamera.beginFrame) {
      window.FerrariCamera.beginFrame();
    }

    // 1. Verificar si la cámara se movió (O(1) tras lectura fresca)
    const camDirty = window.FerrariCamera.checkCameraDirty();
    const dataDirty = _dataDirty;

    // Idle autorotate deja camDirty=true casi siempre. En phone/tablet
    // bajamos overlays pesados a ~30fps para no pelear con WebGL.
    // Solo si Pannellum está realmente en autoRotate (no durante drag del usuario).
    const isNarrow = typeof window !== 'undefined' && window.innerWidth < 900;
    let autoSpin = false;
    try {
      const cfg = window.Ferrari && window.Ferrari.viewer && window.Ferrari.viewer.getConfig &&
        window.Ferrari.viewer.getConfig();
      autoSpin = !!(cfg && cfg.autoRotate);
    } catch (e) { autoSpin = false; }
    const heavyOk = !isNarrow || !autoSpin || (_frameCount % 2 === 0);

    // 2. Si cámara cambió O datos cambiaron (ej: slider) → recalcular todos los paths SVG
    if ((camDirty || dataDirty) && heavyOk) {
      if (window.FerrariSVGPaths && window.FerrariSVGPaths.updateSVGPaths) {
        window.FerrariSVGPaths.updateSVGPaths();
      }
      // Calco KMZ: misma proyección que lotes/calles
      if (window.FerrariKmzCalco && window.FerrariKmzCalco.isVisible && window.FerrariKmzCalco.isVisible()) {
        window.FerrariKmzCalco.updatePaths();
      }
      _dataDirty = false; // consumir el flag
    }

    // 3. Si allDrawnLines cambió (version counter) → delta sync de elementos SVG
    if (window.DOMCache.version !== window.DOMCache.lastSyncedVersion) {
      if (window.FerrariSVGSync && window.FerrariSVGSync.syncSVGElements) {
        window.FerrariSVGSync.syncSVGElements();
      }
      // Después del sync, recalcular paths también (nuevos elementos)
      if (window.FerrariSVGPaths && window.FerrariSVGPaths.updateSVGPaths) {
        window.FerrariSVGPaths.updateSVGPaths();
      }
    }

    // 4. Si hay dibujo activo → actualizar overlay de vértices activos
    if (window.FerrariOverlay && window.FerrariOverlay.hasActiveDrawing()) {
      window.FerrariOverlay.updateDrawOverlay();
    }

    // 4b. Geo pins + brújula
    // Durante arrastre de vértices de lote no hace falta reposicionar geo pins
    // (la cámara está fija) — ahorra layout thrash en el overlay HTML.
    const editingVerts = window.FerrariEdit &&
      window.FerrariEdit.isDragging &&
      window.FerrariEdit.isDragging();

    if ((camDirty || dataDirty) && !editingVerts && heavyOk) {
      if (window.FerrariCompass && window.FerrariCompass.refresh) {
        window.FerrariCompass.refresh();
      }
    }
    if (window.FerrariGeoPins && window.FerrariGeoPins.update && !editingVerts) {
      const geoDragging = window.FerrariGeoPins.isDragging && window.FerrariGeoPins.isDragging();
      const wantGeo = !!(camDirty || dataDirty || geoDragging);
      // Mismo throttle en idle móvil; drag de pin siempre al frame
      if (wantGeo && (geoDragging || heavyOk)) {
        window.FerrariGeoPins.update(true);
      } else if (!wantGeo) {
        window.FerrariGeoPins.update(false);
      }
    }
    // 4c. Smart Pins — SOLO si cámara/datos cambiaron (antes: cada frame = lag móvil)
    if (window.FerrariSmartPins && !editingVerts && (camDirty || dataDirty) && heavyOk) {
      window.FerrariSmartPins.update();
    }

    // 5. Actualizar HUD coords cada 10 frames (no necesita 60fps)
    if (_frameCount % 10 === 0) {
      if (window.FerrariHUD && window.FerrariHUD.updateCoords) {
        window.FerrariHUD.updateCoords();
      }
    }
  }

  // ─── LOOP MAESTRO ───────────────────────────────────────────────────

  function _loop(timestamp) {
    if (!_running) return;
    _frameCount++;
    try {
      processFrame();
    } catch (err) {
      // Watchdog: un error en un frame NO debe matar el bucle (overlay
      // congelado para siempre). Throttle de log (1 vez cada ~5s) para
      // no inundar la consola si el error persiste.
      if (_frameCount - _lastErrFrame > 60) {
        _lastErrFrame = _frameCount;
        console.error('[Ferrari/RAF] processFrame error (ignorado, bucle sigue):', err);
      }
    }
    _rafId = requestAnimationFrame(_loop);
  }

  // ─── CONTROL DEL LOOP ────────────────────────────────────────────────

  function start() {
    if (_running) return;
    _running = true;
    _rafId   = requestAnimationFrame(_loop);
    console.log('[Ferrari/RAF] ✓ Loop iniciado');
  }

  function stop() {
    _running = false;
    if (_rafId) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    console.log('[Ferrari/RAF] Loop detenido');
  }

  function isRunning() {
    return _running;
  }

  function getFrameCount() {
    return _frameCount;
  }

  function markDataDirty() { _dataDirty = true; }

  // ─── API PÚBLICA ────────────────────────────────────────────────────
  window.FerrariRAF = { start, stop, isRunning, getFrameCount, markDataDirty, processFrame };

  console.log('[Ferrari/RAF] ✓ Módulo inicializado');

})();
