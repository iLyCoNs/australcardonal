/**
 * f-tone.js — Look / tonos live del panorama 360 (CSS filter en canvas Pannellum)
 */
'use strict';

(function () {
  var STORAGE_KEY = 'ferrari360_tone';
  var _active = false;
  var _bound = false;

  var DEFAULTS = {
    brightness: 1,
    contrast: 1,
    saturate: 1,
    warmth: 0,
    vignette: 0
  };

  var PRESETS = {
    natural: Object.assign({}, DEFAULTS),
    vivo: { brightness: 1.04, contrast: 1.08, saturate: 1.28, warmth: -4, vignette: 0.12 },
    calido: { brightness: 1.02, contrast: 1.05, saturate: 1.1, warmth: 18, vignette: 0.18 },
    niebla: { brightness: 1.06, contrast: 0.92, saturate: 0.78, warmth: -6, vignette: 0.22 },
    reset: Object.assign({}, DEFAULTS)
  };

  var _state = Object.assign({}, DEFAULTS);

  function _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function getState() {
    return Object.assign({}, _state);
  }

  function _ensureVignetteEl() {
    var host = document.getElementById('pannellum-viewer');
    if (!host) return null;
    var el = document.getElementById('kpk-tone-vignette');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kpk-tone-vignette';
      el.className = 'kpk-tone-vignette';
      el.setAttribute('aria-hidden', 'true');
      host.appendChild(el);
    }
    return el;
  }

  function apply(state) {
    if (state) _state = Object.assign({}, DEFAULTS, state);
    var b = _clamp(Number(_state.brightness) || 1, 0.6, 1.5);
    var c = _clamp(Number(_state.contrast) || 1, 0.6, 1.6);
    var s = _clamp(Number(_state.saturate) || 1, 0.2, 2);
    var w = _clamp(Number(_state.warmth) || 0, -30, 30);
    var v = _clamp(Number(_state.vignette) || 0, 0, 0.55);
    _state = { brightness: b, contrast: c, saturate: s, warmth: w, vignette: v };

    var hue = w * 0.35;
    var sepia = Math.max(0, w) / 100;
    var filter =
      'brightness(' + b + ') contrast(' + c + ') saturate(' + s + ')' +
      ' hue-rotate(' + hue + 'deg) sepia(' + sepia.toFixed(3) + ')';

    var root = document.getElementById('pannellum-viewer');
    if (root) {
      root.style.setProperty('--kpk-tone-filter', filter);
      root.classList.toggle('kpk-tone-active', b !== 1 || c !== 1 || s !== 1 || w !== 0);
    }

    var vig = _ensureVignetteEl();
    if (vig) {
      vig.style.opacity = String(v);
      vig.style.display = v > 0.01 ? 'block' : 'none';
    }

    _syncSliders();
  }

  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
    } catch (e) {}
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function applySaved() {
    var saved = loadLocal();
    if (!saved) {
      try {
        var pack = JSON.parse(localStorage.getItem('ferrari360_datos') || '{}');
        if (pack && pack.tone) saved = pack.tone;
      } catch (e) {}
    }
    if (saved) apply(saved);
    else apply(DEFAULTS);
  }

  function toJSON() {
    return getState();
  }

  function fromJSON(obj) {
    if (!obj || typeof obj !== 'object') return;
    apply(obj);
    saveLocal();
  }

  function applyPreset(id) {
    var p = PRESETS[id] || PRESETS.natural;
    apply(p);
    saveLocal();
  }

  function _readSlidersIntoState() {
    var map = {
      brightness: 'tone-brightness',
      contrast: 'tone-contrast',
      saturate: 'tone-saturate',
      warmth: 'tone-warmth',
      vignette: 'tone-vignette'
    };
    Object.keys(map).forEach(function (k) {
      var el = document.getElementById(map[k]);
      if (!el) return;
      var raw = parseFloat(el.value);
      if (k === 'vignette') _state[k] = raw / 100;
      else if (k === 'warmth') _state[k] = raw;
      else _state[k] = raw / 100;
    });
  }

  function _syncSliders() {
    var pairs = [
      ['tone-brightness', _state.brightness * 100, 'tone-brightness-val', Math.round(_state.brightness * 100) + '%'],
      ['tone-contrast', _state.contrast * 100, 'tone-contrast-val', Math.round(_state.contrast * 100) + '%'],
      ['tone-saturate', _state.saturate * 100, 'tone-saturate-val', Math.round(_state.saturate * 100) + '%'],
      ['tone-warmth', _state.warmth, 'tone-warmth-val', (_state.warmth > 0 ? '+' : '') + Math.round(_state.warmth)],
      ['tone-vignette', _state.vignette * 100, 'tone-vignette-val', Math.round(_state.vignette * 100) + '%']
    ];
    pairs.forEach(function (row) {
      var el = document.getElementById(row[0]);
      var lab = document.getElementById(row[2]);
      if (el && document.activeElement !== el) el.value = String(row[1]);
      if (lab) lab.textContent = row[3];
    });
  }

  function _showPanel(show) {
    var panel = document.getElementById('tone-look-panel');
    if (panel) panel.style.display = show ? 'block' : 'none';
  }

  function activate() {
    window.FerrariTools.deactivateAllTools();
    _active = true;
    window.currentTool = 'tone';
    _showPanel(true);
    apply(_state);
    window.FerrariHUD && window.FerrariHUD.showDraw('tone');
    window.FerrariUI && window.FerrariUI.showToast('Tonos del 360: ajusta look en vivo. Los lotes no se tiñen.', 'info');
  }

  function deactivate() {
    if (!_active) return;
    _active = false;
    _showPanel(false);
    window.FerrariHUD && window.FerrariHUD.hideDraw();
  }

  function isActive() { return _active; }

  function bindEvents() {
    if (_bound) return;
    _bound = true;

    ['tone-brightness', 'tone-contrast', 'tone-saturate', 'tone-warmth', 'tone-vignette'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function () {
        _readSlidersIntoState();
        apply(_state);
        saveLocal();
      });
    });

    document.querySelectorAll('[data-tone-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyPreset(btn.getAttribute('data-tone-preset'));
      });
    });

    var resetBtn = document.getElementById('tone-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        applyPreset('reset');
      });
    }
  }

  // Auto-apply early if DOM ready (viewer may load later too)
  function _boot() {
    applySaved();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot, { once: true });
  } else {
    _boot();
  }

  window.FerrariTone = {
    STORAGE_KEY: STORAGE_KEY,
    PRESETS: PRESETS,
    activate: activate,
    deactivate: deactivate,
    isActive: isActive,
    bindEvents: bindEvents,
    apply: apply,
    applySaved: applySaved,
    applyPreset: applyPreset,
    getState: getState,
    toJSON: toJSON,
    fromJSON: fromJSON,
    saveLocal: saveLocal
  };
})();
