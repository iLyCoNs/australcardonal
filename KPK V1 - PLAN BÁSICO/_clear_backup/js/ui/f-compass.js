/**
 * f-compass.js — Brújula premium circular (esquina superior derecha)
 * Disco flotante sin panel cuadrado. Rota según yaw + northOffset.
 */

'use strict';

(function () {

  let _root = null;
  let _dial = null;
  let _label = null;

  function _ensure() {
    if (_root) return;
    _root = document.createElement('div');
    _root.id = 'f-compass';
    _root.setAttribute('aria-label', 'Brújula');
    _root.innerHTML = `
      <div class="fc-orb">
        <div class="fc-glass" aria-hidden="true"></div>
        <div class="fc-dial" id="fc-dial">
          <span class="fc-cardinal fc-n">N</span>
          <span class="fc-cardinal fc-e">E</span>
          <span class="fc-cardinal fc-s">S</span>
          <span class="fc-cardinal fc-w">O</span>
          <span class="fc-tick" style="--a:45deg"></span>
          <span class="fc-tick" style="--a:135deg"></span>
          <span class="fc-tick" style="--a:225deg"></span>
          <span class="fc-tick" style="--a:315deg"></span>
          <div class="fc-needle">
            <div class="fc-blade fc-blade--n"></div>
            <div class="fc-blade fc-blade--s"></div>
          </div>
        </div>
        <div class="fc-hub" aria-hidden="true"></div>
        <div class="fc-bezel" aria-hidden="true"></div>
      </div>
      <div class="fc-bearing" id="fc-bearing">—°</div>
    `;
    const hud = document.getElementById('kpk-hud-layer') || document.getElementById('panorama-container') || document.body;
    hud.appendChild(_root);
    _dial = document.getElementById('fc-dial');
    _label = document.getElementById('fc-bearing');
  }

  function refresh() {
    _ensure();
    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return;

    let yaw = 0;
    try { yaw = viewer.getYaw(); } catch (e) { return; }

    const northOff = (window.FerrariGeo && window.FerrariGeo.northOffset) || 0;
    // El dial (N fijo en el anillo) gira con la cámara; la aguja apunta al norte
    const rot = -(yaw + northOff);
    if (_dial) _dial.style.transform = `rotate(${rot.toFixed(2)}deg)`;

    let bearing = ((yaw + northOff) % 360 + 360) % 360;
    if (_label) _label.textContent = `${bearing.toFixed(0)}°`;
  }

  function start() {
    _ensure();
    refresh();
  }

  window.FerrariCompass = { refresh, start };

  console.log('[Ferrari/Compass] ✓ Módulo inicializado');

})();
