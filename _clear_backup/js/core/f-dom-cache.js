/**
 * f-dom-cache.js — DOMCache: mapa O(1) de elementos SVG por lineId
 * 
 * REGLA: Toda creación/destrucción de elementos SVG pasa por este módulo.
 * NUNCA usar innerHTML para limpiar. Usar .remove() individual.
 * version se incrementa en f-state.js al mutar allDrawnLines.
 */

'use strict';

(function() {

  /**
   * DOMCache — estructura central de caché SVG
   * 
   * paths: Map<lineId, { gNode: SVGGElement, pathEls: SVGPathElement[], tipo: string }>
   * version: número incremental controlado por f-state.js
   * lastSyncedVersion: la última versión ya procesada por syncSVGElements
   */
  window.DOMCache = {
    paths:             new Map(),
    version:           0,
    lastSyncedVersion: -1
  };

  console.log('[Ferrari/DOMCache] ✓ Módulo inicializado');

})();
