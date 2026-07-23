/**
 * f-smart-pins.js — Smart Pins como HTML overlay (GPU compositing)
 *
 * ARQUITECTURA:
 *   En lugar de <g transform="..."> SVG (repinta toda la capa SVG cada frame),
 *   cada Smart Pin es un <div> HTML con style.transform = translate().
 *   El navegador los mueve como capas GPU independientes → cero repintado SVG.
 *   Mismo patrón que f-geo-pins.js, adaptado a los lotes con hasSmartPin.
 *
 * API pública:
 *   FerrariSmartPins.update()      — llamado desde RAF loop cada frame
 *   FerrariSmartPins.markDirty()   — fuerza rebuild (al agregar/quitar pin)
 *   FerrariSmartPins.reposition()  — solo repositiona (sin rebuild DOM)
 */

'use strict';

(function () {

  const PIN_R = 15;          // radio visual del círculo (px, en escala 1x)
  const PIN_DIAM = PIN_R * 2;

  // Capa HTML contenedora (se crea lazy sobre #panorama-container)
  let _layer = null;

  // Map: loteId → HTMLElement del pin
  let _elMap = new Map();

  // Scratch reutilizable para evitar alocaciones en el loop de proyección
  const _camScratch = { x: 0, y: 0, z: 0 };
  const _ptScratch  = [0, 0];

  let _dirty = true;   // true → rebuild completo en el próximo frame

  // ─── Capa HTML ────────────────────────────────────────────────────────

  function _ensureLayer() {
    if (_layer) return _layer;
    _layer = document.createElement('div');
    _layer.id = 'f-smart-pins-layer';
    _layer.setAttribute('aria-hidden', 'true');
    // Posicionada encima del SVG overlay, sin consumir eventos de mouse
    // (los propios pins tienen pointer-events: all)
    _layer.style.cssText = [
      'position:absolute',
      'inset:0',
      'pointer-events:none',
      'z-index:20',
      'overflow:hidden'
    ].join(';');
    const host = document.getElementById('panorama-container') || document.body;
    host.appendChild(_layer);
    return _layer;
  }

  // ─── Creación / actualización de un <div> de pin ─────────────────────

  function _createEl(lote) {
    const el = document.createElement('div');
    el.className = 'sph-pin';
    el.dataset.loteId = lote.id;
    el.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'will-change:transform',
      'transform-origin:center center',
      'pointer-events:all',
      'cursor:pointer',
      'user-select:none',
      `-webkit-tap-highlight-color:transparent`
    ].join(';');

    el.innerHTML = `
      <div class="sph-circle">
        <span class="sph-text"></span>
      </div>
    `;

    // Click → abrir panel del lote
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.FerrariUI && window.FerrariUI.openLotePanel) {
        window.FerrariUI.openLotePanel(lote.id);
      }
    });

    // Touch forward → no bloquear drag de cámara
    el.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    }, { passive: true });

    _fillEl(el, lote);
    return el;
  }

  function _fillEl(el, lote) {
    const estado = lote.estado || 'disponible';
    const titulo = lote.titulo || '';

    // Clases de estado
    el.className = 'sph-pin sph-' + estado;

    // Texto
    const span = el.querySelector('.sph-text');
    if (span) {
      if (estado === 'nodisponible') {
        span.textContent = 'ND';
        span.className = 'sph-text sph-text--legend';
      } else {
        span.textContent = titulo;
        span.className = 'sph-text';
      }
    }
  }

  // ─── Rebuild completo: crear/eliminar elementos según allDrawnLines ───

  function _rebuild() {
    const layer = _ensureLayer();
    const lines = window.allDrawnLines || [];

    // Construir set de ids de lotes con pin activo
    const wantIds = new Set();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.hasSmartPin && (l.tipo === 'lote-libre' || l.tipo === 'lote-organico' || l.tipo.startsWith('franja'))) {
        wantIds.add(l.id);
      }
    }

    // Eliminar pins que ya no existen
    _elMap.forEach((el, id) => {
      if (!wantIds.has(id)) {
        el.remove();
        _elMap.delete(id);
      }
    });

    // Crear o actualizar elementos
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!wantIds.has(l.id)) continue;

      let el = _elMap.get(l.id);
      if (!el) {
        el = _createEl(l);
        layer.appendChild(el);
        _elMap.set(l.id, el);
      } else {
        // Actualizar texto/estado solo si cambió (evitar reflow)
        const prevEstado = el.dataset.estado;
        const prevTitulo = el.dataset.titulo;
        const estado = l.estado || 'disponible';
        const titulo = l.titulo || '';
        if (prevEstado !== estado || prevTitulo !== titulo) {
          el.dataset.estado = estado;
          el.dataset.titulo = titulo;
          _fillEl(el, l);
        }
      }
    }
  }

  // ─── Reposicionamiento por frame ──────────────────────────────────────

  function _reposition() {
    if (!_layer || _elMap.size === 0) return;

    const FCam = window.FerrariCamera;
    if (!FCam) return;

    const proj = FCam.getProjectionParams();
    const lines = window.allDrawnLines || [];

    // Construir un map rápido loteId → line (evita .find() por pin)
    const lineById = Object.create(null);
    for (let i = 0; i < lines.length; i++) {
      lineById[lines[i].id] = lines[i];
    }

    const baseF      = 0.5 * proj.w;
    const scaleFactor = proj.f / baseF;
    const isMobile   = window.innerWidth < 768;

    _elMap.forEach((el, id) => {
      const line = lineById[id];
      if (!line) return;

      // Usar centroide cacheado del lote (lo calcula f-svg-paths)
      let centroid = line._pinCentroid;
      if (!centroid) {
        // Fallback: media aritmética esférica (igual que f-svg-paths)
        if (!line.puntos || line.puntos.length < 3) {
          el.style.display = 'none';
          return;
        }
        let sx = 0, sy = 0, sz = 0;
        for (let i = 0; i < line.puntos.length; i++) {
          const pr = line.puntos[i][0] * Math.PI / 180;
          const yr = line.puntos[i][1] * Math.PI / 180;
          sx += Math.cos(pr) * Math.sin(yr);
          sy += Math.sin(pr);
          sz += Math.cos(pr) * Math.cos(yr);
        }
        const len = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
        centroid = [
          Math.asin(Math.max(-1, Math.min(1, sy / len))) * 180 / Math.PI,
          Math.atan2(sx / len, sz / len) * 180 / Math.PI
        ];
        line._pinCentroid = centroid;
      }

      // Proyección usando scratch (cero alocaciones)
      _ptScratch[0] = centroid[0];
      _ptScratch[1] = centroid[1];
      const cam = FCam.getCamFastInto(_ptScratch, _camScratch);

      if (cam.z <= 0.0001) {
        if (el.style.display !== 'none') el.style.display = 'none';
        return;
      }

      const { px, py } = FCam.camToPixel(cam, proj);

      // Culling estricto: no tocar el DOM si está fuera de pantalla
      const margin = 60;
      if (px < -margin || px > proj.w + margin || py < -margin || py > proj.h + margin) {
        if (el.style.display !== 'none') el.style.display = 'none';
        return;
      }

      // Escala según zoom (misma fórmula que antes)
      const pinScale = Math.max(0.35, Math.min(1.3, Math.pow(scaleFactor, 0.5)));
      const adjScale = isMobile ? Math.max(0.3, Math.min(1.3, pinScale - 0.288)) : pinScale;

      // ── GPU move: translate centra el pin sobre (px, py) ──────────────
      // Offset de -PIN_R para centrar el círculo sobre el punto de anclaje
      const tx = (px - PIN_R * adjScale).toFixed(1);
      const ty = (py - PIN_R * adjScale).toFixed(1);
      const transform = `translate(${tx}px,${ty}px) scale(${adjScale.toFixed(3)})`;

      if (el._lastTransform !== transform) {
        el._lastTransform = transform;
        el.style.transform = transform;
      }
      if (el.style.display !== '') el.style.display = '';
    });
  }

  // ─── API pública ──────────────────────────────────────────────────────

  function markDirty() {
    _dirty = true;
  }

  function update() {
    if (_dirty) {
      _dirty = false;
      _rebuild();
    }
    _reposition();
  }

  window.FerrariSmartPins = { update, markDirty };

  console.log('[Ferrari/SmartPins] ✓ HTML overlay inicializado');

})();
