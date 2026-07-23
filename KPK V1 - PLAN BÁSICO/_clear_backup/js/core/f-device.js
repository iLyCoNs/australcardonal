/**
 * f-device.js — Detección de capacidad del dispositivo para adaptar Ferrari360
 *
 * Tier (high / mid / low) según WebGL, RAM, CPU, pantalla y UA.
 * Galaxy Tab S7 FE y tablets Android similares: mid (4096) por defecto
 * (mejor calidad que 2048, sin saturar GPU como 8192).
 *
 * Override URL: ?tex=2048|4096|8192  o  ?tier=low|mid|high
 */

'use strict';

(function() {

  const ORIGINAL_WIDTH  = 12000;
  const ORIGINAL_HEIGHT = 6000;

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
  let _maxDpr = 2;

  function _ua() {
    return (navigator.userAgent || '').toLowerCase();
  }

  function _isSamsungDevice() {
    var ua = _ua();
    return ua.indexOf('samsung') >= 0 ||
           ua.indexOf('galaxy') >= 0 ||
           /sm-[a-z0-9]+/i.test(navigator.userAgent || '');
  }

  /** Tab S7 FE (SM-T73x), Tab S7/S8/S9 y Android tablet genérico */
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
      if (tex === 2048 || tex === 4096 || tex === 8192) {
        return { tier: tex <= 2048 ? 'low' : (tex <= 4096 ? 'mid' : 'high'), maxWidth: tex };
      }
      if (tier === 'low' || tier === 'mid' || tier === 'high') {
        return { tier: tier, maxWidth: LIMITS[tier] };
      }
    } catch (e) {}
    return null;
  }

  function detect() {
    if (_detected) {
      return {
        tier: _tier,
        maxWidth: _limit,
        maxTextureSize: _maxTexSize,
        isTablet: _isTablet,
        maxDpr: _maxDpr
      };
    }
    _detected = true;
    _isTablet = _detectTablet();

    var override = _urlOverride();
    if (override) {
      _tier = override.tier;
      _limit = override.maxWidth;
      _maxTexSize = _detectMaxTextureSize();
      if (_maxTexSize > 0 && _limit > _maxTexSize) {
        _limit = _maxTexSize;
        _tier = _limit <= 2048 ? 'low' : (_limit <= 4096 ? 'mid' : 'high');
      }
      _maxDpr = _tier === 'high' ? 2 : (_tier === 'mid' ? 1.5 : 1.25);
      console.log('[Ferrari/Device] Override URL → Tier:', _tier, '| maxWidth:', _limit);
      return { tier: _tier, maxWidth: _limit, maxTextureSize: _maxTexSize, isTablet: _isTablet, maxDpr: _maxDpr };
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

    // Tablets Samsung / Android grandes: no high (8192). Preferir mid (4096).
    // Antes score-=4 forzaba low(2048) y la imagen se veía blanda en Tab S7 FE.
    if (_isTablet || (isSamsung && Math.max(screen.width || 0, screen.height || 0) >= 1800)) {
      score -= 2;
      if (score >= 6) score = 5; // techo mid
    }

    if (_maxTexSize > 0) {
      if (_maxTexSize >= 8192)      score += 2;
      else if (_maxTexSize >= 4096) score += 0;
      else                          score -= 2;
    }

    if (score >= 6) { _tier = 'high'; _limit = LIMITS.high; }
    else if (score >= 3) { _tier = 'mid'; _limit = LIMITS.mid; }
    else { _tier = 'low'; _limit = LIMITS.low; }

    // Tablet: techo mid aunque el score diga high
    if (_isTablet && _tier === 'high') {
      _tier = 'mid';
      _limit = LIMITS.mid;
    }

    // Si la GPU no aguanta el límite elegido, bajar
    if (_maxTexSize > 0 && _limit > _maxTexSize) {
      _limit = Math.min(_limit, _maxTexSize);
      if (_limit <= 2048)      _tier = 'low';
      else if (_limit <= 4096) _tier = 'mid';
    }

    // DPR: tablets mid/low → menos píxeles de framebuffer = más FPS
    if (_tier === 'high') _maxDpr = 2;
    else if (_tier === 'mid') _maxDpr = _isTablet ? 1.35 : 1.5;
    else _maxDpr = 1.15;

    console.log('[Ferrari/Device] Tier:', _tier, '| maxWidth:', _limit,
      '| MAX_TEXTURE_SIZE:', _maxTexSize, '| score:', score,
      '| tablet:', _isTablet, '| maxDpr:', _maxDpr);

    return {
      tier: _tier,
      maxWidth: _limit,
      maxTextureSize: _maxTexSize,
      isTablet: _isTablet,
      maxDpr: _maxDpr
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
    return ORIGINAL_WIDTH > _limit;
  }

  function getMaxWidth() {
    detect();
    return _limit;
  }

  function getTier() {
    detect();
    return _tier;
  }

  function isTablet() {
    detect();
    return _isTablet;
  }

  function getMaxDpr() {
    detect();
    return _maxDpr;
  }

  function getOriginalWidth() { return ORIGINAL_WIDTH; }
  function getOriginalHeight() { return ORIGINAL_HEIGHT; }

  /** Baja un escalón de calidad (para reintento tras error WebGL) */
  function stepDown() {
    detect();
    if (_tier === 'high') { _tier = 'mid'; _limit = LIMITS.mid; }
    else if (_tier === 'mid') { _tier = 'low'; _limit = LIMITS.low; }
    else if (_limit > 1024) { _limit = 1024; }
    if (_maxTexSize > 0) _limit = Math.min(_limit, _maxTexSize);
    _maxDpr = _tier === 'low' ? 1.1 : 1.25;
    console.warn('[Ferrari/Device] stepDown →', _tier, _limit);
    return { tier: _tier, maxWidth: _limit, maxTextureSize: _maxTexSize, isTablet: _isTablet, maxDpr: _maxDpr };
  }

  window.FerrariDevice = {
    detect: detect,
    needsDownscale: needsDownscale,
    getMaxWidth: getMaxWidth,
    getTier: getTier,
    isTablet: isTablet,
    getMaxDpr: getMaxDpr,
    stepDown: stepDown,
    setMaxTextureSize: setMaxTextureSize,
    getOriginalWidth: getOriginalWidth,
    getOriginalHeight: getOriginalHeight
  };

  console.log('[Ferrari/Device] ✓ Módulo cargado');

})();
