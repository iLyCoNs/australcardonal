/**
 * f-init.js — Inicialización de Ferrari360
 *
 * Responsabilidades:
 * 1. Inicializar Pannellum viewer
 * 2. Esperar evento 'load' de Pannellum
 * 3. Exponer window.Ferrari con referencias principales
 * 4. Arrancar el rAF loop
 * 5. Registrar resize handler
 *
 * REGLA: Los listeners de eventos se registran UNA SOLA VEZ aquí.
 *        El flag _initialized previene re-registro.
 */

'use strict';

(function() {

  let _initialized = false;

  /**
   * Intenta obtener un contexto WebGL 1.0/2.0 real.
   * Pannellum 2.5.7 usa "experimental-webgl" con {alpha:false, depth:false}.
   * En algunos dispositivos (Samsung Galaxy Tab, power-saving mode) el contexto
   * puede fallar con ciertos parámetros. Probamos combinaciones.
   */
  function _tryWebGL() {
    var c = document.createElement('canvas');
    var attrs = [
      { alpha: false, depth: false },
      { alpha: false, depth: false, powerPreference: 'low-power' },
      { alpha: false, depth: false, failIfMajorPerformanceCaveat: false }
    ];
    var names = ['webgl2', 'webgl', 'experimental-webgl'];
    var gl = null;
    for (var a = 0; a < attrs.length && !gl; a++) {
      for (var n = 0; n < names.length && !gl; n++) {
        try { gl = c.getContext(names[n], attrs[a]); } catch (e) {}
      }
    }
    return gl;
  }

  /**
   * Detecta Samsung Galaxy Tab / dispositivo Samsung.
   */
  function _isSamsung() {
    var ua = navigator.userAgent.toLowerCase();
    return ua.indexOf('samsung') >= 0 ||
           ua.indexOf('galaxy') >= 0 ||
           (ua.indexOf('android') >= 0 && ua.indexOf('sm-') >= 0);
  }

  /**
   * Punto de entrada principal. Llamado en DOMContentLoaded.
   */
  function init() {
    if (_initialized) {
      console.warn('[Ferrari/Init] Ya inicializado, skip');
      return;
    }
    _initialized = true;

    console.log('[Ferrari/Init] Arrancando Ferrari360...');

    // ─── VERIFICAR WEBGL + DETECTAR TAMAÑO MÁXIMO DE TEXTURA ────
    var gl = _tryWebGL();
    if (!gl) {
      _showWebGLError();
      return;
    }
    // Leer MAX_TEXTURE_SIZE antes de perder el contexto
    var maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    console.log('[Ferrari/Init] MAX_TEXTURE_SIZE:', maxTexSize);
    var lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();

    // Pasar el valor al módulo de device para evitar crear otro contexto
    if (window.FerrariDevice && window.FerrariDevice.setMaxTextureSize) {
      window.FerrariDevice.setMaxTextureSize(maxTexSize);
    }

    // ─── PREPARAR PANORAMA (con downscaling si es necesario) ──────
    _bootViewer();
  }

  let _viewerBootTries = 0;
  function _bootViewer(forcedMaxWidth) {
    _viewerBootTries++;
    // Cap DPR antes de crear el canvas WebGL (más FPS en tablets)
    _applyPerfCapsEarly();
    _preparePanorama(forcedMaxWidth).then(function(source) {
      _createViewer(source);
    }).catch(function(err) {
      console.error('[Ferrari/Init] Error preparando panorama:', err);
      if (_viewerBootTries < 3 && window.FerrariDevice && window.FerrariDevice.stepDown) {
        var next = window.FerrariDevice.stepDown();
        console.warn('[Ferrari/Init] Reintento con maxWidth', next.maxWidth);
        _bootViewer(next.maxWidth);
        return;
      }
      var container = document.getElementById('pannellum-viewer');
      if (container) {
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;' +
          'color:#fff;background:#1a1a2e;font-family:sans-serif;font-size:14px;padding:20px;text-align:center">' +
          'Error al cargar la imagen 360°. Recarga o prueba <code>?tex=2048</code>.</div>';
      }
    });
  }

  /**
   * Prepara la fuente del panorama: detecta el dispositivo, y si es necesario
   * escala la imagen a una resolución soportable antes de pasarla a Pannellum.
   * @returns {Promise<HTMLCanvasElement|string>} canvas (dynamic) o URL string
   */
  function _preparePanorama(forcedMaxWidth) {
    var info = window.FerrariDevice.detect();
    var tier = info.tier;
    var maxWidth = forcedMaxWidth || info.maxWidth;
    var maxTex = info.maxTextureSize || 0;
    // Nunca pedir más que MAX_TEXTURE_SIZE (Pannellum usa width/2 vs maxTex en equirect)
    if (maxTex > 0) {
      // Pannellum equirect: falla si max(width/2, height) > MAX_TEXTURE_SIZE
      maxWidth = Math.min(maxWidth, maxTex * 2);
      if (maxTex < 4096) maxWidth = Math.min(maxWidth, maxTex);
    }
    var origW = window.FerrariDevice.getOriginalWidth();
    var needsDl = origW > maxWidth || !!forcedMaxWidth;

    document.body.classList.remove('ferrari-device-high', 'ferrari-device-mid', 'ferrari-device-low');
    document.body.classList.add('ferrari-device-' + tier);
    if (info.isTablet) document.body.classList.add('ferrari-device-tablet');

    console.log('[Ferrari/Init] Device tier:', tier,
      '| maxWidth:', maxWidth, '| downscale:', needsDl,
      '| tablet:', !!info.isTablet);

    if (!needsDl) {
      return Promise.resolve('loteo360.jpg');
    }

    _showLoadingMessage('Ajustando resolución 360° (' + maxWidth + 'px)…');

    return _loadAndScaleImage('loteo360.jpg', maxWidth).then(function(canvas) {
      _hideLoadingMessage();
      return canvas;
    });
  }

  /**
   * Carga la imagen equirectangular y la escala al ancho máximo indicado
   * usando createImageBitmap (con resize) o fallback Image + canvas 2D.
   * @param {string} url
   * @param {number} maxWidth
   * @returns {Promise<HTMLCanvasElement>}
   */
  function _loadAndScaleImage(url, maxWidth) {
    // Intentar createImageBitmap + fetch (decodifica + redimensiona en un paso,
    // sin el buffer intermedio de 288MB de la imagen original)
    if (window.createImageBitmap && window.fetch) {
      return _loadAndScaleWithBitmap(url, maxWidth);
    }
    // Fallback: Image + canvas 2D
    return _fallbackLoadAndScale(url, maxWidth);
  }

  /**
   * Carga y escala usando createImageBitmap (Chrome 76+, Firefox 98+, Safari 15.4+).
   * Decodifica directamente al tamaño destino, ahorrando memoria.
   */
  function _loadAndScaleWithBitmap(url, maxWidth) {
    return fetch(url).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function(blob) {
      // createImageBitmap con resize puede fallar si el navegador no lo soporta.
      // Encadenar para que la rejection del resize vaya al .catch de abajo.
      return createImageBitmap(blob, {
        resizeWidth: maxWidth,
        resizeQuality: 'high'
      }).then(function(bitmap) {
        var canvas = document.createElement('canvas');
        canvas.width  = bitmap.width;
        canvas.height = bitmap.height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        console.log('[Ferrari/Init] Imagen escalada vía createImageBitmap:',
          maxWidth, '→', canvas.width + 'x' + canvas.height);
        return canvas;
      });
    }).catch(function(err) {
      // Fallback universal: Image + canvas 2D (funciona en todos los navegadores)
      console.warn('[Ferrari/Init] createImageBitmap falló, usando fallback Image:', err);
      return _fallbackLoadAndScale(url, maxWidth);
    });
  }

  /** Fallback para navegadores sin createImageBitmap.resize */
  function _fallbackLoadAndScale(url, maxWidth) {
    return new Promise(function(resolve, reject) {
      var img = new Image();
      img.onload = function() {
        var scale = maxWidth / img.width;
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);
        var canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        console.log('[Ferrari/Init] Imagen escalada (fallback):',
          img.width + 'x' + img.height, '→', w + 'x' + h,
          '(', Math.round(scale * 100), '%)');
        resolve(canvas);
      };
      img.onerror = function() {
        reject(new Error('No se pudo cargar la imagen: ' + url));
      };
      img.src = url;
    });
  }

  /**
   * Crea el viewer de Pannellum con la fuente preparada.
   * @param {HTMLCanvasElement|string} source
   */
  function _createViewer(source) {
    var config = {
      type:        'equirectangular',
      autoLoad:    true,
      showZoomCtrl:      true,
      showFullscreenCtrl: true,
      mouseZoom:   true,
      keyboardZoom: true,
      draggable:   true,
      hfov:        90,
      minHfov:     30,
      maxHfov:     120,
      pitch:       0,
      yaw:         0,
      strings: {
        loadingLabel: 'Cargando Ferrari360...',
        bylineLabel:  'por %s'
      }
    };

    if (typeof source === 'string') {
      config.panorama = source;
    } else {
      config.dynamic  = true;
      config.panorama = source;
    }

    var viewer = pannellum.viewer('pannellum-viewer', config);

    // ─── EXPONER window.Ferrari ────────────────────────────────────
    window.Ferrari = {
      viewer,
      state:     window.FerrariState,
      camera:    window.FerrariCamera,
      domCache:  window.DOMCache,
      raf:       window.FerrariRAF,
      version:   '2.0.0'
    };

    console.log('[Ferrari/Init] window.Ferrari expuesto:', window.Ferrari);

    // ─── ESPERAR CARGA DE PANNELLUM ────────────────────────────────
    viewer.on('load', function() {
      console.log('[Ferrari/Init] ✓ Pannellum cargado. Iniciando sistemas...');
      _onViewerReady();
    });

    viewer.on('error', function(e) {
      console.error('[Ferrari/Init] Error de Pannellum:', e);
      var container = document.getElementById('pannellum-viewer');
      if (e && (e.type === 'webgl size error' || (typeof e === 'string' && /webgl|texture/i.test(e)))) {
        if (_viewerBootTries < 3 && window.FerrariDevice && window.FerrariDevice.stepDown) {
          try { viewer.destroy(); } catch (err) {}
          var next = window.FerrariDevice.stepDown();
          console.warn('[Ferrari/Init] WebGL size error → reintento', next.maxWidth);
          if (container) container.innerHTML = '';
          _bootViewer(next.maxWidth);
          return;
        }
      }
      var msg = '';
      if (e && e.type === 'webgl size error') {
        msg = 'La imagen 360° es demasiado grande para este dispositivo.' +
          ' (' + e.width + 'px, máx ' + e.maxWidth + 'px). Prueba ?tex=2048';
      } else {
        msg = 'Error al cargar la imagen 360°. Recarga o contacta al administrador.';
      }
      if (container) {
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;' +
          'color:#fff;background:#1a1a2e;font-family:sans-serif;font-size:14px;padding:20px;text-align:center">' +
          _escHtml(msg) + '</div>';
      }
    });
  }

  function _showWebGLError() {
    console.error('[Ferrari/Init] WebGL no disponible');
    var container = document.getElementById('pannellum-viewer');
    if (!container) return;
    container.innerHTML =
      '<div style="display:table;width:100%;height:100%;text-align:center;color:#fff;' +
      'background:#1a1a2e;font-family:sans-serif;padding:20px;box-sizing:border-box">' +
      '<div style="display:table-cell;vertical-align:middle">' +
      '<h2 style="font-size:22px;margin:0 0 12px">Error WebGL</h2>' +
      '<p style="font-size:14px;line-height:1.5;margin:0 0 16px;color:rgba(255,255,255,0.8)">' +
      'Tu navegador no soporta WebGL o está desactivado.' +
      (_isSamsung() ?
        '<br><br><b>En Samsung Galaxy Tab:</b><br>' +
        '1. Abre en <b>Chrome</b> (no Samsung Internet)<br>' +
        '2. Desactiva el <b>Modo Ahorro de Energía</b><br>' +
        '3. Ve a Ajustes &gt; Aplicaciones &gt; Chrome &gt; "Abrir por defecto" &gt; Borrar preferencias' :
        '') +
      '</p>' +
      '<button onclick="location.reload()" style="padding:10px 28px;border:none;' +
      'border-radius:999px;background:#c9a84c;color:#1a1a2e;font-size:14px;font-weight:700;' +
      'cursor:pointer">Reintentar</button>' +
      '</div></div>';
  }

  function _showLoadingMessage(msg) {
    var container = document.getElementById('pannellum-viewer');
    if (!container) return;
    var el = document.getElementById('kpk-init-loading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kpk-init-loading';
      el.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;' +
        'justify-content:center;color:#fff;background:#1a1a2e;font-family:sans-serif;' +
        'font-size:14px;z-index:10;text-align:center;padding:20px';
      container.appendChild(el);
    }
    el.textContent = msg || 'Preparando imagen 360°…';
    el.hidden = false;
  }

  function _hideLoadingMessage() {
    var el = document.getElementById('kpk-init-loading');
    if (el) el.hidden = true;
  }

  function _escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  /**
   * Llamado cuando Pannellum termina de cargar la imagen 360.
   * Inicializa todos los sistemas del motor Ferrari.
   */
  function _onViewerReady() {

    // 1. Configurar el SVG overlay con viewBox dinámico
    _setupSVGOverlay();

    // 2. Arrancar el rAF loop maestro
    window.FerrariRAF.start();

    // 2b. Brújula + geo pins + aplicar norte guardado
    if (window.FerrariCompass) window.FerrariCompass.start();
    if (window.FerrariGeo && window.Ferrari.viewer) {
      try {
        if (window.Ferrari.viewer.setNorthOffset) {
          window.Ferrari.viewer.setNorthOffset(window.FerrariGeo.northOffset || 0);
        }
      } catch (e) {}
    }
    if (window.FerrariGeoPins) window.FerrariGeoPins.rebuild();

    // 3. Forzar dirty flag inicial para primer render de paths
    window.FerrariCamera.markDirty();

    // 4. Registrar resize handler (una sola vez)
    window.addEventListener('resize', _onResize, { passive: true });

    // 4b. Fullscreen: Pannellum maximiza solo su WebGL y deja fuera el SVG.
    //     Interceptamos el botón para maximizar #panorama-container (con lotes/pines).
    _setupFullscreenFix();

    // ─── SINCRONIZACIÓN SVG PIXEL-PERFECT ────────────────────────────
    // El rAF de Ferrari + getClampedView() (réplica del clamp Fa de Pannellum)
    // evitan el float en nadir: getPitch() crudo puede ir a -120° en drag,
    // pero WebGL y SVG usan ambos el pitch clampeado a [-90, 90].

    const container = document.getElementById('pannellum-viewer');

    // wheel dispara zoom → puede cambiar HFOV
    container.addEventListener('wheel', function() {
      if (window.FerrariRAF && window.FerrariRAF.processFrame) {
        window.FerrariRAF.processFrame();
      }
    }, { passive: true });

    // 5. Mobile/tablet: zoom más profundo
    if ((window.innerWidth < 768 || (window.FerrariDevice && window.FerrariDevice.isTablet && window.FerrariDevice.isTablet()))
        && window.Ferrari.viewer.setHfovBounds) {
      window.Ferrari.viewer.setHfovBounds([15, 120]);
    }

    // 6. Verificación de consola según spec
    _verifyProjection();

    // 7. Cinematic intro: paneo norte → izquierda → Lote 13
    _tryCinematicIntro();
    document.addEventListener('ferrari:lotes-changed', _tryCinematicIntro, { once: true });

    console.log('[Ferrari/Init] ✓ Motor Ferrari360 activo — SVG nadir-clamped');
  }

  function _applyPerfCapsEarly() {
    if (!window.FerrariDevice) return;
    window.FerrariDevice.detect();
    var maxDpr = window.FerrariDevice.getMaxDpr ? window.FerrariDevice.getMaxDpr() : 2;
    var real = window.devicePixelRatio || 1;
    if (real <= maxDpr) return;
    try {
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        get: function() { return maxDpr; }
      });
      console.log('[Ferrari/Init] DPR capped early', real, '→', maxDpr);
    } catch (e) {
      console.warn('[Ferrari/Init] No se pudo limitar DPR:', e);
    }
  }

  /** @deprecated alias — caps ya se aplican early */
  function _applyPerfCaps() {
    _applyPerfCapsEarly();
    try {
      if (window.Ferrari && window.Ferrari.viewer && window.Ferrari.viewer.resize) {
        window.Ferrari.viewer.resize();
      }
    } catch (e2) {}
  }

  /** Paneo cinemático de bienvenida: norte → izquierda → Lote 13 */
  function _tryCinematicIntro() {
    if (sessionStorage.getItem('ferrari_cinematic_played')) return;
    const viewer = window.Ferrari && window.Ferrari.viewer;
    const lines = window.allDrawnLines || [];
    if (!viewer || !viewer.lookAt) return;

    const lote13 = lines.find(function(l) { return l.titulo === '13' && l._pinCentroid; });
    if (!lote13) return;
    sessionStorage.setItem('ferrari_cinematic_played', '1');

    var northOff = (window.FerrariGeo && window.FerrariGeo.northOffset) || 0;
    var northYaw = -northOff;
    var lotePitch = lote13._pinCentroid[0];
    var loteYaw   = lote13._pinCentroid[1];
    var midYaw    = northYaw - 40;
    var midPitch  = lotePitch * 0.5;
    var DUR = 1200;

    viewer.stopMovement();
    viewer.lookAt(0, northYaw, 90, 0);

    setTimeout(function() {
      viewer.lookAt(midPitch, midYaw, 90, DUR, function() {
        setTimeout(function() {
          viewer.lookAt(lotePitch, loteYaw, 90, DUR);
        }, 250);
      });
    }, 400);
  }

  /**
   * Pannellum pide fullscreen solo sobre su contenedor WebGL.
   * El SVG (#loteo-svg), HUD y geo-pins viven en #panorama-container
   * (hermano), así que al maximizar “desaparecen”. Solución: fullscreen
   * del contenedor padre + refrescar proyección.
   */
  function _setupFullscreenFix() {
    const host = document.getElementById('panorama-container');
    const viewerRoot = document.getElementById('pannellum-viewer');
    if (!host || !viewerRoot) return;

    // Crear botón de maximizar si Pannellum no lo creó (por ejemplo en iOS Safari o dentro de iframes sin allowfullscreen)
    let btn = viewerRoot.querySelector('.pnlm-fullscreen-toggle-button');
    if (!btn) {
      const controls = viewerRoot.querySelector('.pnlm-controls-container');
      if (controls) {
        btn = document.createElement('div');
        btn.className = 'pnlm-fullscreen-toggle-button pnlm-sprite pnlm-fullscreen-toggle-button-inactive pnlm-controls pnlm-control';
        btn.title = 'Pantalla completa (CSS fallback)';
        controls.appendChild(btn);
        console.log('[Ferrari/Init] Botón de maximizar creado manualmente para fallback');
      }
    }

    function _isFullscreen() {
      const fs = document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement;
      return !!fs || host.classList.contains('is-pseudo-fullscreen');
    }

    function _syncFullscreenButton() {
      const btn = viewerRoot.querySelector('.pnlm-fullscreen-toggle-button');
      if (!btn) return;
      const on = _isFullscreen();
      btn.classList.toggle('pnlm-fullscreen-toggle-button-active', on);
      btn.classList.toggle('pnlm-fullscreen-toggle-button-inactive', !on);
    }

    // ─── Reparenting de elementos que viven en <body> ────────────────
    // En fullscreen, solo el elemento que solicita el fullscreen y sus
    // DESCENDIENTES son visibles. Los elementos con position:fixed que
    // estén en <body> pero fuera de #panorama-container desaparecen.
    // Solución: moverlos temporalmente dentro del host al entrar en fs,
    // y devolverlos a <body> al salir.
    const _bodyOrphans = [
      { id: 'kpk-brand-dock',  nextSibling: null, parent: null },
      { id: 'kpk-lote-panel',  nextSibling: null, parent: null },
    ];
    // El buyer dock se inyecta dinámicamente por f-buyer-dock.js —
    // se identifica por su clase en runtime.

    function _adoptOrphansIntoHost() {
      // Elementos estáticos declarados en index.html
      _bodyOrphans.forEach(rec => {
        const el = document.getElementById(rec.id);
        if (!el) return;
        if (host.contains(el)) return; // ya está dentro
        rec.parent      = el.parentNode;
        rec.nextSibling = el.nextSibling;
        host.appendChild(el);
        el.classList.add('kpk-fs-adopted');
      });
      // Buyer dock (creado dinámicamente por f-buyer-dock.js)
      const buyerDock = document.querySelector('.kpk-buyer-dock');
      if (buyerDock && !host.contains(buyerDock)) {
        buyerDock._fsParent      = buyerDock.parentNode;
        buyerDock._fsNextSibling = buyerDock.nextSibling;
        host.appendChild(buyerDock);
        buyerDock.classList.add('kpk-fs-adopted');
      }
      // Widget de clima (creado dinámicamente por f-weather.js)
      const weatherWidget = document.getElementById('kpk-weather-widget');
      if (weatherWidget && !host.contains(weatherWidget)) {
        weatherWidget._fsParent      = weatherWidget.parentNode;
        weatherWidget._fsNextSibling = weatherWidget.nextSibling;
        host.appendChild(weatherWidget);
        weatherWidget.classList.add('kpk-fs-adopted');
      }
      document.body.classList.add('is-fullscreen');
    }

    function _returnOrphansToBody() {
      _bodyOrphans.forEach(rec => {
        const el = document.getElementById(rec.id);
        if (!el || !el.classList.contains('kpk-fs-adopted')) return;
        const p = rec.parent || document.body;
        if (rec.nextSibling && rec.nextSibling.parentNode === p) {
          p.insertBefore(el, rec.nextSibling);
        } else {
          p.appendChild(el);
        }
        el.classList.remove('kpk-fs-adopted');
        rec.parent = null; rec.nextSibling = null;
      });
      // Buyer dock
      const buyerDock = document.querySelector('.kpk-buyer-dock');
      if (buyerDock && buyerDock.classList.contains('kpk-fs-adopted')) {
        const p  = buyerDock._fsParent      || document.body;
        const ns = buyerDock._fsNextSibling || null;
        if (ns && ns.parentNode === p) {
          p.insertBefore(buyerDock, ns);
        } else {
          p.appendChild(buyerDock);
        }
        buyerDock.classList.remove('kpk-fs-adopted');
        delete buyerDock._fsParent;
        delete buyerDock._fsNextSibling;
      }
      // Widget de clima
      const weatherWidget = document.getElementById('kpk-weather-widget');
      if (weatherWidget && weatherWidget.classList.contains('kpk-fs-adopted')) {
        const p  = weatherWidget._fsParent      || document.body;
        const ns = weatherWidget._fsNextSibling || null;
        if (ns && ns.parentNode === p) {
          p.insertBefore(weatherWidget, ns);
        } else {
          p.appendChild(weatherWidget);
        }
        weatherWidget.classList.remove('kpk-fs-adopted');
        delete weatherWidget._fsParent;
        delete weatherWidget._fsNextSibling;
      }
      document.body.classList.remove('is-fullscreen');
    }
    // ─────────────────────────────────────────────────────────────────

    function _refreshAfterFullscreen() {
      _syncFullscreenButton();
      const isFs = _isFullscreen();
      // Reparenting sincrónico (antes del layout del fullscreen)
      if (isFs) {
        _adoptOrphansIntoHost();
      } else {
        _returnOrphansToBody();
      }
      // Esperar a que el layout del fullscreen asiente (doble rAF + micro delay)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          _onResize();
          try {
            if (window.Ferrari && window.Ferrari.viewer && window.Ferrari.viewer.resize) {
              window.Ferrari.viewer.resize();
            }
          } catch (e) {}
          if (window.FerrariCamera) window.FerrariCamera.markDirty();
          if (window.FerrariRAF && window.FerrariRAF.markDataDirty) {
            window.FerrariRAF.markDataDirty();
          }
          if (window.FerrariGeoPins && window.FerrariGeoPins.rebuild) {
            window.FerrariGeoPins.rebuild();
          }
          if (window.FerrariSmartPins) window.FerrariSmartPins.markDirty();
        });
      });
      setTimeout(() => {
        _onResize();
        try {
          if (window.Ferrari && window.Ferrari.viewer && window.Ferrari.viewer.resize) {
            window.Ferrari.viewer.resize();
          }
        } catch (e) {}
        if (window.FerrariCamera) window.FerrariCamera.markDirty();
        if (window.FerrariRAF && window.FerrariRAF.markDataDirty) {
          window.FerrariRAF.markDataDirty();
        }
        // Disparar evento de resize global para que el chatbot y otros componentes se reconfiguren
        window.dispatchEvent(new Event('resize'));
      }, 120);
    }


    async function _toggleHostFullscreen() {
      const supportsNativeFS = !!(document.fullscreenEnabled ||
        document.webkitFullscreenEnabled ||
        document.mozFullScreenEnabled ||
        document.msFullscreenEnabled);
      const inIFrame = window.self !== window.top;

      // Notificar al sitio web padre por si quiere manejar la maximización del iframe
      try {
        window.parent.postMessage({ type: 'ferrari-fullscreen', action: 'toggle' }, '*');
      } catch (e) {}

      // IDEA NOVEDOSA: Si está dentro de un iframe en un dispositivo sin Fullscreen nativo (como iOS/iPhone),
      // abrimos la URL directa en una nueva pestaña para poder disfrutar del recorrido al 100% de la pantalla.
      if (inIFrame && !supportsNativeFS) {
        console.log('[Ferrari/Init] Fullscreen nativo bloqueado por iframe en iOS. Abriendo en pestaña nueva.');
        window.open(window.location.href, '_blank');
        return;
      }

      if (!supportsNativeFS) {
        host.classList.toggle('is-pseudo-fullscreen');
        _refreshAfterFullscreen();
        return;
      }

      try {
        if (_isFullscreen()) {
          if (host.classList.contains('is-pseudo-fullscreen')) {
            host.classList.remove('is-pseudo-fullscreen');
            _refreshAfterFullscreen();
          } else {
            const exit = document.exitFullscreen ||
              document.webkitExitFullscreen ||
              document.msExitFullscreen;
            if (exit) await exit.call(document);
          }
        } else {
          const req = host.requestFullscreen ||
            host.webkitRequestFullscreen ||
            host.msRequestFullscreen;
          if (req) await req.call(host);
        }
      } catch (err) {
        console.warn('[Ferrari/Init] Fullscreen nativo falló, usando fallback CSS:', err);
        host.classList.toggle('is-pseudo-fullscreen');
        _refreshAfterFullscreen();
      }
    }

    // Captura: anular el fullscreen nativo de Pannellum
    viewerRoot.addEventListener('click', function(e) {
      const btn = e.target.closest('.pnlm-fullscreen-toggle-button');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      _toggleHostFullscreen();
    }, true);

    ['fullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange'].forEach(ev => {
      document.addEventListener(ev, _refreshAfterFullscreen);
    });

    if (window.Ferrari && window.Ferrari.viewer && window.Ferrari.viewer.on) {
      window.Ferrari.viewer.on('fullscreenchange', _refreshAfterFullscreen);
    }

    console.log('[Ferrari/Init] ✓ Fullscreen → #panorama-container (SVG incluido)');
  }

  /**
   * Configura el SVG overlay para que tenga viewBox = tamaño del viewport.
   * Se llama también en resize.
   */
  function _setupSVGOverlay() {
    const svg = document.getElementById('loteo-svg');
    if (!svg) return;

    const container = document.getElementById('pannellum-viewer');
    const w = container ? container.clientWidth  : window.innerWidth;
    const h = container ? container.clientHeight : window.innerHeight;

    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width',  '100%');
    svg.setAttribute('height', '100%');

    // Garantizar que #kpk-draw-overlay es el lastElementChild
    const overlay = document.getElementById('kpk-draw-overlay');
    if (overlay && overlay !== svg.lastElementChild) {
      svg.appendChild(overlay);
    }
  }

  /**
   * Handler de resize: actualiza viewBox y marca cámara dirty.
   */
  function _onResize() {
    _setupSVGOverlay();
    window.FerrariCamera.markDirty();
  }

  /**
   * Verificación de consola: proyecta un punto de prueba.
   * Según spec: "Verifica en consola que getCam proyecta correctamente."
   */
  function _verifyProjection() {
    const view = window.FerrariCamera.getClampedView();
    const camPitch = view.pitch;
    const camYaw   = view.yaw;
    const hfov     = view.hfov;

    // Proyectar exactamente el centro de la vista (debe dar cx, cy)
    const cam = window.FerrariCamera.getCam(camPitch, camYaw);
    const proj = window.FerrariCamera.getProjectionParams();
    const px = window.FerrariCamera.camToPixel(cam, proj);

    console.log('[Ferrari/Init] ✓ Verificación proyección:');
    console.log('  Camera state (clamped) → pitch:', camPitch.toFixed(2), '° yaw:', camYaw.toFixed(2), '° hfov:', hfov.toFixed(2), '°');
    console.log('  getCam(centro) → z:', cam.z.toFixed(4), '(debe ser > 0.0001)');
    console.log('  Pixel proyectado →', px.px.toFixed(1), px.py.toFixed(1), '(debe ≈ centro del viewport)');
    console.log('  Viewport centro esperado:', proj.cx.toFixed(1), proj.cy.toFixed(1));

    if (cam.z > 0.0001 &&
        Math.abs(px.px - proj.cx) < 5 &&
        Math.abs(px.py - proj.cy) < 5) {
      console.log('%c[Ferrari/Init] ✅ Proyección CORRECTA', 'color: #50c878; font-weight: bold');
    } else {
      console.warn('%c[Ferrari/Init] ⚠️ Proyección fuera de rango — revisar INVERT_YAW en f-camera.js', 'color: #ff6b6b');
    }
  }

  // ─── ARRANQUE ────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
