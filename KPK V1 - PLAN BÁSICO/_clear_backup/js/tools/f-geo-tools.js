/**
 * f-geo-tools.js — Herramientas: Norte, Origen dron, Horizonte, Ruta, Lugares cercanos
 */

'use strict';

(function () {

  let _mode = null; // 'north' | 'horizonte' | 'ruta' | null
  let _bound = false;

  function activate(mode) {
    window.FerrariTools.deactivateAllTools();
    _mode = mode;
    window.currentTool = 'geo-' + mode;
    document.getElementById('panorama-container').classList.add('geo-tool-active');

    const hints = {
      north: 'Fijar Norte: haz clic en la dirección que apunta al Norte real.',
      horizonte: 'Pin horizonte: clic en el panorama, luego busca “Volcán Osorno” u otra ciudad para auto-coordenadas.',
      ruta: 'Pin de ruta: clic para marcar acceso; busca la carretera o dirección para GPS automático.'
    };
    window.FerrariUI && window.FerrariUI.showToast(hints[mode] || 'Herramienta geo activa.', 'info');
    window.FerrariHUD && window.FerrariHUD.showDraw('geo-' + mode);
  }

  function deactivate() {
    if (!_mode) return;
    _mode = null;
    document.getElementById('panorama-container').classList.remove('geo-tool-active');
    window.FerrariHUD && window.FerrariHUD.hideDraw();
  }

  function isActive() { return _mode !== null; }
  function getMode() { return _mode; }

  function bindEvents() {
    if (_bound) return;
    _bound = true;
    const container = document.getElementById('pannellum-viewer');
    if (!container) return;
    container.addEventListener('click', _onClick, false);
  }

  function _getCoords(e) {
    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return null;
    try { return viewer.mouseEventToCoords(e); } catch (err) { return null; }
  }

  function _hitGeoPin(e) {
    if (e.target && e.target.closest && (
      e.target.closest('.f-geo-pin') ||
      e.target.closest('#f-geo-pins-layer') ||
      e.target.closest('#f-geo-editor') ||
      e.target.closest('#kpk-panel') ||
      e.target.closest('#kpk-brand-dock') ||
      e.target.closest('#kpk-buyer-dock')
    )) return true;

    // Pins viven fuera de #pannellum-viewer: el click “fantasma” tras un drag
    // aterriza en el canvas. Comprobar qué hay bajo el cursor.
    try {
      const x = e.clientX;
      const y = e.clientY;
      if (x == null || y == null) return false;
      const stack = document.elementsFromPoint
        ? document.elementsFromPoint(x, y)
        : [document.elementFromPoint(x, y)].filter(Boolean);
      return stack.some(n => n && n.closest && n.closest('.f-geo-pin'));
    } catch (err) {
      return false;
    }
  }

  function _onClick(e) {
    if (!_mode) return;
    if (e.button !== 0) return;
    if (window.FerrariGeoPins) {
      if (typeof window.FerrariGeoPins.isDragging === 'function' && window.FerrariGeoPins.isDragging()) return;
      if (typeof window.FerrariGeoPins.consumeInteractGuard === 'function' && window.FerrariGeoPins.consumeInteractGuard()) return;
    }
    if (_hitGeoPin(e)) return;

    const coords = _getCoords(e);
    if (!coords) return;
    const [pitch, yaw] = coords;

    if (_mode === 'north') {
      window.FerrariGeo.setNorthFromYaw(yaw);
      window.FerrariUI && window.FerrariUI.showToast('Norte fijado. La brújula ya está calibrada.', 'success');
      deactivate();
      window.FerrariTools.deactivateAllTools();
      return;
    }

    if (_mode === 'horizonte' || _mode === 'ruta') {
      const id = window.FerrariGeo.addPin({
        tipo: _mode,
        categoria: _mode === 'ruta' ? 'acceso' : 'ciudad',
        titulo: _mode === 'ruta' ? 'Acceso' : 'Lugar',
        pitch,
        yaw,
        autoYaw: false,
        lockYaw: true
      });
      if (window.FerrariGeoEditor) window.FerrariGeoEditor.open(id);
      // Mantener tool activo para colocar varios
    }
  }

  // ─── Origen dron (prompt premium via editor modal) ───────────────

  function openOriginDialog() {
    window.FerrariTools.deactivateAllTools();
    if (window.FerrariGeoEditor) window.FerrariGeoEditor.openOrigin();
  }

  // ─── Lugares cercanos (Overpass) ─────────────────────────────────

  const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

  /** Filtros Overpass por categoría (nwr = node/way/relation) */
  const POI_QUERIES = {
    hospital:     ['nwr["amenity"="hospital"]', 'nwr["healthcare"="hospital"]'],
    consultorio:  ['nwr["amenity"="doctors"]', 'nwr["healthcare"="doctor"]', 'nwr["healthcare"="centre"]'],
    posta:        ['nwr["amenity"="clinic"]', 'nwr["healthcare"="clinic"]'],
    sapu:         ['nwr["amenity"="clinic"]["emergency"="yes"]', 'nwr["emergency"="yes"]["healthcare"]'],
    asistencia:   ['nwr["amenity"="hospital"]', 'nwr["amenity"="clinic"]', 'nwr["amenity"="doctors"]', 'nwr["healthcare"]'],
    farmacia:     ['nwr["amenity"="pharmacy"]'],
    comisaria:    ['nwr["amenity"="police"]'],
    reten:        ['nwr["amenity"="police"]'],
    bomberos:     ['nwr["amenity"="fire_station"]'],
    colegio:      ['nwr["amenity"="school"]', 'nwr["amenity"="kindergarten"]', 'nwr["amenity"="college"]'],
    supermercado: ['nwr["shop"="supermarket"]', 'nwr["shop"="hypermarket"]'],
    comercio:     ['nwr["shop"="convenience"]', 'nwr["shop"="mall"]', 'nwr["shop"="department_store"]', 'nwr["shop"="general"]'],
    negocio:      ['nwr["shop"="yes"]', 'nwr["craft"]', 'nwr["office"="company"]'],
    bencinera:    ['nwr["amenity"="fuel"]']
  };

  function catFromTags(tags) {
    if (!tags) return 'otro';
    const name = String(tags.name || tags['name:es'] || '').toLowerCase();
    if (tags.amenity === 'fire_station') return 'bomberos';
    if (tags.amenity === 'pharmacy') return 'farmacia';
    if (tags.amenity === 'fuel') return 'bencinera';
    if (tags.amenity === 'school' || tags.amenity === 'kindergarten' || tags.amenity === 'college') return 'colegio';
    if (tags.shop === 'supermarket' || tags.shop === 'hypermarket') return 'supermercado';
    if (tags.shop === 'convenience' || tags.shop === 'mall' || tags.shop === 'department_store' || tags.shop === 'general') return 'comercio';
    if (tags.shop || tags.craft || tags.office === 'company') return 'negocio';
    if (tags.amenity === 'hospital' || tags.healthcare === 'hospital') return 'hospital';
    if (tags.amenity === 'doctors' || tags.healthcare === 'doctor') return 'consultorio';
    if (tags.amenity === 'clinic' || tags.healthcare === 'clinic' || tags.healthcare === 'centre') {
      if (/posta|sapu|urgencia|cesfam|consultorio/.test(name)) {
        if (/sapu|urgencia/.test(name)) return 'sapu';
        if (/posta|cesfam/.test(name)) return 'posta';
        if (/consultorio/.test(name)) return 'consultorio';
      }
      if (tags.emergency === 'yes') return 'sapu';
      return 'posta';
    }
    if (tags.amenity === 'police') {
      return /ret[eé]n|reten/.test(name) ? 'reten' : 'comisaria';
    }
    if (tags.healthcare || tags.amenity === 'clinic' || tags.amenity === 'doctors') return 'asistencia';
    return 'otro';
  }

  function _elCoords(el) {
    if (el.lat != null && el.lon != null) return { lat: el.lat, lon: el.lon };
    if (el.center && el.center.lat != null) return { lat: el.center.lat, lon: el.center.lon };
    return null;
  }

  async function fetchNearby(radiusM, categories, origin) {
    if (!origin) origin = window.FerrariGeo.droneOrigin;
    if (!origin) {
      window.FerrariUI && window.FerrariUI.showToast('Define primero el Origen Dron (coordenadas de la foto).', 'error');
      openOriginDialog();
      return;
    }

    const r = radiusM || 8000;
    const cats = Array.isArray(categories) && categories.length
      ? categories.filter(c => c !== 'otro')
      : Object.keys(POI_QUERIES);

    window.FerrariUI && window.FerrariUI.showToast('Buscando lugares de primera necesidad…', 'info');

    const parts = [];
    const seenQ = new Set();
    cats.forEach(c => {
      (POI_QUERIES[c] || []).forEach(q => {
        if (seenQ.has(q)) return;
        seenQ.add(q);
        parts.push(`${q}(around:${r},${origin.lat},${origin.lng});`);
      });
    });

    if (!parts.length) {
      window.FerrariUI && window.FerrariUI.showToast('Selecciona al menos una categoría.', 'info');
      return;
    }

    const query = `[out:json][timeout:35];(${parts.join('\n')});out center tags;`;

    let data = null;
    let lastErr = null;
    for (const url of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        data = await res.json();
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!data || !Array.isArray(data.elements)) {
      window.FerrariUI && window.FerrariUI.showToast(
        'No se pudieron cargar lugares (' + (lastErr && lastErr.message) + ').',
        'error'
      );
      return;
    }

    let added = 0;
    const existing = new Set(
      window.FerrariGeo.pins
        .filter(p => p.tipo === 'poi' && p.lat != null)
        .map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    );

    const scored = data.elements
      .map(el => {
        const c = _elCoords(el);
        if (!c) return null;
        return {
          el,
          lat: c.lat,
          lon: c.lon,
          dist: window.FerrariGeo.haversineM(origin.lat, origin.lng, c.lat, c.lon)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.dist - b.dist);

    for (const { el, lat, lon } of scored) {
      const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
      if (existing.has(key)) continue;

      const cat = catFromTags(el.tags);
      const health = ['hospital', 'consultorio', 'posta', 'sapu', 'farmacia', 'asistencia'];
      const accepted =
        cats.indexOf(cat) !== -1 ||
        (cats.indexOf('asistencia') !== -1 && health.indexOf(cat) !== -1) ||
        (cats.indexOf('comisaria') !== -1 && cat === 'reten') ||
        (cats.indexOf('reten') !== -1 && cat === 'comisaria');
      if (!accepted) continue;

      const title = (el.tags && (el.tags.name || el.tags['name:es'])) ||
        (window.FerrariGeo.categoryMeta('poi', cat).label);

      const finalCat = cats.indexOf(cat) !== -1 ? cat
        : (cats.indexOf('asistencia') !== -1 && health.indexOf(cat) !== -1 ? (cat === 'otro' ? 'asistencia' : cat) : cat);

      window.FerrariGeo.addPin({
        tipo: 'poi',
        categoria: finalCat,
        titulo: title,
        lat,
        lng: lon,
        pitch: -6,
        autoYaw: true,
        lockYaw: false,
        notas: el.tags && el.tags.name ? '' : 'OpenStreetMap'
      });
      existing.add(key);
      added++;
      if (added >= 80) break;
    }

    window.FerrariUI && window.FerrariUI.showToast(
      added ? `✓ ${added} lugares cercanos añadidos.` : 'No se encontraron lugares nuevos en el radio.',
      added ? 'success' : 'info'
    );
    try { document.dispatchEvent(new CustomEvent('ferrari:geo-changed')); } catch (e) {}
  }

  function openNearbyDialog() {
    window.FerrariTools.deactivateAllTools();
    if (window.FerrariGeoEditor && window.FerrariGeoEditor.openNearby) {
      window.FerrariGeoEditor.openNearby();
    } else {
      fetchNearby(8000, null, window.FerrariGeo.droneOrigin);
    }
  }

  window.FerrariGeoTools = {
    activate,
    deactivate,
    isActive,
    getMode,
    bindEvents,
    openOriginDialog,
    openNearbyDialog,
    fetchNearby
  };

  console.log('[Ferrari/GeoTools] ✓ Módulo inicializado');

})();
