/**
 * f-persist.js — Serialización y persistencia de allDrawnLines
 *
 * Funciones:
 *   save()   → JSON → localStorage['ferrari360_lines']
 *   load()   → localStorage → FerrariState.replaceAll()
 *   exportJSON() → descarga archivo .json
 *   importJSON(file) → carga desde File object
 *
 * También expone window.FerrariUI.showToast() para notificaciones globales.
 */

'use strict';

(function() {

  const STORAGE_KEY = 'ferrari360_lines';

  // ─── TOAST (UI global) ────────────────────────────────────────────

  let _toastTimer = null;

  function showToast(msg, type) {
    const el = document.getElementById('kpk-toast');
    if (!el) return;

    el.textContent = msg;
    el.className   = 'kpk-toast show';

    if (type === 'success') el.classList.add('toast-success');
    else if (type === 'error') el.classList.add('toast-error');
    else if (type === 'info')  el.classList.add('toast-info');

    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      el.classList.remove('show');
    }, 2800);
  }

  function save() {
    try {
      // 1. Guardar siempre en localStorage como capa de seguridad inmediata
      const jsonStr = JSON.stringify(window.allDrawnLines, null, 2);
      localStorage.setItem(STORAGE_KEY, jsonStr);
      if (window.FerrariGeo && window.FerrariGeo.saveLocal) {
        window.FerrariGeo.saveLocal();
      }
      try {
        localStorage.setItem('ferrari360_datos', JSON.stringify(_buildDatosPayload()));
      } catch (e) {}
    } catch(e) {
      console.error('[Ferrari/Persist] Error guardando local:', e);
      return;
    }

    // 2. Si hay token GitHub disponible → subir a la nube
    let token = localStorage.getItem('ferrari_github_token');
    const isGod = new URLSearchParams(window.location.search).get('mode') === 'god';
    
    if (!token && isGod) {
       token = prompt("Modo Dios: No se encontró un Token de GitHub.\nPor favor ingresa tu Token (PAT) para guardar en la nube:");
       if (token) {
           localStorage.setItem('ferrari_github_token', token.trim());
       }
    }

    if (token) {
      _pushToGitHub(token);
    } else {
      const count = window.allDrawnLines.length;
      const pins = (window.FerrariGeo && window.FerrariGeo.pins) ? window.FerrariGeo.pins.length : 0;
      showToast(`✓ Guardado local (${count} lotes · ${pins} pins · origen/norte)`, 'success');
    }
  }

  // ─── PUSH A GITHUB ────────────────────────────────────────────────

  function _repoMeta() {
    return {
      OWNER: localStorage.getItem('ferrari_github_owner') || 'iLyCoNs',
      REPO: localStorage.getItem('ferrari_github_repo') || 'alercepatagon360',
      BRANCH: localStorage.getItem('ferrari_github_branch') || 'main'
    };
  }

  function _buildDatosPayload() {
    const geo = (window.FerrariGeo && window.FerrariGeo.toJSON)
      ? window.FerrariGeo.toJSON()
      : { version: 1, droneOrigin: null, northOffset: 0, pins: [] };
    return {
      version: 1,
      updatedAt: Date.now(),
      lotes: window.allDrawnLines || [],
      geo
    };
  }

  async function _putGitHubJson(token, OWNER, REPO, BRANCH, path, obj, message) {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
    let sha = null;
    try {
      const check = await fetch(url, {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
      });
      if (check.ok) sha = (await check.json()).sha;
    } catch (e) {}

    const jsonStr = JSON.stringify(obj, null, 2);
    const body = {
      message,
      content: btoa(unescape(encodeURIComponent(jsonStr))),
      branch: BRANCH
    };
    if (sha) body.sha = sha;

    const r = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      let errMsg = 'Error GitHub';
      try { errMsg = (await r.json()).message || errMsg; } catch (e) {}
      const err = new Error(errMsg);
      err.status = r.status;
      throw err;
    }
    return r.json();
  }

  async function _pushToGitHub(token) {
    let { OWNER, REPO, BRANCH } = _repoMeta();
    showToast('☁ Guardando en GitHub (datos.json)…', 'info');

    try {
      if (window.FerrariGeo && window.FerrariGeo.saveLocal) window.FerrariGeo.saveLocal();

      const lotes = window.allDrawnLines || [];
      const geo = (window.FerrariGeo && window.FerrariGeo.toJSON)
        ? window.FerrariGeo.toJSON()
        : { version: 1, droneOrigin: null, northOffset: 0, pins: [] };
      const datos = _buildDatosPayload();
      const count = lotes.length;
      const pinCount = (geo.pins || []).length;

      try {
        // 1) Archivo unificado: origen dron, norte, pins, lotes
        await _putGitHubJson(token, OWNER, REPO, BRANCH, 'data/datos.json', datos,
          `Guardar: ${count} elementos · ${pinCount} pins · origen/norte`);
        // 2) Compat admin / legacy
        await _putGitHubJson(token, OWNER, REPO, BRANCH, 'data/lotes.json', lotes,
          `Guardar lotes (${count})`);
        await _putGitHubJson(token, OWNER, REPO, BRANCH, 'data/geo.json', geo,
          `Guardar geo: origen/norte/${pinCount} pins`);
      } catch (firstErr) {
        if (firstErr.status === 404 || firstErr.status === 401 ||
            firstErr.message === 'Not Found' || firstErr.message === 'Bad credentials') {
          const no = prompt(`Repositorio no encontrado o token inválido.\nDueño: ${OWNER}\nRepo: ${REPO}\n\nUsuario GitHub:`, OWNER);
          if (!no) throw new Error('Cancelado');
          const nr = prompt('Nombre del repositorio:', REPO);
          if (!nr) throw new Error('Cancelado');
          const nt = prompt('Token (PAT):', token || '');
          if (!nt) throw new Error('Cancelado');
          localStorage.setItem('ferrari_github_owner', no.trim());
          localStorage.setItem('ferrari_github_repo', nr.trim());
          localStorage.setItem('ferrari_github_token', nt.trim());
          return _pushToGitHub(nt.trim());
        }
        throw firstErr;
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(lotes, null, 2));
      try {
        localStorage.setItem('ferrari360_datos', JSON.stringify(datos));
      } catch (e) {}

      showToast(`✓ Guardado en datos.json (${count} lotes · ${pinCount} pins)`, 'success');
      console.log('[Ferrari/Persist] ✓ Push OK → datos.json + lotes.json + geo.json');
      if (window.FerrariGeo && window.FerrariGeo.markClean) {
        window.FerrariGeo.markClean();
      }
      try { document.dispatchEvent(new CustomEvent('ferrari:lotes-changed')); } catch (e) {}

    } catch (e) {
      showToast('Error GitHub: ' + e.message, 'error');
      console.error('[Ferrari/Persist] Error push GitHub:', e);
    }
  }

  // ─── CARGAR ──────────────────────────────────────────────────────

  function load() {
    try {
      // Preferir snapshot unificado local
      const rawDatos = localStorage.getItem('ferrari360_datos');
      if (rawDatos) {
        const pack = JSON.parse(rawDatos);
        if (pack && Array.isArray(pack.lotes)) {
          _applyLotes(pack.lotes);
          if (pack.geo && window.FerrariGeo) {
            window.FerrariGeo.fromJSON(pack.geo);
            window.FerrariGeo.saveLocal();
          }
          showToast(`✓ Cargado datos.json local (${pack.lotes.length})`, 'success');
          return;
        }
      }

      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        showToast('No hay datos guardados.', 'info');
        return;
      }
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) throw new Error('Formato inválido');
      _applyLotes(data);
      if (window.FerrariGeo) window.FerrariGeo.loadLocal();
      showToast(`✓ Cargado (${data.length} elemento${data.length !== 1 ? 's' : ''})`, 'success');
    } catch (e) {
      showToast('Error al cargar: ' + e.message, 'error');
      console.error('[Ferrari/Persist] Error cargando:', e);
    }
  }

  function _applyLotes(data) {
    data.forEach(l => {
      if (l && typeof l === 'object') {
        delete l.pinPosition;
        delete l.pinPos;
      }
    });
    window.FerrariState.replaceAll(data);
    _rebuildStreetNetwork();
    window.FerrariCamera.markDirty();
    try { document.dispatchEvent(new CustomEvent('ferrari:lotes-changed')); } catch (e) {}
  }

  function _rebuildStreetNetwork() {
    if (!window.FerrariStreetNetwork || !window.FerrariStreetNetwork.integrateStreet) return;
    const lines = window.allDrawnLines || [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l && (l.tipo === 'calle' || l.tipo === 'calle-curva-arq2')) {
        window.FerrariStreetNetwork.integrateStreet(l.id);
      }
    }
  }

  // ─── EXPORTAR ────────────────────────────────────────────────────

  function exportJSON() {
    try {
      const pack = _buildDatosPayload();
      const data = JSON.stringify(pack, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const filename = `datos_${ts}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      showToast(`✓ Exportado: ${filename}`, 'success');
    } catch (e) {
      showToast('Error al exportar: ' + e.message, 'error');
    }
  }

  // ─── IMPORTAR ────────────────────────────────────────────────────

  function importJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    input.addEventListener('change', function () {
      const file = input.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function (ev) {
        try {
          const parsed = JSON.parse(ev.target.result);
          let lotes = null;
          let geo = null;
          if (Array.isArray(parsed)) {
            lotes = parsed;
          } else if (parsed && Array.isArray(parsed.lotes)) {
            lotes = parsed.lotes;
            geo = parsed.geo || null;
          } else {
            throw new Error('JSON inválido (espera array o datos.json)');
          }
          _applyLotes(lotes);
          if (geo && window.FerrariGeo) {
            window.FerrariGeo.fromJSON(geo);
            window.FerrariGeo.saveLocal();
          }
          showToast(`✓ Importado: ${lotes.length} elementos`, 'success');
        } catch (e) {
          showToast('Error al importar: ' + e.message, 'error');
        }
      };
      reader.readAsText(file);
    }, false);

    input.click();
  }

  async function _fetchRepoJson(OWNER, REPO, BRANCH, path, token) {
    if (token) {
      const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?t=${Date.now()}`;
      const r = await fetch(url, {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
      });
      if (!r.ok) return null;
      const meta = await r.json();
      return JSON.parse(decodeURIComponent(escape(atob(meta.content.replace(/\n/g, '')))));
    }
    // Misma origen (Pages / local)
    try {
      const local = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
      if (local.ok) return await local.json();
    } catch (e) {}
    const rawUrl = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path}?t=${Date.now()}`;
    const r = await fetch(rawUrl);
    if (!r.ok) return null;
    return await r.json();
  }

  /**
   * Carga preferente data/datos.json (unificado).
   * Fallback: lotes.json + geo.json
   */
  async function _loadFromGitHubRaw() {
    const { OWNER, REPO, BRANCH } = _repoMeta();
    const token = localStorage.getItem('ferrari_github_token');

    try {
      const datos = await _fetchRepoJson(OWNER, REPO, BRANCH, 'data/datos.json', token);
      if (datos && Array.isArray(datos.lotes)) {
        _applyLotes(datos.lotes);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(datos.lotes));
        try { localStorage.setItem('ferrari360_datos', JSON.stringify(datos)); } catch (e) {}
        if (datos.geo && window.FerrariGeo) {
          if (window.FerrariGeo.applyRemote) {
            window.FerrariGeo.applyRemote(datos.geo);
          } else {
            window.FerrariGeo.fromJSON(datos.geo);
            window.FerrariGeo.saveLocal();
          }
        }
        console.log('[Ferrari/Persist] datos.json cargado:', datos.lotes.length, 'lotes ·',
          (datos.geo && datos.geo.pins ? datos.geo.pins.length : 0), 'pins',
          window.FerrariGeo && window.FerrariGeo.droneOrigin ? '· origen OK' : '· sin origen');
        return;
      }

      const lotes = await _fetchRepoJson(OWNER, REPO, BRANCH, 'data/lotes.json', token);
      if (Array.isArray(lotes)) {
        _applyLotes(lotes);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lotes));
        console.log('[Ferrari/Persist] lotes.json cargado:', lotes.length);
      }
      const geo = await _fetchRepoJson(OWNER, REPO, BRANCH, 'data/geo.json', token);
      if (geo && window.FerrariGeo) {
        if (window.FerrariGeo.applyRemote) {
          window.FerrariGeo.applyRemote(geo);
        } else {
          window.FerrariGeo.fromJSON(geo);
          window.FerrariGeo.saveLocal();
        }
        console.log('[Ferrari/Persist] geo.json cargado:', (geo.pins || []).length, 'pins');
      }
    } catch (e) {
      console.log('[Ferrari/Persist] Error cargando datos remotos.', e.message);
    }
  }

  // ─── BIND BOTONES ────────────────────────────────────────────────

  function _bindButtons() {
    const btnSave   = document.getElementById('action-save');
    const btnLoad   = document.getElementById('action-load');
    const btnExport = document.getElementById('action-export');

    btnSave   && btnSave.addEventListener('click',   save,       false);
    btnLoad   && btnLoad.addEventListener('click',   load,       false);
    btnExport && btnExport.addEventListener('click', exportJSON, false);

    // Ctrl+S global para guardar rápido
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    }, false);

    // Auto-load: primero localStorage, luego intenta GitHub raw (prioridad)
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.length > 0) {
          window.FerrariState.replaceAll(data);
          _rebuildStreetNetwork();
          window.FerrariCamera.markDirty();
          console.log('[Ferrari/Persist] Auto-cargado:', data.length, 'líneas desde localStorage');
        }
      } catch(e) { /* ignorar */ }
    }

    // Intentar cargar desde GitHub Pages (data/lotes.json)
    _loadFromGitHubRaw();

    // Modo Dios: si ?mode=god en URL, abrir panel de herramientas automáticamente
    if (new URLSearchParams(window.location.search).get('mode') === 'god') {
      setTimeout(() => {
        if (window.FerrariPanel && window.FerrariPanel.openPanel) {
          window.FerrariPanel.openPanel();
        } else {
          const panel = document.getElementById('kpk-panel');
          if (panel && !panel.classList.contains('kpk-panel--open')) {
            panel.classList.add('kpk-panel--open');
            document.body.classList.add('f-tool-mode');
          }
        }
        console.log('[Ferrari/Persist] Modo Dios activado — panel abierto');
      }, 800);
    }
  }

  // ─── ARRANQUE ─────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bindButtons, { once: true });
  } else {
    _bindButtons();
  }

  // ─── API PÚBLICA ────────────────────────────────────────────────────
  window.FerrariUI = { showToast, save, load, exportJSON, importJSON };

  console.log('[Ferrari/Persist] ✓ Módulo cargado');

})();
