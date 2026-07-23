/**
 * f-hud.js — HUD de información en pantalla
 *
 * Muestra:
 *   - Pitch, Yaw, HFOV de la cámara (actualizado cada 10 frames desde rAF)
 *   - Nombre de herramienta activa + conteo de vértices
 *   - Hint de controles durante el dibujo
 */

'use strict';

(function() {

  // ─── REFERENCIAS DOM (cacheadas en init) ─────────────────────────
  let _elPitch   = null;
  let _elYaw     = null;
  let _elHfov    = null;
  let _elHudDraw = null;
  let _elTool    = null;
  let _elCount   = null;
  let _elHint    = null;

  function init() {
    _elPitch   = document.getElementById('hud-pitch');
    _elYaw     = document.getElementById('hud-yaw');
    _elHfov    = document.getElementById('hud-hfov');
    _elHudDraw = document.getElementById('kpk-hud-draw');
    _elTool    = document.getElementById('hud-tool-name');
    _elCount   = document.getElementById('hud-vertex-count');
    _elHint    = document.getElementById('hud-hint');
    _syncHudPlacement();
    window.addEventListener('resize', _syncHudPlacement);
    // El dock del comprador puede crearse después
    setTimeout(_syncHudPlacement, 800);
    setTimeout(_syncHudPlacement, 2000);
    console.log('[Ferrari/HUD] ✓ Inicializado');
  }

  /** Móvil: HFOV bajo «Consigue tu 360°» (~30% del tamaño del CTA). Desktop: HUD esquina. */
  function _syncHudPlacement() {
    const coords = document.getElementById('kpk-hud-coords');
    const layer  = document.getElementById('kpk-hud-layer');
    if (!coords || !layer) return;

    const isMobile = window.innerWidth <= 640;
    const stack = document.querySelector('#kpk-buyer-dock .kbd-stack');
    const cta = document.getElementById('kbd-cta-btn');

    if (isMobile && stack && cta && document.body.contains(cta)) {
      if (coords.parentElement !== stack || coords.previousElementSibling !== cta) {
        cta.insertAdjacentElement('afterend', coords);
      }
      coords.classList.add('hud-chip--under-cta');
      layer.classList.add('kpk-hud-layer--mobile-dock');
    } else {
      if (coords.parentElement !== layer) {
        const draw = document.getElementById('kpk-hud-draw');
        if (draw && draw.parentElement === layer) layer.insertBefore(coords, draw);
        else layer.appendChild(coords);
      }
      coords.classList.remove('hud-chip--under-cta');
      layer.classList.remove('kpk-hud-layer--mobile-dock');
    }
  }

  // ─── COORDS — Llamado cada 10 frames desde rAF ───────────────────

  function updateCoords() {
    if (!window.FerrariCamera || !window.FerrariCamera.getClampedView) return;

    // Mostrar el pitch que realmente usa WebGL/SVG (clampeado), no el crudo del drag
    const view = window.FerrariCamera.getClampedView();
    const p = view.pitch;
    const y = view.yaw;
    const h = view.hfov;

    if (_elPitch) _elPitch.textContent = `P: ${p.toFixed(1)}°`;
    if (_elYaw)   _elYaw.textContent   = `Y: ${y.toFixed(1)}°`;
    if (_elHfov)  _elHfov.textContent  = `HFOV: ${h.toFixed(0)}°`;
  }

  // ─── DRAW INFO ────────────────────────────────────────────────────

  const TOOL_LABELS = {
    'lote-libre':        'Lote Libre',
    'lote-organico':     'Lote Orgánico',
    'calle':             'Calle Recta',
    'calle-curva-arq2':  'Calle Curva',
    'geo-north':         'Fijar Norte',
    'geo-horizonte':     'Pin Horizonte',
    'geo-ruta':          'Pin Ruta',
    'geo-amenidad':      'Amenities',
    'tone':              'Tonos 360',
    'kmz-manip':         'Mover calco KMZ'
  };

  const TOOL_HINTS = {
    'lote-libre':        'Click: vértice · Enter/2×click: cerrar · Esc: cancelar · Ctrl+Z: deshacer',
    'lote-organico':     'Click: vértice · Enter/2×click: cerrar · Esc: cancelar · Ctrl+Z: deshacer',
    'calle':             'Click: punto · Enter/2×click: terminar · Esc: cancelar',
    'calle-curva-arq2':  'Click: punto · Enter/2×click: terminar · Esc: cancelar',
    'geo-north':         'Click en la dirección del Norte real para calibrar la brújula',
    'geo-horizonte':     'Click · busca ciudad/volcán · coords automáticas · Maps/Waze',
    'geo-ruta':          'Click · busca acceso/carretera · GPS automático · Maps/Waze',
    'geo-amenidad':      'Elige icono en el dock · click en el 360 para colocar · Arrastra para mover',
    'tone':              'Presets y sliders · solo tiñe la foto 360 · lotes intactos',
    'kmz-manip':         'Arrastra: mover · Shift+arrastre o rueda: escalar · Esc: salir'
  };

  function showDraw(tipo) {
    if (!_elHudDraw) return;
    if (_elTool)  _elTool.textContent  = TOOL_LABELS[tipo] || tipo;
    if (_elCount) _elCount.textContent = '0 vértices';
    if (_elHint)  _elHint.textContent  = TOOL_HINTS[tipo]  || 'Click para agregar puntos';
    _elHudDraw.style.display = 'flex';
  }

  function hideDraw() {
    if (_elHudDraw) _elHudDraw.style.display = 'none';
  }

  function updateDraw(tipo, count) {
    if (!_elHudDraw || _elHudDraw.style.display === 'none') return;
    if (_elCount) {
      _elCount.textContent = `${count} vértic${count === 1 ? 'e' : 'es'}`;
    }
  }

  // ─── ARRANQUE ─────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // ─── API PÚBLICA ────────────────────────────────────────────────────
  window.FerrariHUD = { updateCoords, showDraw, hideDraw, updateDraw, syncPlacement: _syncHudPlacement };

  console.log('[Ferrari/HUD] ✓ Módulo cargado');

})();
