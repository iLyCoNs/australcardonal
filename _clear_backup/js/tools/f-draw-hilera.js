/**
 * f-draw-hilera.js — Herramienta para dibujar hileras de lotes
 *
 * Traza una línea base de 2 puntos y usa f-math-scale.js para proyectar
 * los lotes hacia atrás en el terreno según los M2 ingresados.
 */

'use strict';

(function() {

  let _active       = false;
  let _bound        = false;
  let _startPoint   = null;

  function activate() {
    window.FerrariTools.deactivateAllTools();
    _active = true;
    _startPoint = null;
    document.getElementById('panorama-container').classList.add('drawing-active');
    
    // Mostrar panel de datos
    const panel = document.getElementById('hilera-data-panel');
    if (panel) panel.style.display = 'block';

    window.FerrariOverlay.startDrawing([]);
    _setPannellumDraggable(false);
    window.FerrariHUD && window.FerrariHUD.showDraw('hilera');
    window.FerrariUI && window.FerrariUI.showToast('Hilera de Lotes: Haz click para el primer punto (Frente).', 'info');
  }

  function deactivate() {
    if (!_active) return;
    _active = false;
    _startPoint = null;
    document.getElementById('panorama-container').classList.remove('drawing-active');
    
    const panel = document.getElementById('hilera-data-panel');
    if (panel) panel.style.display = 'none';

    window.FerrariOverlay.clearOverlay();
    _setPannellumDraggable(true);
    window.FerrariHUD && window.FerrariHUD.hideDraw();
  }

  function bindEvents() {
    if (_bound) return;
    _bound = true;

    const container = document.getElementById('panorama-container');
    
    container.addEventListener('mousedown', function(e) {
      if (!_active || e.button !== 0) return;
      
      const coords = _mouseEventToCoords(e);
      if (!coords) return;

      if (!_startPoint) {
        _startPoint = coords;
        window.FerrariOverlay.addPoint(coords);
        window.FerrariUI && window.FerrariUI.showToast('Punto inicial fijado. Haz click en el segundo punto.', 'info');
      } else {
        // Segundo punto: generar la hilera
        _finishHilera(coords);
      }
    }, false);

    container.addEventListener('mousemove', function(e) {
      if (!_active || !_startPoint) return;
      const coords = _mouseEventToCoords(e);
      if (coords) window.FerrariOverlay.updateTempPoint(coords);
    }, false);

    document.addEventListener('keydown', function(e) {
      if (!_active) return;
      if (e.key === 'Escape') {
        deactivate();
      }
    }, false);
  }

  function _finishHilera(endPoint) {
    if (!window.FerrariMathScale) {
      window.FerrariUI.showToast('Motor matemático no encontrado.', 'error');
      deactivate();
      return;
    }

    const altitude = parseFloat(document.getElementById('hilera-altitude').value) || 120;
    const numLotes = parseInt(document.getElementById('hilera-count').value) || 5;
    const areaBase = parseFloat(document.getElementById('hilera-area').value) || 5000;

    // Proyectar A y B al suelo
    const ptA = window.FerrariMathScale.pitchYawToGround(_startPoint[0], _startPoint[1], altitude);
    const ptB = window.FerrariMathScale.pitchYawToGround(endPoint[0], endPoint[1], altitude);

    const dirX = ptB.x - ptA.x;
    const dirZ = ptB.z - ptA.z;
    const length = Math.sqrt(dirX*dirX + dirZ*dirZ);

    if (length < 0.1) {
      window.FerrariUI.showToast('Línea base demasiado corta.', 'warning');
      deactivate();
      return;
    }

    const nx = dirX / length;
    const nz = dirZ / length;

    // Vector hacia "atrás" (perpendicular en el plano XZ).
    // Si A -> B va de izquierda a derecha, (nz, -nx) va hacia "adentro" de la pantalla
    const backX = nz;
    const backZ = -nx;

    // Cada lote tiene ancho W y profundidad D
    const W = length / numLotes;
    const D = areaBase / W;

    const nuevosIds = [];

    // Generar la grilla de puntos para compartir referencias exactas
    const frontPts = [];
    const backPts  = [];
    for (let i = 0; i <= numLotes; i++) {
      const fx = ptA.x + nx * (W * i);
      const fz = ptA.z + nz * (W * i);
      const bx = fx + backX * D;
      const bz = fz + backZ * D;
      
      frontPts.push(window.FerrariMathScale.groundToPitchYaw(fx, fz, altitude));
      backPts.push(window.FerrariMathScale.groundToPitchYaw(bx, bz, altitude));
    }

    // Generar lotes usando los puntos exactos
    for (let i = 0; i < numLotes; i++) {
      const sf1 = frontPts[i];
      const sf2 = frontPts[i+1];
      const sb2 = backPts[i+1];
      const sb1 = backPts[i];

      // El orden del polígono: f1 -> f2 -> sb2 -> sb1 (Counter-Clockwise)
      const puntos = [
        [sf1.pitch, sf1.yaw],
        [sf2.pitch, sf2.yaw],
        [sb2.pitch, sb2.yaw],
        [sb1.pitch, sb1.yaw]
      ];

      // Contar lotes existentes para autonumerar (asumiendo que los dibujamos secuencialmente aquí)
      const numLotes = window.allDrawnLines.filter(l => l.tipo.startsWith('lote') || l.tipo.startsWith('franja')).length;

      const id = window.FerrariState.addLine({
        tipo: 'lote-libre',
        puntos: puntos,
        estado: 'disponible',
        titulo: `Lote ${numLotes + 1}`
      });
      nuevosIds.push(id);
    }

    // Guardar historial para Deshacer en un solo bloque si quisiéramos (el state actual no soporta undo agrupado,
    // pero está bien).
    window.FerrariState.saveToLocalStorage();
    
    // Forzar render
    window.FerrariSVGSync.syncSVGElements();
    window.FerrariSVGPaths.updateSVGPaths();
    
    window.FerrariUI.showToast(`Hilera creada: ${numLotes} lotes de ${areaBase}m².`, 'success');
    
    // Resetear herramienta para seguir dibujando
    _startPoint = null;
    window.FerrariOverlay.clearOverlay();
    window.FerrariOverlay.startDrawing([]);
  }

  function _mouseEventToCoords(e) {
    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return null;
    try {
      return viewer.mouseEventToCoords(e);
    } catch(err) {
      return null;
    }
  }

  function _setPannellumDraggable(val) {
    const p = document.querySelector('.pnlm-container');
    if (p) p.style.pointerEvents = val ? 'auto' : 'none';
  }

  window.FerrariDrawHilera = { activate, deactivate, bindEvents };
  console.log('[Ferrari/DrawHilera] ✓ Módulo inicializado');

})();
