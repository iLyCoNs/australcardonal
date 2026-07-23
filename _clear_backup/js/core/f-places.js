/**
 * f-places.js — Búsqueda de lugares + geocoding
 *
 * - Nominatim (OpenStreetMap): gratis, sin API key
 * - Google Places Autocomplete: opcional si hay
 *   localStorage['ferrari_google_places_key']
 *
 * Expone: window.FerrariPlaces
 */

'use strict';

(function () {

  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  let _lastNom = 0;

  async function _throttleNominatim() {
    const wait = Math.max(0, 1100 - (Date.now() - _lastNom));
    if (wait) await new Promise(r => setTimeout(r, wait));
    _lastNom = Date.now();
  }

  /**
   * @param {string} query
   * @param {{ lat?: number, lng?: number, limit?: number, countrycodes?: string }} opts
   * @returns {Promise<Array<{id,name,label,lat,lng,type,source}>>}
   */
  async function search(query, opts) {
    const q = (query || '').trim();
    if (q.length < 2) return [];

    const o = opts || {};
    const googleKey = localStorage.getItem('ferrari_google_places_key');

    if (googleKey) {
      try {
        const g = await _searchGoogle(q, googleKey, o);
        if (g.length) return g;
      } catch (e) {
        console.warn('[Ferrari/Places] Google falló, uso Nominatim', e);
      }
    }

    return _searchNominatim(q, o);
  }

  async function _searchNominatim(q, o) {
    await _throttleNominatim();
    const params = new URLSearchParams({
      q,
      format: 'json',
      addressdetails: '1',
      limit: String(o.limit || 6),
      'accept-language': 'es'
    });
    if (o.countrycodes) params.set('countrycodes', o.countrycodes);
    // Sesgo hacia el origen dron si existe
    if (o.lat != null && o.lng != null) {
      params.set('viewbox', `${o.lng - 2},${o.lat + 2},${o.lng + 2},${o.lat - 2}`);
      params.set('bounded', '0');
    }

    const r = await fetch(`${NOMINATIM}/search?${params}`, {
      headers: { Accept: 'application/json' }
    });
    if (!r.ok) throw new Error('Nominatim ' + r.status);
    const data = await r.json();
    return (data || []).map((item, i) => ({
      id: 'nom_' + (item.place_id || i),
      name: _shortName(item),
      label: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      type: item.type || item.class || 'place',
      source: 'nominatim',
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.lat + ',' + item.lon)}`
    }));
  }

  function _shortName(item) {
    const a = item.address || {};
    return a.city || a.town || a.village || a.municipality || a.county ||
      a.peak || a.volcano || a.tourism || a.road ||
      (item.display_name || '').split(',')[0] || 'Lugar';
  }

  async function _searchGoogle(q, key, o) {
    // Places Autocomplete (New) via REST legacy for simplicity
    const params = new URLSearchParams({
      input: q,
      key,
      language: 'es',
      types: 'geocode|establishment'
    });
    if (o.lat != null && o.lng != null) {
      params.set('location', `${o.lat},${o.lng}`);
      params.set('radius', '80000');
    }
    const r = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`
    );
    // Note: browser CORS blocks this official endpoint from client.
    // Keep for future proxy; fall through if fails.
    if (!r.ok) throw new Error('Google CORS/HTTP');
    const data = await r.json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(data.status);
    }
    const out = [];
    for (const p of (data.predictions || []).slice(0, o.limit || 6)) {
      const det = await _googleDetails(p.place_id, key);
      if (!det) continue;
      out.push(det);
    }
    return out;
  }

  async function _googleDetails(placeId, key) {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: 'name,geometry,formatted_address,url',
      key,
      language: 'es'
    });
    const r = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`
    );
    if (!r.ok) return null;
    const data = await r.json();
    const res = data.result;
    if (!res || !res.geometry) return null;
    return {
      id: 'g_' + placeId,
      name: res.name,
      label: res.formatted_address || res.name,
      lat: res.geometry.location.lat,
      lng: res.geometry.location.lng,
      type: 'google',
      source: 'google',
      mapsUrl: res.url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(res.name)}`
    };
  }

  /** Geocodifica una query y retorna el primer resultado */
  async function geocodeFirst(query, opts) {
    const list = await search(query, Object.assign({ limit: 1 }, opts || {}));
    return list[0] || null;
  }

  function googleSearchUrl(nameOrCoords) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nameOrCoords)}`;
  }

  function guessCategoryFromType(tipo, osmType) {
    const t = (osmType || '').toLowerCase();
    if (tipo === 'poi') {
      if (/fire.?station|bombero/.test(t)) return 'bomberos';
      if (/pharmacy|farmacia/.test(t)) return 'farmacia';
      if (/police|comisaria|comisar[ií]a/.test(t)) return /ret[eé]n|reten/.test(t) ? 'reten' : 'comisaria';
      if (/ret[eé]n|reten/.test(t)) return 'reten';
      if (/hospital/.test(t)) return 'hospital';
      if (/clinic|posta|cesfam/.test(t)) return /sapu|urgencia/.test(t) ? 'sapu' : 'posta';
      if (/doctor|consultorio|healthcare/.test(t)) return 'consultorio';
      if (/school|colegio|kindergarten|college/.test(t)) return 'colegio';
      if (/supermarket|hypermarket/.test(t)) return 'supermercado';
      if (/convenience|mall|shop|comercio|store/.test(t)) return 'comercio';
      if (/fuel|bencina|gasolin/.test(t)) return 'bencinera';
      if (/negocio|craft|office/.test(t)) return 'negocio';
      return 'otro';
    }
    if (tipo === 'ruta') {
      if (/road|highway|motorway/.test(t)) return 'carretera';
      if (/parking/.test(t)) return 'estacionamiento';
      return 'acceso';
    }
    // horizonte
    if (/volcano|peak|mountain/.test(t)) return t.includes('volcano') ? 'volcan' : 'montana';
    if (/lake|water/.test(t)) return 'lago';
    if (/city|town|village|municipality/.test(t)) return 'ciudad';
    if (/viewpoint|attraction|tourism/.test(t)) return 'mirador';
    return 'ciudad';
  }

  window.FerrariPlaces = {
    search,
    geocodeFirst,
    googleSearchUrl,
    guessCategoryFromType
  };

  console.log('[Ferrari/Places] ✓ Módulo inicializado');

})();
