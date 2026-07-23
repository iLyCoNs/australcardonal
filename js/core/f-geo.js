/**
 * f-geo.js — Estado y matemáticas geoespaciales Ferrari360
 *
 * Fuente de verdad:
 *   droneOrigin  { lat, lng, label? }
 *   northOffset  grados (Pannellum: yaw_norte + northOffset ≈ 0)
 *   pins[]       horizonte | ruta | poi
 *
 * Persistencia: localStorage['ferrari360_geo'] (+ data/geo.json vía Persist)
 */

'use strict';

(function () {

  const STORAGE_KEY = 'ferrari360_geo';
  const DIRTY_KEY = 'ferrari360_geo_dirty';

  const state = {
    droneOrigin: null, // { lat, lng, label }
    northOffset: 0,
    pins: [],
    updatedAt: null
  };

  let _dirty = localStorage.getItem(DIRTY_KEY) === '1';

  function _markDirty() {
    _dirty = true;
    try { localStorage.setItem(DIRTY_KEY, '1'); } catch (e) {}
  }

  function markClean() {
    _dirty = false;
    try { localStorage.removeItem(DIRTY_KEY); } catch (e) {}
  }

  function isDirty() { return !!_dirty; }

  /** Normaliza lat/lng con precisión estable (~1 cm) y acepta coma decimal */
  function _normCoord(n, kind) {
    if (n == null || n === '') return NaN;
    if (typeof n === 'string') {
      const parsed = parseCoordinate(n, kind);
      if (!isNaN(parsed)) return parsed;
    }
    const v = typeof n === 'number' ? n : parseFloat(String(n).trim().replace(',', '.'));
    if (!isFinite(v)) return NaN;
    if (kind === 'lat' && (v < -90 || v > 90)) return NaN;
    if (kind === 'lng' && (v < -180 || v > 180)) return NaN;
    return Math.round(v * 1e8) / 1e8;
  }

  function _hemiSign(token, kind) {
    if (!token) return null;
    const h = String(token).trim().toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (h === 'S' || h === 'SUR' || h === 'SOUTH') return kind === 'lng' ? null : -1;
    if (h === 'N' || h === 'NORTE' || h === 'NORTH') return kind === 'lng' ? null : 1;
    if (h === 'W' || h === 'O' || h === 'OESTE' || h === 'WEST') return kind === 'lat' ? null : -1;
    if (h === 'E' || h === 'ESTE' || h === 'EAST') return kind === 'lat' ? null : 1;
    return null;
  }

  /**
   * Acepta decimal o DMS, p.ej.:
   *  -41.8764917 | 41°52'35.37"S | 41º 52' 35.37" S | S 41 52 35.37
   */
  function parseCoordinate(raw, kind) {
    if (raw == null || raw === '') return NaN;
    if (typeof raw === 'number') {
      if (!isFinite(raw)) return NaN;
      if (kind === 'lat' && (raw < -90 || raw > 90)) return NaN;
      if (kind === 'lng' && (raw < -180 || raw > 180)) return NaN;
      return Math.round(raw * 1e8) / 1e8;
    }

    let s = String(raw).trim();
    if (!s) return NaN;

    // Coma decimal europea dentro de números (35,37 → 35.37)
    s = s.replace(/(\d),(\d)/g, '$1.$2');
    // Unificar símbolos de grado/minuto/segundo
    s = s
      .replace(/[º°]/g, '°')
      .replace(/[′’]/g, "'")
      .replace(/[″""]/g, '"')
      .replace(/\bdeg\b/gi, '°');

    let sign = 1;
    const hemiRe = /\b(Norte|Sur|Este|Oeste|North|South|East|West|[NSWEO])\b/gi;
    const hemis = s.match(hemiRe);
    if (hemis && hemis.length) {
      for (let i = hemis.length - 1; i >= 0; i--) {
        const sg = _hemiSign(hemis[i], kind || 'lat');
        if (sg != null) {
          sign = sg;
          break;
        }
      }
      s = s.replace(hemiRe, ' ');
    }

    if (/^\s*-/.test(s)) {
      sign = -1;
      s = s.replace(/^\s*-/, '');
    } else if (/^\s*\+/.test(s)) {
      s = s.replace(/^\s*\+/, '');
    }

    s = s.replace(/[°'"]/g, ' ').replace(/\s+/g, ' ').trim();
    const nums = s.match(/\d+(?:\.\d+)?/g);
    if (!nums || !nums.length) return NaN;

    const d = parseFloat(nums[0]);
    const m = nums[1] != null ? parseFloat(nums[1]) : 0;
    const sec = nums[2] != null ? parseFloat(nums[2]) : 0;
    if (![d, m, sec].every(isFinite)) return NaN;
    if (m >= 60 || sec >= 60) return NaN;

    let dec;
    if (nums.length === 1) {
      dec = sign * Math.abs(d);
    } else {
      dec = sign * (Math.abs(d) + m / 60 + sec / 3600);
    }

    if (kind === 'lat' && (dec < -90 || dec > 90)) return NaN;
    if (kind === 'lng' && (dec < -180 || dec > 180)) return NaN;
    return Math.round(dec * 1e8) / 1e8;
  }

  /**
   * Par lat/lng: "41°52'35.37\"S 72°44'50.81\"W" | "-41.87, -72.74" | "(...)"
   */
  function parseLatLngPair(raw) {
    if (raw == null) return null;
    let s = String(raw).trim();
    if (!s) return null;
    s = s.replace(/^[(\[]+|[)\]]+$/g, '').trim();
    s = s.replace(/(\d),(\d)/g, '$1.$2');

    let latStr = null;
    let lngStr = null;

    // Corte tras hemisferio de latitud (S/N/Sur/Norte…)
    const latHemi = s.match(/^(.+?\b(?:Sur|Norte|South|North|S|N)\b)/i);
    if (latHemi && latHemi[0].length < s.length - 1) {
      const rest = s.slice(latHemi[0].length).replace(/^[,;\s]+/, '').trim();
      if (rest) {
        latStr = latHemi[1].trim();
        lngStr = rest;
      }
    }

    if (!latStr || !lngStr) {
      const byComma = s.split(/[,;]/).map(x => x.trim()).filter(Boolean);
      if (byComma.length >= 2) {
        latStr = byComma[0];
        lngStr = byComma.slice(1).join(' ').trim();
      }
    }

    if (!latStr || !lngStr) {
      const twoDec = s.match(/^([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)$/);
      if (twoDec) {
        latStr = twoDec[1];
        lngStr = twoDec[2];
      }
    }

    if (!latStr || !lngStr) return null;

    const lat = parseCoordinate(latStr, 'lat');
    const lng = parseCoordinate(lngStr, 'lng');
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  }

  function _touch() {
    state.updatedAt = Date.now();
  }

  const CATEGORIES = {
    horizonte: {
      volcan:   { label: 'Volcán',   emoji: '🌋' },
      ciudad:   { label: 'Ciudad',   emoji: '🏙' },
      lago:     { label: 'Lago',     emoji: '💧' },
      montana:  { label: 'Montaña',  emoji: '⛰' },
      mirador:  { label: 'Mirador',  emoji: '👁' },
      otro:     { label: 'Otro',     emoji: '📍' }
    },
    ruta: {
      acceso:     { label: 'Acceso',     emoji: '🚧' },
      carretera:  { label: 'Carretera',  emoji: '🛣' },
      camino:     { label: 'Camino',     emoji: '🥾' },
      estacionamiento: { label: 'Estacionamiento', emoji: '🅿' },
      porton:     { label: 'Portón',     emoji: '🚪' },
      otro:       { label: 'Otro',       emoji: '📌' }
    },
    poi: {
      hospital:      { label: 'Hospital',        emoji: '🏥' },
      consultorio:   { label: 'Consultorio',     emoji: '🩺' },
      posta:         { label: 'Posta',           emoji: '🏥' },
      sapu:          { label: 'SAPU / Urgencia', emoji: '🚑' },
      asistencia:    { label: 'Asistencia médica', emoji: '💊' },
      farmacia:      { label: 'Farmacia',        emoji: '💊' },
      comisaria:     { label: 'Comisaría',       emoji: '👮' },
      reten:         { label: 'Retén',           emoji: '🚓' },
      bomberos:      { label: 'Bomberos',        emoji: '🚒' },
      colegio:       { label: 'Colegio',         emoji: '🏫' },
      supermercado:  { label: 'Supermercado',    emoji: '🛒' },
      comercio:      { label: 'Local comercial', emoji: '🏪' },
      negocio:       { label: 'Negocio',         emoji: '🏷️' },
      bencinera:     { label: 'Bencinera',       emoji: '⛽' },
      otro:          { label: 'Otro',            emoji: '📍' }
    },
    amenidad: {
      laguna: { label: 'Laguna', emoji: '◆' },
      lago: { label: 'Lago', emoji: '◆' },
      estero: { label: 'Estero', emoji: '◆' },
      cascada: { label: 'Cascada', emoji: '◆' },
      playa: { label: 'Playa', emoji: '◆' },
      muelle: { label: 'Muelle', emoji: '◆' },
      embarcadero: { label: 'Embarcadero', emoji: '◆' },
      boya: { label: 'Boya', emoji: '◆' },
      embarcacion: { label: 'Embarcaciones', emoji: '◆' },
      kayak: { label: 'Kayak', emoji: '◆' },
      pesca: { label: 'Pesca', emoji: '◆' },
      club_nautico: { label: 'Club náutico', emoji: '◆' },
      bosque: { label: 'Bosque', emoji: '◆' },
      sendero: { label: 'Sendero', emoji: '◆' },
      mirador: { label: 'Mirador', emoji: '◆' },
      fauna: { label: 'Fauna', emoji: '◆' },
      humedal: { label: 'Humedal', emoji: '◆' },
      reserva: { label: 'Reserva', emoji: '◆' },
      caballos: { label: 'Caballos', emoji: '◆' },
      bike: { label: 'Bicicleta', emoji: '◆' },
      picnic: { label: 'Picnic', emoji: '◆' },
      fogon: { label: 'Fogón', emoji: '◆' },
      camping: { label: 'Camping', emoji: '◆' },
      trekking: { label: 'Trekking', emoji: '◆' },
      plaza: { label: 'Plaza', emoji: '◆' },
      clubhouse: { label: 'Clubhouse', emoji: '◆' },
      cancha: { label: 'Cancha', emoji: '◆' },
      quincho: { label: 'Quincho', emoji: '◆' },
      porteria: { label: 'Portería', emoji: '◆' },
      estacionamiento_interno: { label: 'Estacionamiento', emoji: '◆' },
      acceso_loteo: { label: 'Acceso loteo', emoji: '◆' },
      agua_potable: { label: 'Agua potable', emoji: '◆' },
      energia: { label: 'Energía', emoji: '◆' },
      senal: { label: 'Señal / WiFi', emoji: '◆' },
      otro: { label: 'Otro', emoji: '◆' }
    }
  };

  // Merge runtime catalog if loaded first
  if (window.FerrariAmenitiesCatalog && window.FerrariAmenitiesCatalog.toGeoCategories) {
    CATEGORIES.amenidad = window.FerrariAmenitiesCatalog.toGeoCategories();
  }

  // ─── Math ─────────────────────────────────────────────────────────

  function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR;
    const dLng = (lng2 - lng1) * toR;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Bearing inicial en grados [0, 360): 0 = norte, 90 = este */
  function bearingDeg(lat1, lng1, lat2, lng2) {
    const toR = Math.PI / 180;
    const φ1 = lat1 * toR, φ2 = lat2 * toR;
    const Δλ = (lng2 - lng1) * toR;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  /**
   * Convierte bearing geográfico → yaw de Pannellum
   * (con northOffset calibrado: mirar al norte ⇒ yaw ≈ -northOffset)
   */
  function bearingToYaw(bearing) {
    // yaw = bearing - 360?  Facing north: yaw + northOffset = 0
    // Facing bearing B: yaw + northOffset = B  ⇒  yaw = B - northOffset
    let yaw = bearing - state.northOffset;
    yaw = ((yaw + 540) % 360) - 180;
    return yaw;
  }

  function yawToBearing(yaw) {
    let b = yaw + state.northOffset;
    b = ((b % 360) + 360) % 360;
    return b;
  }

  function formatDistance(meters) {
    if (meters == null || isNaN(meters)) return '—';
    if (meters < 1000) return `${Math.round(meters)} m`;
    if (meters < 10000) return `${(meters / 1000).toFixed(2)} km`;
    return `${(meters / 1000).toFixed(1)} km`;
  }

  /** ETA aproximada en auto urbano (~45 km/h) — fallback línea recta */
  function formatEtaMinutes(meters, kmh) {
    if (meters == null || isNaN(meters)) return '—';
    const speed = kmh || 45;
    const min = (meters / 1000) / speed * 60;
    if (min < 1) return '< 1 min';
    if (min < 60) return `≈ ${Math.round(min)} min`;
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `≈ ${h} h ${m} min`;
  }

  /** ETA desde duración real de ruta (segundos OSRM) */
  function formatEtaSeconds(sec) {
    if (sec == null || isNaN(sec)) return '—';
    const min = sec / 60;
    if (min < 1) return '< 1 min';
    if (min < 60) return `${Math.max(1, Math.round(min))} min`;
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  /**
   * Horizonte = landmark visual, pero si tiene GPS (ej. Chaitén) sí conviene
   * ruta OSRM real. La UI debe etiquetar "línea recta" vs "ruta en auto"
   * para que el ETA no parezca “cambiar solo”.
   */
  function usesDrivingRoute(pin) {
    return !!(pin && pin.lat != null && pin.lng != null);
  }

  /** Texto Distancia / ETA para UI (pins, editor, dock) */
  function formatPinDistanceEta(pin) {
    if (!pin) return '—';
    const routeDist = pin._routeDistM != null ? pin._routeDistM : pin.routeDistM;
    const routeSec = pin._routeSec != null ? pin._routeSec : pin.routeSec;
    const hasRoute = routeDist != null && routeSec != null;
    const hasAir = pin._distM != null;
    if (hasRoute) {
      return `Ruta ${formatDistance(routeDist)} · ${formatEtaSeconds(routeSec)}`;
    }
    if (hasAir) {
      const base = `≈ ${formatDistance(pin._distM)} · ${formatEtaMinutes(pin._distM)}`;
      return pin.tipo === 'horizonte' ? `${base} (calculando ruta…)` : base;
    }
    return '—';
  }

  function _clearDrivingRoute(pin) {
    if (!pin) return;
    pin._routeDistM = null;
    pin._routeSec = null;
    pin._routeSource = null;
    if (pin._routeDurationS != null) pin._routeDurationS = null;
  }

  function _syncRouteRuntime(pin) {
    if (!pin) return;
    if (pin.routeDistM != null && pin.routeSec != null) {
      pin._routeDistM = pin.routeDistM;
      pin._routeSec = pin.routeSec;
      pin._routeSource = pin.routeSource || 'osrm';
    }
  }

  // ─── Rutas reales (OSRM / OpenStreetMap: calles + ferries mapeados) ──
  const _routeCache = new Map();
  let _routeQueue = Promise.resolve();
  const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';

  function _routeKey(oLat, oLng, dLat, dLng) {
    return [
      oLat.toFixed(4), oLng.toFixed(4),
      dLat.toFixed(4), dLng.toFixed(4)
    ].join('|');
  }

  function fetchDrivingRoute(destLat, destLng) {
    const o = state.droneOrigin;
    if (!o || destLat == null || destLng == null) return Promise.resolve(null);
    const key = _routeKey(o.lat, o.lng, destLat, destLng);
    if (_routeCache.has(key)) return Promise.resolve(_routeCache.get(key));

    _routeQueue = _routeQueue.then(async () => {
      if (_routeCache.has(key)) return _routeCache.get(key);
      try {
        const url = `${OSRM_URL}/${o.lng},${o.lat};${destLng},${destLat}?overview=false&alternatives=false&steps=false`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('OSRM ' + res.status);
        const data = await res.json();
        const route = data && data.routes && data.routes[0];
        if (!route) {
          _routeCache.set(key, null);
          return null;
        }
        const out = {
          distM: route.distance,
          durationSec: route.duration,
          source: 'osrm'
        };
        _routeCache.set(key, out);
        return out;
      } catch (e) {
        console.warn('[Ferrari/Geo] Ruta OSRM no disponible:', e.message);
        _routeCache.set(key, null);
        return null;
      }
    });
    return _routeQueue;
  }

  async function enrichPinRoutes(force) {
    if (!state.droneOrigin) return;
    const pins = state.pins.filter(p =>
      p.lat != null && p.lng != null && usesDrivingRoute(p)
    );
    let changed = false;
    for (const pin of pins) {
      // Ignorar overrides viejos (Google/manual): siempre recalcular OSRM
      if (pin.routeManual || pin.routeSource === 'google') {
        pin.routeManual = false;
        pin.routeSource = null;
      }
      if (!force && pin._routeDistM != null && pin._routeSec != null && pin._routeSource === 'osrm') continue;
      const route = await fetchDrivingRoute(pin.lat, pin.lng);
      if (route) {
        pin._routeDistM = route.distM;
        pin._routeSec = route.durationSec;
        pin._routeSource = route.source;
        pin.routeDistM = route.distM;
        pin.routeSec = route.durationSec;
        pin.routeSource = route.source;
        pin.routeManual = false;
        changed = true;
      }
    }
    if (changed && window.FerrariGeoPins && window.FerrariGeoPins.markDirty) {
      window.FerrariGeoPins.markDirty();
    }
  }

  function distanceFromOrigin(lat, lng) {
    if (!state.droneOrigin) return null;
    return haversineM(state.droneOrigin.lat, state.droneOrigin.lng, lat, lng);
  }

  function mapsLinks(destLat, destLng) {
    const o = state.droneOrigin;
    const dest = `${destLat},${destLng}`;
    const origin = o ? `${o.lat},${o.lng}` : '';
    return {
      google: origin
        ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=driving`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`,
      waze: `https://waze.com/ul?ll=${encodeURIComponent(dest)}&navigate=yes`,
      place: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`,
      satellite: `https://www.google.com/maps/@${destLat},${destLng},17z/data=!3m1!1e3`
    };
  }

  // ─── CRUD ─────────────────────────────────────────────────────────

  function _notify() {
    if (window.FerrariGeoPins && window.FerrariGeoPins.markDirty) {
      window.FerrariGeoPins.markDirty();
    }
    if (window.FerrariCompass && window.FerrariCompass.refresh) {
      window.FerrariCompass.refresh();
    }
    try {
      document.dispatchEvent(new CustomEvent('ferrari:geo-changed'));
    } catch (e) {}
  }

  function setDroneOrigin(lat, lng, label) {
    const la = _normCoord(lat, 'lat');
    const ln = _normCoord(lng, 'lng');
    if (isNaN(la) || isNaN(ln)) return false;
    state.droneOrigin = {
      lat: la,
      lng: ln,
      label: (label || 'Origen dron').trim()
    };
    _touch();
    _markDirty();
    _recomputePinMetrics();
    saveLocal();
    _notify();
    return true;
  }

  function clearDroneOrigin() {
    state.droneOrigin = null;
    _touch();
    _markDirty();
    _recomputePinMetrics();
    saveLocal();
    _notify();
  }

  function setNorthOffset(offsetDeg) {
    state.northOffset = ((offsetDeg % 360) + 360) % 360;
    if (state.northOffset > 180) state.northOffset -= 360;
    // Aplicar a Pannellum
    try {
      if (window.Ferrari && window.Ferrari.viewer && window.Ferrari.viewer.setNorthOffset) {
        window.Ferrari.viewer.setNorthOffset(state.northOffset);
      }
    } catch (e) {}
    // Reposicionar pins con coords GPS según nuevo norte
    _syncPinsYawFromCoords();
    _touch();
    _markDirty();
    saveLocal();
    _notify();
  }

  /** Fija el norte haciendo click en un yaw del panorama */
  function setNorthFromYaw(yaw) {
    // Queremos que ese yaw sea "norte" ⇒ yaw + northOffset = 0
    setNorthOffset(-yaw);
  }

  function addPin(data) {
    const pin = Object.assign({
      id: (window.FerrariState && window.FerrariState.generateId)
        ? window.FerrariState.generateId()
        : ('geo_' + Math.random().toString(36).slice(2, 10)),
      tipo: 'horizonte',
      categoria: 'otro',
      titulo: '',
      pitch: -8,
      yaw: 0,
      lat: null,
      lng: null,
      notas: '',
      createdAt: Date.now()
    }, data || {});

    if (pin.lat != null && pin.lng != null && state.droneOrigin) {
      const dist = distanceFromOrigin(pin.lat, pin.lng);
      pin._distM = dist;
      const brg = bearingDeg(state.droneOrigin.lat, state.droneOrigin.lng, pin.lat, pin.lng);
      pin._bearing = brg;
      if (data && data.autoYaw !== false) {
        pin.yaw = bearingToYaw(brg);
      }
      if (usesDrivingRoute(pin)) {
        fetchDrivingRoute(pin.lat, pin.lng).then(route => {
          if (!route) return;
          pin._routeDistM = route.distM;
          pin._routeSec = route.durationSec;
          pin._routeSource = route.source;
          pin.routeDistM = route.distM;
          pin.routeSec = route.durationSec;
          pin.routeSource = route.source;
          pin.routeManual = false;
          if (window.FerrariGeoPins && window.FerrariGeoPins.markDirty) {
            window.FerrariGeoPins.markDirty();
          }
        }).catch(() => {});
      } else {
        _clearDrivingRoute(pin);
      }
    }

    state.pins.push(pin);
    _touch();
    _markDirty();
    saveLocal();
    _notify();
    return pin.id;
  }

  function updatePin(id, patch) {
    const pin = state.pins.find(p => p.id === id);
    if (!pin) return false;
    Object.assign(pin, patch);
    if (pin.lat != null && pin.lng != null && state.droneOrigin) {
      pin._distM = distanceFromOrigin(pin.lat, pin.lng);
      pin._bearing = bearingDeg(state.droneOrigin.lat, state.droneOrigin.lng, pin.lat, pin.lng);
      if (!usesDrivingRoute(pin)) {
        _clearDrivingRoute(pin);
      } else if (patch.lat != null || patch.lng != null || patch.tipo != null) {
        pin.routeManual = false;
        pin._routeDistM = null;
        pin._routeSec = null;
        fetchDrivingRoute(pin.lat, pin.lng).then(route => {
          if (!route) return;
          pin._routeDistM = route.distM;
          pin._routeSec = route.durationSec;
          pin._routeSource = route.source;
          pin.routeDistM = route.distM;
          pin.routeSec = route.durationSec;
          pin.routeSource = route.source;
          pin.routeManual = false;
          if (window.FerrariGeoPins && window.FerrariGeoPins.markDirty) {
            window.FerrariGeoPins.markDirty();
          }
        }).catch(() => {});
      } else {
        _syncRouteRuntime(pin);
      }
    } else {
      pin._distM = null;
      pin._bearing = null;
      _clearDrivingRoute(pin);
    }
    _touch();
    _markDirty();
    saveLocal();
    _notify();
    return true;
  }

  function removePin(id) {
    const i = state.pins.findIndex(p => p.id === id);
    if (i === -1) return false;
    state.pins.splice(i, 1);
    _touch();
    _markDirty();
    saveLocal();
    _notify();
    return true;
  }

  function getPin(id) {
    return state.pins.find(p => p.id === id) || null;
  }

  function _recomputePinMetrics() {
    state.pins.forEach(pin => {
      if (pin.lat != null && pin.lng != null && state.droneOrigin) {
        pin._distM = distanceFromOrigin(pin.lat, pin.lng);
        pin._bearing = bearingDeg(state.droneOrigin.lat, state.droneOrigin.lng, pin.lat, pin.lng);
        _syncRouteRuntime(pin);
      } else {
        pin._distM = null;
        pin._bearing = null;
        pin._routeDistM = null;
        pin._routeSec = null;
      }
    });
    // Rutas reales en segundo plano (calles / ferries OSM)
    enrichPinRoutes(true).catch(() => {});
  }

  function _syncPinsYawFromCoords() {
    if (!state.droneOrigin) return;
    state.pins.forEach(pin => {
      if (pin.lat == null || pin.lng == null) return;
      if (pin.lockYaw) return; // usuario arrastró y bloqueó
      pin.yaw = bearingToYaw(pin._bearing != null
        ? pin._bearing
        : bearingDeg(state.droneOrigin.lat, state.droneOrigin.lng, pin.lat, pin.lng));
    });
  }

  // ─── Persistencia ─────────────────────────────────────────────────

  function toJSON() {
    return {
      version: 1,
      updatedAt: state.updatedAt || null,
      droneOrigin: state.droneOrigin
        ? {
            lat: state.droneOrigin.lat,
            lng: state.droneOrigin.lng,
            label: state.droneOrigin.label || 'Origen dron'
          }
        : null,
      northOffset: state.northOffset,
      pins: state.pins.map(p => ({
        id: p.id,
        tipo: p.tipo,
        categoria: p.categoria,
        titulo: p.titulo,
        pitch: p.pitch,
        yaw: p.yaw,
        lat: p.lat,
        lng: p.lng,
        notas: p.notas || '',
        lockYaw: !!p.lockYaw,
        createdAt: p.createdAt,
        // Ruta persistida (Google/manual/OSRM) — sobrevive a recargas
        routeDistM: p.routeDistM != null ? p.routeDistM : (p._routeDistM != null ? p._routeDistM : null),
        routeSec: p.routeSec != null ? p.routeSec : (p._routeSec != null ? p._routeSec : null),
        routeSource: p.routeSource || p._routeSource || null,
        routeManual: !!p.routeManual
      }))
    };
  }

  function fromJSON(data) {
    if (!data || typeof data !== 'object') return;
    let origin = data.droneOrigin || null;
    if (origin && origin.lat != null && origin.lng != null) {
      const la = _normCoord(origin.lat, 'lat');
      const ln = _normCoord(origin.lng, 'lng');
      origin = isNaN(la) || isNaN(ln)
        ? null
        : { lat: la, lng: ln, label: (origin.label || 'Origen dron').trim() };
    } else {
      origin = null;
    }
    state.droneOrigin = origin;
    state.northOffset = typeof data.northOffset === 'number' ? data.northOffset : 0;
    state.pins = Array.isArray(data.pins) ? data.pins.slice() : [];
    state.updatedAt = typeof data.updatedAt === 'number' ? data.updatedAt : null;
    _recomputePinMetrics();
    try {
      if (window.Ferrari && window.Ferrari.viewer && window.Ferrari.viewer.setNorthOffset) {
        window.Ferrari.viewer.setNorthOffset(state.northOffset);
      }
    } catch (e) {}
    _notify();
  }

  /**
   * Aplica geo remoto sin pisar un origen local pendiente de publicar (dirty)
   * ni un origen local más reciente cuando el remoto viene vacío/antiguo.
   */
  function applyRemote(remote) {
    if (!remote || typeof remote !== 'object') return false;

    if (_dirty) {
      console.log('[Ferrari/Geo] Remoto no aplica: hay cambios locales sin Guardar (origen/norte/pins).');
      return false;
    }

    let local = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) local = JSON.parse(raw);
    } catch (e) {}

    const remoteOrigin = remote.droneOrigin || null;
    const localOrigin = (local && local.droneOrigin) || state.droneOrigin || null;
    const localTs = (local && local.updatedAt) || state.updatedAt || 0;
    const remoteTs = remote.updatedAt || 0;

    const merged = Object.assign({}, remote);

    // Nunca borrar un origen local válido con un remoto vacío
    if (localOrigin && !remoteOrigin) {
      merged.droneOrigin = localOrigin;
      if (local && typeof local.northOffset === 'number') {
        merged.northOffset = local.northOffset;
      }
      console.log('[Ferrari/Geo] Conservando origen local (remoto sin coordenadas).');
    } else if (localOrigin && remoteOrigin && localTs > remoteTs) {
      merged.droneOrigin = localOrigin;
      if (local && typeof local.northOffset === 'number') {
        merged.northOffset = local.northOffset;
      }
      console.log('[Ferrari/Geo] Conservando origen local más reciente que el remoto.');
    }

    fromJSON(merged);
    // Persistencia limpia (ya sincronizado con remoto/merge) — no marcar dirty
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toJSON()));
    } catch (e) {}
    markClean();
    return true;
  }

  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toJSON()));
      // Snapshot unificado para no perder origen entre recargas
      try {
        const prev = localStorage.getItem('ferrari360_datos');
        const pack = prev ? JSON.parse(prev) : { version: 1, lotes: [] };
        pack.geo = toJSON();
        pack.updatedAt = Date.now();
        localStorage.setItem('ferrari360_datos', JSON.stringify(pack));
      } catch (e) {}
    } catch (e) {
      console.warn('[Ferrari/Geo] No se pudo guardar local', e);
    }
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      fromJSON(JSON.parse(raw));
      _dirty = localStorage.getItem(DIRTY_KEY) === '1';
    } catch (e) {}
  }

  function categoryMeta(tipo, categoria) {
    const bag = CATEGORIES[tipo] || CATEGORIES.horizonte;
    return bag[categoria] || bag.otro || { label: categoria, emoji: '📍' };
  }

  // ─── API ──────────────────────────────────────────────────────────
  window.FerrariGeo = {
    STORAGE_KEY,
    CATEGORIES,
    get state() { return state; },
    get droneOrigin() { return state.droneOrigin; },
    get northOffset() { return state.northOffset; },
    get pins() { return state.pins; },

    haversineM,
    bearingDeg,
    bearingToYaw,
    yawToBearing,
    formatDistance,
    formatEtaMinutes,
    formatEtaSeconds,
    formatPinDistanceEta,
    usesDrivingRoute,
    fetchDrivingRoute,
    enrichPinRoutes,
    distanceFromOrigin,
    mapsLinks,
    categoryMeta,
    parseCoordinate,
    parseLatLngPair,

    setDroneOrigin,
    clearDroneOrigin,
    setNorthOffset,
    setNorthFromYaw,
    addPin,
    updatePin,
    removePin,
    getPin,

    toJSON,
    fromJSON,
    applyRemote,
    saveLocal,
    loadLocal,
    isDirty,
    markClean
  };

  // Auto-load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadLocal, { once: true });
  } else {
    loadLocal();
  }

  console.log('[Ferrari/Geo] ✓ Módulo inicializado');

})();
