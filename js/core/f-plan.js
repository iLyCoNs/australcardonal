/**
 * f-plan.js — Feature flags Plan Premium (lee data/plan.json + brand.features)
 */
'use strict';
(function () {
  const DEFAULTS = {
    copilot: true, voice: true, tourism: true, weather: true,
    calendar: true, finance: true, nearby: true, mapTab: true,
    gallery: true, pdf: true, cta360: true, buyerDockLotes: true,
    drawingTools: true, draggableWidgets: true
  };

  let _features = Object.assign({}, DEFAULTS);
  let _plan = 'premium';

  function mergeBrandFeatures() {
    try {
      const b = window.FerrariBrandDock && window.FerrariBrandDock.getBrand
        ? window.FerrariBrandDock.getBrand()
        : null;
      const brand = b || (window.__KPK_BRAND__ || null);
      if (brand && brand.features && typeof brand.features === 'object') {
        Object.keys(brand.features).forEach(function (k) {
          _features[k] = !!brand.features[k];
        });
      }
      if (brand && brand.plan) _plan = brand.plan;
    } catch (e) {}
  }

  function applyDomGates() {
    document.documentElement.setAttribute('data-kpk-plan', _plan);
    document.body.classList.toggle('kpk-feat-copilot-off', !_features.copilot);
    document.body.classList.toggle('kpk-feat-weather-off', !_features.weather);
    document.body.classList.toggle('kpk-feat-tourism-off', !_features.tourism);

    if (!_features.copilot) {
      const bubble = document.getElementById('kpk-ai-bubble');
      const panel = document.getElementById('kpk-ai-panel');
      const mobile = document.getElementById('kpk-mobile-ai-bubble-popup');
      if (bubble) bubble.style.display = 'none';
      if (panel) { panel.style.display = 'none'; panel.classList.remove('is-open'); }
      if (mobile) mobile.style.display = 'none';
    }
    if (!_features.weather) {
      const w = document.getElementById('kpk-weather-widget');
      if (w) w.style.display = 'none';
    }
  }

  function enabled(key) {
    mergeBrandFeatures();
    if (key == null) return Object.assign({}, _features);
    return !!_features[key];
  }

  function setFeatures( partial ) {
    Object.assign(_features, partial || {});
    try {
      localStorage.setItem('kpk_features_v1', JSON.stringify(_features));
    } catch (e) {}
    applyDomGates();
  }

  function boot() {
    try {
      const cached = localStorage.getItem('kpk_features_v1');
      if (cached) Object.assign(_features, JSON.parse(cached));
    } catch (e) {}
    fetch('data/plan.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.features) Object.assign(_features, j.features);
        if (j && j.plan) _plan = j.plan;
        mergeBrandFeatures();
        applyDomGates();
      })
      .catch(function () {
        mergeBrandFeatures();
        applyDomGates();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.FerrariPlan = {
    plan: function () { return _plan; },
    enabled: enabled,
    setFeatures: setFeatures,
    refresh: function () { mergeBrandFeatures(); applyDomGates(); }
  };
})();
