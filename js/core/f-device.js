/**
 * f-device.js — Detección de capacidad + panorama único (loteo360.jpg)
 *
 * Una sola foto en el repo. El runtime decide:
 *   - desktop high/mid: FULL si la GPU aguanta
 *   - phone/tablet: tope 4096 (mid) / 2048 (low) — full 8–12k mata FPS en móvil
 *   - low o poca RAM: 2048
 *
 * Override URL: ?tex=2048|4096|8192  o  ?tier=low|mid|high
 */

'use strict';

(function() {

  const PANO_URL = 'loteo360.jpg';
  // Dimensiones lógicas del equirect (se ajustan al decodificar si difieren)
  let ORIGINAL_WIDTH  = 12000;
  let ORIGINAL_HEIGHT = 6000;

  const LIMITS = {
    high: 8192,
    mid:  4096,
    low:  2048
  };

  let _tier  = 'high';
  let _limit = LIMITS.high;
  let _maxTexSize = 0;
  let _detected   = false;
  let _externalTexSize = 0;
  let _isTablet = false;
  let _isPhone = false;
  let _maxDpr = 2;
  let _panoUrl = PANO_URL;
  let _objectUrl = null; // blob URL del resize (revoke al recrear)

  function _ua() {
    return (navigator.userAgent || '').toLowerCase();
  }

  function _isSamsungDevice() {
    var ua = _ua();
    return ua.indexOf('samsung') >= 0 ||
           ua.indexOf('galaxy') >= 0 ||
           /sm-[a-z0-9]+/i.test(navigator.userAgent || '');
  }

  function _detectPhone() {
    var ua = _ua();
    try {
      if (navigator.userAgentData && navigator.userAgentData.mobile === true) return true;
    } catch (e) {}
    if (/iphone|ipod|windows phone/.test(ua)) return true;
    if (/android/.test(ua) && !_detectTablet()) return true;
    var w = Math.max(screen.width || 0, screen.height || 0);
    var h = Math.min(screen.width || 0, screen.height || 0);
    if (/android|mobile/.test(ua) && w > 0 && h > 0 && (w / h) >= 1.6 && w < 1400) return true;
    return false;
  }

  function _detectTablet() {
    var ua = _ua();
    var screenW = Math.max(screen.width || 0, screen.height || 0);
    var screenH = Math.min(screen.width || 0, screen.height || 0);
    if (/sm-t7|sm-t8|sm-t9|sm-x7|sm-x8|galaxy tab|gts7|gts8|gts9/.test(ua)) return true;
    if (ua.indexOf('android') >= 0 && screenW >= 1000 && (screenW / Math.max(1, screenH)) < 1.6) return true;
    if (ua.indexOf('tablet') >= 0) return true;
    try {
      if (navigator.userAgentData && navigator.userAgentData.mobile === false &&
          ua.indexOf('android') >= 0 && screenW >= 1200) return true;
    } catch (e) {}
    return false;
  }

  function _urlOverride() {
    try {
      var q = new URLSearchParams(window.location.search);
      var tex = parseInt(q.get('tex'), 10);
      var tier = (q.get('tier') || '').toLowerCase();
      if (tex === 1024 || tex === 2048 || tex === 4096 || tex === 8192) {
        return { tier: tex <= 2048 ? 'low' : (tex <= 4096 ? 'mid' : 'high'), maxWidth: tex };
      }
      if (tier === 'low' || tier === 'mid' || tier === 'high') {
        return { tier: tier, maxWidth: LIMITS[tier] };
      }
    } catch (e) {}
    return null;
  }

  /** Pannellum equirect: falla si max(width/2, height) > MAX_TEXTURE_SIZE */
  function _gpuFits(width, height) {
    if (!_maxTexSize || _maxTexSize <= 0) return true;
    return Math.max(width / 2, height) <= _maxTexSize;
  }

  /** Ancho máximo que la GPU puede texturizar para un equirect 2:1 */
  function _gpuMaxEquirectWidth() {
    if (!_maxTexSize || _maxTexSize <= 0) return LIMITS.high;
    // height = width/2 debe ser ≤ maxTex; width/2 ≤ maxTex → width ≤ 2*maxTex
    return Math.min(ORIGINAL_WIDTH, _maxTexSize * 2, 8192);
  }

  function _deviceMemoryGb() {
    var m = navigator.deviceMemory;
    return (typeof m === 'number' && m > 0) ? m : null;
  }

  /**
   * Ancho objetivo según tier / override / GPU.
   * Phone/tablet: nunca full 8–12k (regresión de lag vs variantes 4096/2048).
   * Desktop mid/high: FULL si GPU aguanta.
   */
  function getTargetWidth(forcedMaxWidth) {
    detect();
    var force = forcedMaxWidth > 0 ? forcedMaxWidth : 0;
    var gpuCap = _gpuMaxEquirectWidth();
    var mem = _deviceMemoryGb();
    var want;

    if (force > 0) {
      want = force;
    } else if (_tier === 'low' || (mem != null && mem > 0 && mem < 3)) {
      want = LIMITS.low;
    } else if (_isPhone || _isTablet) {
      // Móvil/tablet: tope 4096 (evitar full 8–12k)
      want = LIMITS.mid;
    } else {
      // Desktop mid/high → foto full (limitada solo por GPU)
      want = ORIGINAL_WIDTH;
    }

    want = Math.min(want, gpuCap, ORIGINAL_WIDTH);
    // Alinear a múltiplo de 2 (equirect)
    want = Math.max(1024, Math.floor(want / 2) * 2);
    _limit = want;
    return want;
  }

  /** Compat: API antigua que devolvía {url,width,...} — ahora siempre apunta al JPG único */
  function pickPanorama(forcedMaxWidth) {
    var w = getTargetWidth(forcedMaxWidth);
    var h = Math.round(w / 2);
    _panoUrl = PANO_URL;
    return {
      url: PANO_URL,
      width: w,
      height: h,
      tier: _tier,
      maxTextureSize: _maxTexSize,
      isTablet: _isTablet,
      isPhone: _isPhone,
      maxDpr: _maxDpr,
      needsResize: w < ORIGINAL_WIDTH - 8
    };
  }

  function _revokeObjectUrl() {
    if (_objectUrl) {
      try { URL.revokeObjectURL(_objectUrl); } catch (e) {}
      _objectUrl = null;
    }
  }

  function _canvasToJpegBlob(canvas, quality) {
    return new Promise(function(resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function(b) {
          if (b) resolve(b);
          else reject(new Error('toBlob vacío'));
        }, 'image/jpeg', quality);
        return;
      }
      try {
        var dataUrl = canvas.toDataURL('image/jpeg', quality);
        fetch(dataUrl).then(function(r) { return r.blob(); }).then(resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  function _supportsBitmapResize() {
    // Safari antiguo no soporta resizeWidth en createImageBitmap
    return typeof createImageBitmap === 'function';
  }

  /**
   * Prepara la fuente para Pannellum desde un único JPG.
   * @returns {Promise<{url:string,width:number,height:number,resized:boolean,tier:string}>}
   */
  function resolvePanoramaSource(forcedMaxWidth) {
    detect();
    var targetW = getTargetWidth(forcedMaxWidth);
    var targetH = Math.round(targetW / 2);
    var needsResize = targetW < ORIGINAL_WIDTH - 8 || !_gpuFits(ORIGINAL_WIDTH, ORIGINAL_HEIGHT);

    // FULL directo: sin decode/resize en JS (mejor para gama media-alta)
    if (!needsResize && _gpuFits(ORIGINAL_WIDTH, ORIGINAL_HEIGHT)) {
      _panoUrl = PANO_URL;
      _limit = ORIGINAL_WIDTH;
      console.log('[Ferrari/Device] Panorama FULL directo →', PANO_URL,
        '| target:', ORIGINAL_WIDTH, '| tier:', _tier);
      return Promise.resolve({
        url: PANO_URL,
        width: ORIGINAL_WIDTH,
        height: ORIGINAL_HEIGHT,
        resized: false,
        tier: _tier
      });
    }

    console.log('[Ferrari/Device] Downscale runtime →', targetW + 'x' + targetH,
      '| tier:', _tier, '| phone:', _isPhone, '| tablet:', _isTablet);

    return fetch(PANO_URL + '?t=' + Date.now(), { cache: 'force-cache' }).then(function(res) {
      if (!res.ok) throw new Error('No se pudo cargar ' + PANO_URL);
      return res.blob();
    }).then(function(blob) {
      function _rasterToSource(bmpOrImg, srcW, srcH) {
        ORIGINAL_WIDTH = srcW || ORIGINAL_WIDTH;
        ORIGINAL_HEIGHT = srcH || ORIGINAL_HEIGHT;
        targetW = Math.min(targetW, ORIGINAL_WIDTH, _gpuMaxEquirectWidth());
        targetW = Math.max(1024, Math.floor(targetW / 2) * 2);
        targetH = Math.round(targetW / 2);
        if (targetW >= ORIGINAL_WIDTH - 8 && _gpuFits(ORIGINAL_WIDTH, ORIGINAL_HEIGHT)) {
          if (bmpOrImg.close) try { bmpOrImg.close(); } catch (e) {}
          _panoUrl = PANO_URL;
          return Promise.resolve({
            url: PANO_URL,
            width: ORIGINAL_WIDTH,
            height: ORIGINAL_HEIGHT,
            resized: false,
            tier: _tier
          });
        }
        var canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        var ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
          if (bmpOrImg.close) try { bmpOrImg.close(); } catch (e) {}
          return Promise.reject(new Error('Canvas 2D no disponible'));
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmpOrImg, 0, 0, targetW, targetH);
        if (bmpOrImg.close) try { bmpOrImg.close(); } catch (e) {}
        return _canvasToJpegBlob(canvas, 0.92).then(function(outBlob) {
          canvas.width = 0;
          canvas.height = 0;
          _revokeObjectUrl();
          _objectUrl = URL.createObjectURL(outBlob);
          _panoUrl = _objectUrl;
          _limit = targetW;
          return {
            url: _objectUrl,
            width: targetW,
            height: targetH,
            resized: true,
            tier: _tier
          };
        });
      }

      if (_supportsBitmapResize()) {
        // Intentar resize en decode (menos RAM). Si el browser no lo soporta, cae al path normal.
        return createImageBitmap(blob, {
          resizeWidth: targetW,
          resizeHeight: targetH,
          resizeQuality: 'high'
        }).catch(function() {
          return createImageBitmap(blob);
        }).then(function(bmp) {
          return _rasterToSource(bmp, bmp.width, bmp.height);
        });
      }

      // Fallback Image()
      return new Promise(function(resolve, reject) {
        var img = new Image();
        img.decoding = 'async';
        var tmpUrl = URL.createObjectURL(blob);
        img.onload = function() {
          URL.revokeObjectURL(tmpUrl);
          _rasterToSource(img, img.naturalWidth, img.naturalHeight).then(resolve, reject);
        };
        img.onerror = function() {
          URL.revokeObjectURL(tmpUrl);
          reject(new Error('Error decodificando panorama'));
        };
        img.src = tmpUrl;
      });
    });
  }

  function detect() {
    if (_detected) {
      return {
        tier: _tier,
        maxWidth: _limit,
        maxTextureSize: _maxTexSize,
        isTablet: _isTablet,
        isPhone: _isPhone,
        maxDpr: _maxDpr,
        panoramaUrl: _panoUrl
      };
    }
    _detected = true;
    _isTablet = _detectTablet();
    _isPhone = !_isTablet && _detectPhone();

    var override = _urlOverride();
    if (override) {
      _tier = override.tier;
      _limit = override.maxWidth;
      _maxTexSize = _detectMaxTextureSize();
      _maxDpr = _tier === 'high' ? 2 : (_tier === 'mid' ? 1.35 : 1.15);
      getTargetWidth(_limit);
      console.log('[Ferrari/Device] Override URL → Tier:', _tier, '| targetW:', _limit,
        '| phone:', _isPhone, '| tablet:', _isTablet);
      return {
        tier: _tier,
        maxWidth: _limit,
        maxTextureSize: _maxTexSize,
        isTablet: _isTablet,
        isPhone: _isPhone,
        maxDpr: _maxDpr,
        panoramaUrl: PANO_URL
      };
    }

    var score = 0;
    _maxTexSize = _detectMaxTextureSize();

    var mem = navigator.deviceMemory;
    if (mem !== undefined) {
      if (mem >= 6)      score += 3;
      else if (mem >= 4) score += 2;
      else               score += 1;
    } else {
      score += 2;
    }

    var cores = navigator.hardwareConcurrency;
    if (cores !== undefined) {
      if (cores >= 8)      score += 3;
      else if (cores >= 4) score += 2;
      else                 score += 1;
    } else {
      score += 2;
    }

    var screenPx = (screen.width || 1920) * (screen.height || 1080);
    if (screenPx > 4000000)      score += 2;
    else if (screenPx > 2000000) score += 1;

    var isSamsung = _isSamsungDevice();
    if (isSamsung && ((cores !== undefined && cores <= 8) || (mem !== undefined && mem <= 6))) {
      score -= 1;
    }

    // Tablets ya no se penalizan a "mid forzado": usan full si GPU/RAM alcanzan
    if (_isTablet && score >= 7) score = score; // noop, claridad
    else if (_isTablet && score < 3) score = score;

    if (_maxTexSize > 0) {
      if (_maxTexSize >= 8192)      score += 2;
      else if (_maxTexSize >= 4096) score += 0;
      else                          score -= 2;
    }

    if (score >= 6) { _tier = 'high'; _limit = LIMITS.high; }
    else if (score >= 3) { _tier = 'mid'; _limit = LIMITS.mid; }
    else { _tier = 'low'; _limit = LIMITS.low; }

    if (_tier === 'high') _maxDpr = 2;
    else if (_tier === 'mid') _maxDpr = (_isTablet || _isPhone) ? 1.5 : 1.75;
    else _maxDpr = (_isPhone || _isTablet) ? 1.25 : 1.35;

    getTargetWidth();

    console.log('[Ferrari/Device] Tier:', _tier, '| targetW:', _limit,
      '| MAX_TEXTURE_SIZE:', _maxTexSize, '| score:', score,
      '| phone:', _isPhone, '| tablet:', _isTablet, '| maxDpr:', _maxDpr);

    return {
      tier: _tier,
      maxWidth: _limit,
      maxTextureSize: _maxTexSize,
      isTablet: _isTablet,
      isPhone: _isPhone,
      maxDpr: _maxDpr,
      panoramaUrl: PANO_URL
    };
  }

  function setMaxTextureSize(size) {
    _externalTexSize = size;
  }

  function _detectMaxTextureSize() {
    if (_externalTexSize > 0) return _externalTexSize;
    var c = document.createElement('canvas');
    var names = ['webgl2', 'webgl', 'experimental-webgl'];
    var gl = null;
    for (var i = 0; i < names.length && !gl; i++) {
      try { gl = c.getContext(names[i], { alpha: false, depth: false }); } catch (e) {}
    }
    if (!gl) return 0;
    var size = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    var lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return size;
  }

  function needsDownscale() {
    detect();
    return getTargetWidth() < ORIGINAL_WIDTH - 8;
  }

  function getMaxWidth() {
    detect();
    return _limit;
  }

  function getTier() {
    detect();
    return _tier;
  }

  function getPanoramaUrl() {
    detect();
    return _panoUrl || PANO_URL;
  }

  function isTablet() {
    detect();
    return _isTablet;
  }

  function isPhone() {
    detect();
    return _isPhone;
  }

  function getMaxDpr() {
    detect();
    return _maxDpr;
  }

  function getOriginalWidth() { return ORIGINAL_WIDTH; }
  function getOriginalHeight() { return ORIGINAL_HEIGHT; }

  /** Baja un escalón de resolución objetivo y reintenta */
  function stepDown() {
    detect();
    var cur = _limit || getTargetWidth();
    var next;
    if (cur > 4096) next = 4096;
    else if (cur > 2048) next = 2048;
    else if (cur > 1024) next = 1024;
    else next = 1024;

    if (next >= 4096) _tier = 'mid';
    else _tier = 'low';
    _limit = next;
    _maxDpr = (_isPhone || _isTablet || _tier === 'low') ? 1.1 : 1.25;
    console.warn('[Ferrari/Device] stepDown →', _tier, next + 'px');
    return {
      tier: _tier,
      maxWidth: next,
      maxTextureSize: _maxTexSize,
      isTablet: _isTablet,
      isPhone: _isPhone,
      maxDpr: _maxDpr,
      panoramaUrl: PANO_URL
    };
  }

  window.FerrariDevice = {
    detect: detect,
    needsDownscale: needsDownscale,
    getMaxWidth: getMaxWidth,
    getTargetWidth: getTargetWidth,
    getTier: getTier,
    getPanoramaUrl: getPanoramaUrl,
    pickPanorama: pickPanorama,
    resolvePanoramaSource: resolvePanoramaSource,
    isTablet: isTablet,
    isPhone: isPhone,
    getMaxDpr: getMaxDpr,
    stepDown: stepDown,
    setMaxTextureSize: setMaxTextureSize,
    getOriginalWidth: getOriginalWidth,
    getOriginalHeight: getOriginalHeight,
    PANO_URL: PANO_URL
  };

  console.log('[Ferrari/Device] ✓ Módulo cargado (single panorama + runtime scale)');

})();
