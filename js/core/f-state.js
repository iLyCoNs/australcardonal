/**
 * f-state.js — Fuente de Verdad de Datos Ferrari360
 * 
 * REGLA: allDrawnLines es inmutable desde fuera.
 * SOLO se modifica via funciones de este módulo.
 * Cada modificación incrementa DOMCache.version.
 */

'use strict';

(function() {

  // ─── FUENTE DE VERDAD ───────────────────────────────────────────────
  window.allDrawnLines = [];

  // ─── CRUD PÚBLICO ──────────────────────────────────────────────────

  /**
   * Genera un UUID v4 simple
   */
  function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Agrega una nueva línea a allDrawnLines.
   * @param {Object} lineData — { tipo, puntos, ...metadatos }
   * @returns {string} id asignado
   */
  function addLine(lineData) {
    if (!lineData || !lineData.tipo || !Array.isArray(lineData.puntos)) {
      console.error('[Ferrari/State] addLine: datos inválidos', lineData);
      return null;
    }
    const entry = Object.assign({}, lineData, { id: lineData.id || generateId() });
    window.allDrawnLines.push(entry);
    _notifyChange();
    return entry.id;
  }

  /**
   * Elimina una línea por id.
   * @param {string} id
   * @returns {boolean} true si se eliminó
   */
  function removeLine(id) {
    const idx = window.allDrawnLines.findIndex(l => l.id === id);
    if (idx === -1) return false;
    window.allDrawnLines.splice(idx, 1);
    _notifyChange();
    return true;
  }

  /**
   * Actualiza propiedades de una línea existente.
   * @param {string} id
   * @param {Object} patch — propiedades a actualizar
   * @returns {boolean}
   */
  function updateLine(id, patch) {
    const line = window.allDrawnLines.find(l => l.id === id);
    if (!line) return false;
    Object.assign(line, patch);
    _notifyChange();
    return true;
  }

  /**
   * Retorna una línea por id (referencia directa — no mutar desde fuera).
   */
  function getLine(id) {
    return window.allDrawnLines.find(l => l.id === id) || null;
  }

  /**
   * Limpia TODAS las líneas.
   */
  function clearAll() {
    window.allDrawnLines.length = 0;
    _notifyChange();
  }

  /**
   * Reemplaza todas las líneas (para carga de datos).
   * @param {Array} lines
   */
  function replaceAll(lines) {
    if (!Array.isArray(lines)) return;
    window.allDrawnLines.length = 0;
    lines.forEach(l => window.allDrawnLines.push(l));
    _notifyChange();
  }

  /**
   * Notifica cambio incrementando la versión del DOMCache.
   * DOMCache puede no estar inicializado aún en arranque, se verifica.
   */
  function _notifyChange() {
    if (window.DOMCache) {
      window.DOMCache.version++;
    }
  }

  // ─── API PÚBLICA ────────────────────────────────────────────────────
  window.FerrariState = {
    addLine,
    removeLine,
    updateLine,
    getLine,
    clearAll,
    replaceAll,
    generateId
  };

  console.log('[Ferrari/State] ✓ Módulo inicializado');

})();
