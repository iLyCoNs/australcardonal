/**
 * f-svg-sync.js — Delta sync entre allDrawnLines y DOMCache
 *
 * REGLA: NUNCA usar innerHTML para limpiar el SVG overlay.
 *        Solo .remove() elemento por elemento.
 * REGLA: Solo crear lo que es nuevo, solo borrar lo que ya no existe.
 * REGLA: #kpk-draw-overlay siempre debe ser el lastElementChild del SVG.
 *
 * Tipos SVG soportados:
 *   lote-libre, lote-organico → #layer-lotes
 *   calle                     → #layer-calles-asfalto
 *   calle-curva-arq2          → #layer-calles-arq2
 */

'use strict';

(function() {

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Mapeo tipo → id de capa SVG destino
  const LAYER_MAP = {
    'lote-libre':          'layer-lotes',
    'lote-organico':       'layer-lotes',
    'calle':               'layer-calles-asfalto',
    'calle-curva-arq2':    'layer-calles-arq2',
    'franja-grupo':        'layer-lotes',
    'franja-curva-grupo':  'layer-lotes',
    'costura':             'layer-calles-bordes',
    'kprano-capsule':      'layer-lotes',
    'fila-variable-lote':  'layer-lotes',
  };

  /**
   * Crea un elemento SVG con namespace correcto (Lección cross-browser).
   */
  function _createSVGEl(tag) {
    return document.createElementNS(SVG_NS, tag);
  }

  /**
   * Reenvía un evento al canvas de Pannellum para no bloquear el arrastre de la cámara
   * cuando el usuario hace clic sobre un polígono con pointer-events: all.
   */
  function _forwardToPannellum(e) {
    const canvas = document.querySelector('.pnlm-canvas');
    if (canvas) {
      // Clonamos el evento para el canvas
      let clonedEvent;
      if (e.constructor.name === 'TouchEvent') {
        clonedEvent = new TouchEvent(e.type, e);
      } else {
        clonedEvent = new MouseEvent(e.type, e);
      }
      canvas.dispatchEvent(clonedEvent);
    }
  }

  /**
   * Crea el grupo SVG (<g>) para una línea.
   * @param {Object} line — entrada de allDrawnLines
   * @returns {SVGGElement}
   */
  function _createLineGroup(line) {
    const g = _createSVGEl('g');
    g.setAttribute('data-id', line.id);
    g.setAttribute('data-tipo', line.tipo);
    g.classList.add('ferrari-line-group');


    const tipo = line.tipo;
    const estado = line.estado || 'disponible';

    const isLoteInteractivo = (tipo === 'lote-libre' || tipo === 'lote-organico' || tipo === 'franja-grupo' || tipo === 'kprano-capsule');
    if (isLoteInteractivo) {
      g.classList.add('lote-interactivo');
      g.style.pointerEvents = 'all';
      g.style.cursor = 'pointer';
      g.style.userSelect = 'none';
      g.style.webkitUserDrag = 'none';

      // Forward mousedown/touchstart para permitir drag de la cámara
      // Se quita passive para poder hacer preventDefault si es necesario en otras capas
      g.addEventListener('mousedown', (e) => {
          e.preventDefault(); // Evita que el navegador intente arrastrar el SVG (efecto fantasma)
          _forwardToPannellum(e);
      }, { passive: false });
      
      g.addEventListener('touchstart', (e) => {
          _forwardToPannellum(e);
      }, { passive: true });

      // Click Nativo para la herramienta Smart Pin
      g.addEventListener('click', (e) => {
        if (window.FerrariAddPin && window.FerrariAddPin.isActive()) {
          e.stopPropagation();
          window.FerrariAddPin.injectPin(line.id);
        }
      });

      // Glow futurista en vértices al pasar el cursor / pointer sobre el lote
      g.addEventListener('pointerenter', () => {
        g.classList.add('is-pointer');
        if (window.FerrariSVGPaths && window.FerrariSVGPaths.setHoveredLote) {
          window.FerrariSVGPaths.setHoveredLote(line.id);
        }
      });
      g.addEventListener('pointerleave', () => {
        g.classList.remove('is-pointer');
        if (window.FerrariSVGPaths && window.FerrariSVGPaths.setHoveredLote) {
          window.FerrariSVGPaths.setHoveredLote(null);
        }
      });
    }

    // ─── 2. Clases base ────────────────────────────────────────────────
    g.classList.add(`path-${tipo}`);
    
    // Solo aplicar clase de estado premium si tiene el Smart Pin activado
    if (line.hasSmartPin) {
      g.classList.add(`status-${estado}`);
    }

    // ─── 3. Paths principales ─────────────────────────────────────────
    if (tipo === 'calle' || tipo === 'calle-curva-arq2') {
      const p1 = _createSVGEl('path');
      p1.classList.add('path-calle-edge');
      g.appendChild(p1);

      const p2 = _createSVGEl('path');
      p2.classList.add('path-calle-centro');
      g.appendChild(p2);
    } 
    else if (tipo === 'lote-libre' || tipo === 'lote-organico') {
      const p1 = _createSVGEl('path');
      p1.classList.add('path-lote');
      g.appendChild(p1);
    }
    else {
      const p1 = _createSVGEl('path');
      p1.classList.add('path-default');
      g.appendChild(p1);
    }

    // Smart Pins ahora son elementos HTML gestionados por f-smart-pins.js.
    // No se crean <g> SVG para pins — evita repintado de capa SVG en cada frame.

    return g;
  }

  /**
   * syncSVGElements — Delta sync entre allDrawnLines y DOMCache.paths
   *
   * Algoritmo:
   * 1. Construir Set de ids actuales en allDrawnLines
   * 2. Para cada id en allDrawnLines que NO está en DOMCache → crear y añadir
   * 3. Para cada id en DOMCache que NO está en allDrawnLines → .remove() y borrar del cache
   * 4. Mover #kpk-draw-overlay al lastElementChild
   * 5. Marcar lastSyncedVersion = DOMCache.version
   */
  function syncSVGElements() {
    const lines    = window.allDrawnLines;
    const cache    = window.DOMCache.paths;

    // ── Paso 1: Set de ids actuales ──────────────────────────────────
    const currentIds = new Set(lines.map(l => l.id));

    // ── Paso 2: Crear elementos nuevos ───────────────────────────────
    for (const line of lines) {
      if (!cache.has(line.id)) {
        const layerId = LAYER_MAP[line.tipo] || 'layer-lotes';
        const layer   = document.getElementById(layerId);
        if (!layer) {
          console.warn('[Ferrari/SVGSync] Capa no encontrada:', layerId);
          continue;
        }

        const gNode = _createLineGroup(line);
        layer.appendChild(gNode);

        cache.set(line.id, {
          gNode,
          pathEls: Array.from(gNode.querySelectorAll('path')),
          pinGroup: null, // Smart Pins migrados a HTML overlay (f-smart-pins.js)
          tipo: line.tipo
        });
        // Notificar al HTML overlay de Smart Pins que debe reconstruirse
        if (window.FerrariSmartPins) window.FerrariSmartPins.markDirty();
      }
    }

    // ── Paso 3: Eliminar elementos que ya no existen ─────────────────
    for (const [id, entry] of cache.entries()) {
      if (!currentIds.has(id)) {
        // NUNCA innerHTML — usar .remove() directo (Lección 4)
        if (entry.gNode && entry.gNode.parentNode) {
          entry.gNode.remove();
        }
        cache.delete(id);
      }
    }

    // ── Paso 4: Garantizar draw overlay como lastElementChild ─────────
    const svg     = document.getElementById('loteo-svg');
    const overlay = document.getElementById('kpk-draw-overlay');
    if (svg && overlay && overlay !== svg.lastElementChild) {
      svg.appendChild(overlay);
    }

    // ── Paso 5: Marcar como sincronizado ─────────────────────────────
    window.DOMCache.lastSyncedVersion = window.DOMCache.version;
  }

  // ─── API PÚBLICA ────────────────────────────────────────────────────
  window.FerrariSVGSync = { 
    syncSVGElements
  };

  console.log('[Ferrari/SVGSync] ✓ Módulo inicializado');

})();
