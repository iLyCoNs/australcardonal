/**
 * config.local.example.js — PLANTILLA (SÍ se sube al repo)
 *
 * Uso:
 *   cp config.local.example.js config.local.js
 *   → Edita config.local.js
 *   → config.local.js está en .gitignore
 *
 * IMPORTANTE: hacer MERGE con config.js. Un string vacío NO debe borrar keys.
 */
(function () {
  var base = window.KPK_CONFIG || {};
  var local = {
    configVersion: 13,
    aiProvider: 'lightning',
    voiceMode: 'jarvis_charon',
    // Puente Dalia/Jorge en VPS (HTTPS). Con esto GitHub Pages ya no necesita proxy en tu PC.
    // ttsProxyUrl: 'https://TU-IP-O-DOMINIO:8787',
    aiKeys: {
      // Deja gemini vacío para heredar la de config.js (Charon)
      openrouter: '',
      groq: '',
      lightning: ''
    }
  };

  function mergeKeys(a, b) {
    var out = Object.assign({}, a || {});
    Object.keys(b || {}).forEach(function (k) {
      var v = b[k];
      if (v === '' || v == null) return;
      out[k] = v;
    });
    return out;
  }

  window.KPK_CONFIG = Object.assign({}, base, local, {
    aiKeys: mergeKeys(base.aiKeys, local.aiKeys)
  });
})();
