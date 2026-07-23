/**
 * f-kmz-calco.js — Calco KMZ/KML manipulable sobre el panorama 360°
 *
 * Flujo:
 *   1. Importar .kmz o .kml
 *   2. Proyectar lat/lng → suelo → pitch/yaw (Origen + Norte + altitud)
 *   3. Manipular en la foto: arrastrar, escala, rotación, opacidad
 *   4. Snap magnético desde lote/calle (mientras el calco esté visible)
 *   5. "Aplicar al diseño" → lotes/calles en allDrawnLines
 *   6. "Quitar calco" → solo quita la capa KMZ; los lotes ya aplicados se quedan
 *
 * Requisitos de alineación: Origen Dron, Fijar Norte, altitud del vuelo.
 */

'use strict';

(function () {

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const R_EARTH = 6378137;
  const STORAGE_SETTINGS = 'ferrari360_kmz_settings';

  /**
   * features[].coords  — lat/lng originales
   * features[].groundBase — {x,z} en metros (antes de scale/offset)
   * features[].puntos  — [pitch,yaw] proyectados (después de transform)
   */
  const state = {
    features: [],
    visible: true,
    opacity: 0.45,
    altitude: 120,
    rotationFine: 0,
    /** Escala alrededor del centroide del calco (1 = 100%) */
    scale: 1,
    /** Traslación en plano del suelo (metros) */
    offsetX: 0,
    offsetZ: 0,
    /** Centroide del groundBase (se recalcula al reproject base) */
    centroidX: 0,
    centroidZ: 0,
    fileName: null,
    dirty: false,
    /** Origen virtual inferido del centro del KML cuando no hay droneOrigin real */
    _virtualOrigin: null,
    /** Rotación visual interactiva (arrastre con Ctrl) — se suma en _transformGround */
    _rotOffset: 0
  };

  let _bound = false;
  let _layer = null;
  let _pathEls = []; // { el, featureId, closed }

  // Modo manipulación interactiva
  let _manipActive = false;
  let _manipMode = 'move'; // 'move' | 'scale'
  let _dragging = false;
  let _dragStart = null; // { gx, gz, offsetX, offsetZ, scale, dist0 }
  let _listenersBound = false;

  // ─── ZIP / KMZ (deflate-raw nativo) ────────────────────────────────

  function _u16(u8, o) { return u8[o] | (u8[o + 1] << 8); }
  function _u32(u8, o) {
    return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
  }

  async function _inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Este navegador no descomprime KMZ. Usa Chrome/Edge o exporta como .kml');
    }
    const ds = new DecompressionStream('deflate-raw');
    const ab = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(ab);
  }

  /**
   * Extrae entradas de un ZIP (KMZ). Soporta store (0) y deflate (8).
   * @param {ArrayBuffer} buf
   * @returns {Promise<Array<{name:string, data:Uint8Array}>>}
   */
  async function _unzip(buf) {
    const u8 = new Uint8Array(buf);
    const out = [];
    let o = 0;

    while (o + 30 <= u8.length) {
      const sig = _u32(u8, o);
      if (sig !== 0x04034b50) break;

      const flags = _u16(u8, o + 6);
      const method = _u16(u8, o + 8);
      let compSize = _u32(u8, o + 18);
      const nameLen = _u16(u8, o + 26);
      const extraLen = _u16(u8, o + 28);
      const nameBytes = u8.subarray(o + 30, o + 30 + nameLen);
      const name = new TextDecoder('utf-8').decode(nameBytes);
      let dataStart = o + 30 + nameLen + extraLen;

      // Data descriptor: tamaños en cabecera pueden ser 0
      if ((flags & 0x8) && compSize === 0) {
        // Buscar firma de data descriptor o siguiente local header (limitado)
        let p = dataStart;
        let found = false;
        while (p + 16 < u8.length) {
          const s = _u32(u8, p);
          if (s === 0x08074b50) {
            compSize = _u32(u8, p + 8);
            found = true;
            break;
          }
          if (s === 0x04034b50 || s === 0x02014b50) {
            compSize = p - dataStart;
            found = true;
            break;
          }
          p++;
        }
        if (!found) throw new Error('KMZ con data descriptor no soportado. Exporta como .kml');
      }

      const compressed = u8.subarray(dataStart, dataStart + compSize);
      let data;
      if (method === 0) {
        data = compressed.slice();
      } else if (method === 8) {
        data = await _inflateRaw(compressed);
      } else {
        // Saltar entradas no soportadas (imágenes, etc.)
        o = dataStart + compSize;
        // También saltar data descriptor si existe (mismo flag bit 3)
        if ((flags & 0x8) && o + 4 <= u8.length && _u32(u8, o) === 0x08074b50) {
          o += 16;
        }
        continue;
      }

      out.push({ name, data });
      o = dataStart + compSize;

      // Si hay data descriptor con firma, saltar 16 bytes
      if ((flags & 0x8) && o + 4 <= u8.length && _u32(u8, o) === 0x08074b50) {
        o += 16;
      }
    }

    return out;
  }

  async function _extractKmlFromKmz(arrayBuffer) {
    const entries = await _unzip(arrayBuffer);
    // Preferir doc.kml o primer .kml en raíz
    const kmls = entries.filter(e => /\.kml$/i.test(e.name) && !e.name.endsWith('/'));
    if (!kmls.length) throw new Error('El KMZ no contiene ningún archivo .kml');

    kmls.sort((a, b) => {
      const aRoot = !a.name.includes('/') && !a.name.includes('\\');
      const bRoot = !b.name.includes('/') && !b.name.includes('\\');
      if (aRoot !== bRoot) return aRoot ? -1 : 1;
      if (/doc\.kml$/i.test(a.name)) return -1;
      if (/doc\.kml$/i.test(b.name)) return 1;
      return a.name.localeCompare(b.name);
    });

    return new TextDecoder('utf-8').decode(kmls[0].data);
  }

  // ─── Parse KML ────────────────────────────────────────────────────

  function _textContent(el) {
    return el && el.textContent ? el.textContent.trim() : '';
  }

  function _localName(node) {
    if (!node) return '';
    return (node.localName || node.nodeName || '').replace(/^.*:/, '').toLowerCase();
  }

  function _childrenByLocal(parent, name) {
    const out = [];
    if (!parent || !parent.childNodes) return out;
    const want = name.toLowerCase();
    for (let i = 0; i < parent.childNodes.length; i++) {
      const n = parent.childNodes[i];
      if (n.nodeType === 1 && _localName(n) === want) out.push(n);
    }
    return out;
  }

  function _firstByLocal(parent, name) {
    return _childrenByLocal(parent, name)[0] || null;
  }

  function _allByLocalDeep(root, name) {
    const out = [];
    const want = name.toLowerCase();
    (function walk(node) {
      if (!node || node.nodeType !== 1) return;
      if (_localName(node) === want) out.push(node);
      for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    })(root);
    return out;
  }

  /**
   * Parsea string de coordenadas KML → [{lat,lng}, ...]
   * Formato: lng,lat[,alt] separados por espacio o salto de línea
   */
  function _parseCoordinates(raw) {
    if (!raw) return [];
    const s = String(raw).replace(/,/g, ' ').trim();
    // Mejor: tokens "lng,lat,alt"
    const triples = String(raw).trim().split(/[\s\n\r]+/).filter(Boolean);
    const pts = [];
    for (let i = 0; i < triples.length; i++) {
      const parts = triples[i].split(',');
      if (parts.length < 2) continue;
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (!isFinite(lat) || !isFinite(lng)) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      pts.push({ lat, lng });
    }
    return pts;
  }

  function _coordsFromGeom(geomNode) {
    const coordEl = _firstByLocal(geomNode, 'coordinates') ||
      (function () {
        // Polygon → outerBoundaryIs → LinearRing → coordinates
        const ring = _allByLocalDeep(geomNode, 'coordinates');
        return ring[0] || null;
      })();
    return _parseCoordinates(_textContent(coordEl));
  }

  function _stripClosingDuplicate(pts) {
    if (pts.length < 2) return pts;
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.abs(a.lat - b.lat) < 1e-10 && Math.abs(a.lng - b.lng) < 1e-10) {
      return pts.slice(0, -1);
    }
    return pts;
  }

  function _pushFeature(list, kind, coords, name, source) {
    if (!coords || coords.length < 2) return;
    let pts = coords;
    if (kind === 'polygon') {
      pts = _stripClosingDuplicate(coords);
      if (pts.length < 3) return;
    }
    list.push({
      id: 'kmz_' + Math.random().toString(36).slice(2, 10),
      kind, // 'polygon' | 'linestring'
      name: (name || '').trim() || (kind === 'polygon' ? 'Lote' : 'Calle'),
      coords: pts,
      puntos: null, // se rellena en reproject
      source: source || ''
    });
  }

  function _processPlacemark(pm, list, source) {
    const name = _textContent(_firstByLocal(pm, 'name'));

    // Polígonos (incluye MultiGeometry anidado)
    const polys = _allByLocalDeep(pm, 'polygon');
    for (let i = 0; i < polys.length; i++) {
      const poly = polys[i];
      const outer = _firstByLocal(poly, 'outerboundaryis') || poly;
      const ring = _firstByLocal(outer, 'linearring') || outer;
      _pushFeature(list, 'polygon', _coordsFromGeom(ring), name, source);
    }

    // Líneas (no contar LineString dentro de LinearRing de polígono)
    const lines = _allByLocalDeep(pm, 'linestring');
    for (let i = 0; i < lines.length; i++) {
      _pushFeature(list, 'linestring', _coordsFromGeom(lines[i]), name, source);
    }
  }

  function parseKml(kmlText, sourceName) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(kmlText, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error('KML inválido o corrupto');

    const list = [];
    const placemarks = _allByLocalDeep(doc.documentElement, 'placemark');
    placemarks.forEach(pm => _processPlacemark(pm, list, sourceName || ''));

    // Deduplicar por geometría simple (mismo primer y último punto + length)
    const seen = new Set();
    const unique = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const key = f.kind + '|' + f.coords.map(c => c.lat.toFixed(6) + ',' + c.lng.toFixed(6)).join(';');
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(f);
    }
    return unique;
  }

  // ─── Proyección geo → pitch/yaw ───────────────────────────────────

  /**
   * ENU local → suelo Ferrari (x,z) con northOffset + rotación fina.
   * Convención MathScale: yaw=0 mira +Z; con northOffset=0, +Z = Norte, +X = Este.
   */
  function latLngToGround(lat, lng, origin, northOffsetDeg, rotationFineDeg) {
    const toR = Math.PI / 180;
    const dLat = (lat - origin.lat) * toR;
    const dLng = (lng - origin.lng) * toR;
    const east = R_EARTH * Math.cos(origin.lat * toR) * dLng;
    const north = R_EARTH * dLat;

    const no = ((northOffsetDeg || 0) + (rotationFineDeg || 0)) * toR;
    const cos = Math.cos(no);
    const sin = Math.sin(no);
    // Rotación que hace yaw = bearing - northOffset
    const x = east * cos - north * sin;
    const z = east * sin + north * cos;
    return { x, z };
  }

  /** Aplica scale + rotación visual + offset alrededor del centroide del calco */
  function _transformGround(gx, gz) {
    const s = state.scale > 0.01 ? state.scale : 1;
    const cx = state.centroidX;
    const cz = state.centroidZ;
    const rot = state._rotOffset || 0;
    // Si no hay rotación, mantener el camino original (sin cambios)
    if (!rot) {
      return {
        x: (gx - cx) * s + cx + state.offsetX,
        z: (gz - cz) * s + cz + state.offsetZ
      };
    }
    // Con rotación: centro visual = centroide + offset, rotar alrededor de él
    const cxv = cx + state.offsetX;
    const czv = cz + state.offsetZ;
    const dx = (gx - cxv) * s;
    const dz = (gz - czv) * s;
    const r = rot * Math.PI / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    return {
      x: dx * cos - dz * sin + cxv,
      z: dx * sin + dz * cos + czv
    };
  }

  /**
   * Recalcula groundBase desde lat/lng (origen/norte/rotación).
   * @param {boolean} [keepTransform=true]
   */
  function rebuildGroundBase() {
    const realOrigin = window.FerrariGeo && window.FerrariGeo.droneOrigin;
    const origin = realOrigin || state._virtualOrigin;
    const northOff = (window.FerrariGeo && window.FerrariGeo.northOffset) || 0;
    const fine = state.rotationFine || 0;

    if (!origin) {
      state.features.forEach(f => { f.groundBase = null; f.puntos = null; });
      return false;
    }

    let sx = 0, sz = 0, n = 0;
    for (let i = 0; i < state.features.length; i++) {
      const f = state.features[i];
      const base = [];
      for (let j = 0; j < f.coords.length; j++) {
        const c = f.coords[j];
        const g = latLngToGround(c.lat, c.lng, origin, northOff, fine);
        base.push(g);
        sx += g.x;
        sz += g.z;
        n++;
      }
      f.groundBase = base.length >= 2 ? base : null;
    }
    if (n > 0) {
      state.centroidX = sx / n;
      state.centroidZ = sz / n;
    } else {
      state.centroidX = 0;
      state.centroidZ = 0;
    }
    return true;
  }

  /**
   * groundBase + scale/offset → pitch/yaw
   */
  function applyTransformToPuntos() {
    const alt = state.altitude > 0 ? state.altitude : 120;
    if (!window.FerrariMathScale) {
      state.features.forEach(f => { f.puntos = null; });
      return { ok: false, reason: 'no-math' };
    }

    let okCount = 0;
    for (let i = 0; i < state.features.length; i++) {
      const f = state.features[i];
      if (!f.groundBase || !f.groundBase.length) {
        f.puntos = null;
        continue;
      }
      const pts = [];
      for (let j = 0; j < f.groundBase.length; j++) {
        const g0 = f.groundBase[j];
        const g = _transformGround(g0.x, g0.z);
        const py = window.FerrariMathScale.groundToPitchYaw(g.x, g.z, alt);
        if (!isFinite(py.pitch) || !isFinite(py.yaw)) continue;
        pts.push([py.pitch, py.yaw]);
      }
      f.puntos = pts.length >= 2 ? pts : null;
      if (f.puntos) okCount++;
    }

    state.dirty = true;
    if (window.FerrariRAF && window.FerrariRAF.markDataDirty) {
      window.FerrariRAF.markDataDirty();
    }
    return { ok: true, count: okCount };
  }

  function reprojectAll() {
    const realOrigin = window.FerrariGeo && window.FerrariGeo.droneOrigin;
    const origin = realOrigin || state._virtualOrigin;
    if (!origin || !window.FerrariMathScale) {
      state.features.forEach(f => { f.groundBase = null; f.puntos = null; });
      state.dirty = true;
      return { ok: false, reason: 'missing-origin' };
    }
    rebuildGroundBase();
    return applyTransformToPuntos();
  }

  function resetTransform() {
    state.scale = 1;
    state.offsetX = 0;
    state.offsetZ = 0;
    state._rotOffset = 0;
    applyTransformToPuntos();
    updatePaths();
    _updateUi();
    window.FerrariUI && window.FerrariUI.showToast('Transformación del calco reiniciada.', 'info');
  }

  // ─── SVG layer ────────────────────────────────────────────────────

  function _ensureLayer() {
    if (_layer && _layer.isConnected) return _layer;
    _layer = document.getElementById('layer-kmz-calco');
    return _layer;
  }

  function _clearPathEls() {
    for (let i = 0; i < _pathEls.length; i++) {
      const el = _pathEls[i].el;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    _pathEls = [];
  }

  function rebuildDom() {
    const layer = _ensureLayer();
    if (!layer) return;
    _clearPathEls();

    if (!state.visible || !state.features.length) {
      layer.style.display = 'none';
      return;
    }
    layer.style.display = '';
    layer.style.opacity = String(state.opacity);

    for (let i = 0; i < state.features.length; i++) {
      const f = state.features[i];
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', 'M -9999 -9999');
      path.setAttribute('data-kmz-id', f.id);
      path.setAttribute('data-kmz-kind', f.kind);
      if (f.kind === 'polygon') {
        path.setAttribute('class', 'kmz-calco-poly');
      } else {
        path.setAttribute('class', 'kmz-calco-line');
      }
      path.style.pointerEvents = 'none';
      layer.appendChild(path);
      _pathEls.push({ el: path, featureId: f.id, closed: f.kind === 'polygon' });
    }

    state.dirty = true;
    updatePaths();
  }

  // Scratch reutilizable de cámara para evitar alocaciones de memoria en bucles calco
  const _camScratch = { x: 0, y: 0, z: 0 };

  function _buildPathD(puntos, close) {
    if (!puntos || !puntos.length || !window.FerrariCamera) return 'M -9999 -9999';
    const proj = window.FerrariCamera.getProjectionParams();
    const FCam = window.FerrariCamera;
    let d = '';
    let hasVisible = false;
    let needM = true;

    for (let i = 0; i < puntos.length; i++) {
      const pt = puntos[i];
      const cam = FCam.getCamFastInto(pt, _camScratch);
      if (cam.z <= 0.0001) {
        needM = true;
        continue;
      }
      const { px, py } = FCam.camToPixel(cam, proj);
      hasVisible = true;
      if (needM) {
        d += `M ${px.toFixed(2)} ${py.toFixed(2)} `;
        needM = false;
      } else {
        d += `L ${px.toFixed(2)} ${py.toFixed(2)} `;
      }
    }
    if (!hasVisible) return 'M -9999 -9999';
    if (close) d += 'Z';
    return d.trim();
  }

  function updatePaths() {
    if (!state.visible || !state.features.length) return;
    if (!_pathEls.length) return;

    const byId = Object.create(null);
    for (let i = 0; i < state.features.length; i++) {
      byId[state.features[i].id] = state.features[i];
    }

    for (let i = 0; i < _pathEls.length; i++) {
      const item = _pathEls[i];
      const f = byId[item.featureId];
      if (!f || !f.puntos) {
        item.el.setAttribute('d', 'M -9999 -9999');
        continue;
      }
      item.el.setAttribute('d', _buildPathD(f.puntos, item.closed));
    }
  }

  // ─── Snap API ─────────────────────────────────────────────────────

  /**
   * Devuelve todos los vértices del calco en pitch/yaw (si está visible).
   * @returns {Array<[number,number]>}
   */
  function getSnapVertices() {
    if (!state.visible || !state.features.length) return [];
    const out = [];
    for (let i = 0; i < state.features.length; i++) {
      const f = state.features[i];
      if (!f.puntos) continue;
      for (let j = 0; j < f.puntos.length; j++) {
        out.push(f.puntos[j]);
      }
    }
    return out;
  }

  /**
   * Snap al vértice del calco más cercano al cursor en pantalla.
   * @param {number} pitch
   * @param {number} yaw
   * @param {number} [maxPx=18]
   * @returns {{pitch:number,yaw:number,px:number,py:number}|null}
   */
  function findSnapPoint(pitch, yaw, maxPx) {
    const verts = getSnapVertices();
    if (!verts.length || !window.FerrariCamera) return null;

    const limit = maxPx != null ? maxPx : 18;
    const proj = window.FerrariCamera.getProjectionParams();
    const curCam = window.FerrariCamera.getCam(pitch, yaw);
    if (curCam.z <= 0.0001) return null;
    const cur = window.FerrariCamera.camToPixel(curCam, proj);

    let best = null;
    let bestDist = limit;

    for (let i = 0; i < verts.length; i++) {
      const pt = verts[i];
      const cam = window.FerrariCamera.getCam(pt[0], pt[1]);
      if (cam.z <= 0.0001) continue;
      const px = window.FerrariCamera.camToPixel(cam, proj);
      const dx = px.px - cur.px;
      const dy = px.py - cur.py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = { pitch: pt[0], yaw: pt[1], px: px.px, py: px.py };
      }
    }
    return best;
  }

  /**
   * Variante con coords de mouse en píxeles del viewer (para DrawLote).
   */
  function findSnapNearPixel(mx, my, maxPx) {
    const verts = getSnapVertices();
    if (!verts.length || !window.FerrariCamera) return null;
    const limit = maxPx != null ? maxPx : 14;
    const proj = window.FerrariCamera.getProjectionParams();
    let bestPitch = null;
    let bestYaw = null;
    let bestDist = limit;

    for (let i = 0; i < verts.length; i++) {
      const pt = verts[i];
      const cam = window.FerrariCamera.getCam(pt[0], pt[1]);
      if (cam.z <= 0.0001) continue;
      const px = window.FerrariCamera.camToPixel(cam, proj);
      const dist = Math.sqrt((px.px - mx) ** 2 + (px.py - my) ** 2);
      if (dist < bestDist) {
        bestDist = dist;
        bestPitch = pt[0];
        bestYaw = pt[1];
      }
    }
    if (bestPitch == null) return null;
    return [bestPitch, bestYaw];
  }

  // ─── Virtual origin (fallback sin droneOrigin real) ──────────────

  /**
   * Computa el centroide geográfico de todos los features cargados.
   * Sirve como origen virtual cuando el usuario no ha configurado Origen Dron.
   */
  function _computeKmlCentroid(features) {
    if (!features || !features.length) return null;
    let sumLat = 0, sumLng = 0, n = 0;
    for (let i = 0; i < features.length; i++) {
      const coords = features[i].coords;
      if (!coords) continue;
      for (let j = 0; j < coords.length; j++) {
        sumLat += coords[j].lat;
        sumLng += coords[j].lng;
        n++;
      }
    }
    if (n === 0) return null;
    return { lat: sumLat / n, lng: sumLng / n };
  }

  // ─── Import / Apply / Clear ───────────────────────────────────────

  async function loadFile(file) {
    if (!file) return;
    const name = file.name || 'plano';
    const lower = name.toLowerCase();
    let kmlText;

    try {
      if (lower.endsWith('.kml')) {
        kmlText = await file.text();
      } else if (lower.endsWith('.kmz')) {
        const buf = await file.arrayBuffer();
        kmlText = await _extractKmlFromKmz(buf);
      } else {
        // Intentar como KML texto o ZIP
        const buf = await file.arrayBuffer();
        const head = new Uint8Array(buf.slice(0, 4));
        if (head[0] === 0x50 && head[1] === 0x4b) {
          kmlText = await _extractKmlFromKmz(buf);
        } else {
          kmlText = new TextDecoder('utf-8').decode(buf);
        }
      }
    } catch (e) {
      console.error('[Ferrari/KmzCalco]', e);
      window.FerrariUI && window.FerrariUI.showToast('Error al leer archivo: ' + e.message, 'error');
      return;
    }

    let features;
    try {
      features = parseKml(kmlText, name);
    } catch (e) {
      console.error('[Ferrari/KmzCalco]', e);
      window.FerrariUI && window.FerrariUI.showToast('Error al parsear KML: ' + e.message, 'error');
      return;
    }

    if (!features.length) {
      window.FerrariUI && window.FerrariUI.showToast('No se encontraron polígonos ni líneas en el archivo.', 'error');
      return;
    }

    state.features = features;
    state.fileName = name;
    state.visible = true;
    // Nueva importación: transform limpia
    state.scale = 1;
    state.offsetX = 0;
    state.offsetZ = 0;

    // Si no hay droneOrigin real, inferir origen virtual desde el centro del KML
    const realOrigin = window.FerrariGeo && window.FerrariGeo.droneOrigin;
    if (!realOrigin) {
      const virtual = _computeKmlCentroid(features);
      if (virtual) {
        state._virtualOrigin = virtual;
      }
    } else {
      state._virtualOrigin = null;
    }

    reprojectAll();

    // Auto-escala si origen virtual: que el calco quede visible aunque el KML
    // abarque varios km. Farthest point ~500m del cam → pitch ≈ -14°.
    if (!realOrigin) {
      let maxDist = 0;
      for (const f of features) {
        if (!f.groundBase) continue;
        for (const g of f.groundBase) {
          const d = Math.sqrt((g.x - state.centroidX) ** 2 + (g.z - state.centroidZ) ** 2);
          if (d > maxDist) maxDist = d;
        }
      }
      if (maxDist > 500) {
        state.scale = Math.max(0.15, Math.min(4, 500 / maxDist));
        applyTransformToPuntos();
      }
    }

    rebuildDom();
    _updateUi();

    const nPoly = features.filter(f => f.kind === 'polygon').length;
    const nLine = features.filter(f => f.kind === 'linestring').length;
    window.FerrariUI && window.FerrariUI.showToast(
      `✓ Calco: ${nPoly} lotes · ${nLine} calles. Activa “Mover/escalar” para arrastrar sobre la foto.`,
      'success'
    );
  }

  /**
   * Quita SOLO la capa calco. Nunca borra lotes/calles de allDrawnLines.
   */
  function clearCalco(opts) {
    opts = opts || {};
    deactivate();
    state.features = [];
    state.fileName = null;
    state.scale = 1;
    state.offsetX = 0;
    state.offsetZ = 0;
    _clearPathEls();
    const layer = _ensureLayer();
    if (layer) {
      layer.style.display = 'none';
      layer.classList.remove('kmz-calco--interactive');
    }
    _updateUi();
    if (!opts.silent) {
      const n = (window.allDrawnLines || []).length;
      window.FerrariUI && window.FerrariUI.showToast(
        n > 0
          ? `Calco quitado. El diseño se mantiene (${n} elementos).`
          : 'Calco quitado.',
        'info'
      );
    }
  }

  /**
   * Convierte el calco (con transform actual) en lotes/calles.
   * @param {{ replace?: boolean, calleWidthPx?: number, removeCalco?: boolean }} opts
   */
  function applyToDesign(opts) {
    opts = opts || {};
    const realOrigin = window.FerrariGeo && window.FerrariGeo.droneOrigin;
    if (!realOrigin) {
      window.FerrariUI && window.FerrariUI.showToast(
        'Primero define el Origen Dron (GEO) para fijar el calco como lotes.',
        'error'
      );
      return { ok: false };
    }

    reprojectAll();

    const usable = state.features.filter(f => f.puntos && f.puntos.length >= 2);
    if (!usable.length) {
      window.FerrariUI && window.FerrariUI.showToast('No hay geometría proyectada. Revisa origen/norte/altitud.', 'error');
      return { ok: false };
    }

    if (opts.replace) {
      window.FerrariState.clearAll();
    }

    const widthPx = opts.calleWidthPx || 18;
    let nLotes = 0;
    let nCalles = 0;

    let anchoAngular = null;
    if (window.FerrariCamera) {
      const proj = window.FerrariCamera.getProjectionParams();
      const f = proj.f || 1;
      anchoAngular = 2 * Math.atan((widthPx / 2) / f) * 180 / Math.PI;
    }

    const existingLotes = (window.allDrawnLines || []).filter(
      l => l.tipo && (l.tipo.startsWith('lote') || l.tipo.startsWith('franja'))
    ).length;

    for (let i = 0; i < usable.length; i++) {
      const f = usable[i];
      if (f.kind === 'polygon' && f.puntos.length >= 3) {
        window.FerrariState.addLine({
          tipo: 'lote-libre',
          puntos: f.puntos.map(p => [p[0], p[1]]),
          estado: 'disponible',
          titulo: f.name || `Lote ${existingLotes + nLotes + 1}`,
          altitude: state.altitude,
          fromKmz: true,
          createdAt: Date.now()
        });
        nLotes++;
      } else if (f.kind === 'linestring' && f.puntos.length >= 2) {
        const id = window.FerrariState.addLine({
          tipo: 'calle',
          puntos: f.puntos.map(p => [p[0], p[1]]),
          anchoAngular: anchoAngular != null ? anchoAngular : undefined,
          fromKmz: true,
          createdAt: Date.now()
        });
        if (id && window.FerrariStreetNetwork && window.FerrariStreetNetwork.integrateStreet) {
          try { window.FerrariStreetNetwork.integrateStreet(id); } catch (e) {}
        }
        nCalles++;
      }
    }

    if (window.FerrariCamera && window.FerrariCamera.markDirty) {
      window.FerrariCamera.markDirty();
    }
    if (window.FerrariRAF && window.FerrariRAF.markDataDirty) {
      window.FerrariRAF.markDataDirty();
    }

    const removeCalco = opts.removeCalco !== false; // por defecto quita calco y deja lotes
    if (removeCalco) {
      clearCalco({ silent: true });
      window.FerrariUI && window.FerrariUI.showToast(
        `✓ ${nLotes} lotes · ${nCalles} calles fijados. Calco quitado (diseño se queda).`,
        'success'
      );
    } else {
      window.FerrariUI && window.FerrariUI.showToast(
        `✓ Diseño: ${nLotes} lotes · ${nCalles} calles. Calco sigue visible para ajustar.`,
        'success'
      );
    }
    return { ok: true, nLotes, nCalles };
  }

  // ─── Manipulación interactiva (arrastre / escala en la foto) ─────

  function _setPannellumDraggable(enabled) {
    // Misma técnica que DrawLote: desactivar pointer-events del canvas
    // para que el drag no mueva la cámara y los eventos lleguen al contenedor.
    const canvas = document.querySelector('#pannellum-viewer canvas');
    if (canvas) {
      canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    }
    const pnlm = document.querySelector('#pannellum-viewer .pnlm-container');
    if (pnlm) {
      pnlm.style.pointerEvents = enabled ? 'auto' : 'none';
    }
    const container = document.getElementById('panorama-container');
    if (container) {
      container.classList.toggle('kmz-manip-active', _manipActive);
    }
  }

  function _getViewerCoords(e) {
    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return null;
    try {
      const src = e.changedTouches ? e.changedTouches[0] : e;
      return viewer.mouseEventToCoords(src);
    } catch (err) {
      return null;
    }
  }

  function _coordsToGround(pitch, yaw) {
    if (!window.FerrariMathScale) return null;
    const alt = state.altitude > 0 ? state.altitude : 120;
    // pitch cerca del horizonte → proyección inestable
    const p = pitch >= -1 ? -1 : pitch;
    return window.FerrariMathScale.pitchYawToGround(p, yaw, alt);
  }

  function _centroidGroundTransformed() {
    const g = _transformGround(state.centroidX, state.centroidZ);
    return g;
  }

  function activate(mode) {
    if (!state.features.length) {
      window.FerrariUI && window.FerrariUI.showToast('Primero importa un KMZ/KML.', 'error');
      return;
    }
    const realOrigin = window.FerrariGeo && window.FerrariGeo.droneOrigin;
    const hasOrigin = !!(realOrigin || state._virtualOrigin);
    if (!hasOrigin) {
      window.FerrariUI && window.FerrariUI.showToast(
        'No hay origen para proyectar el calco. Reimporta el archivo.',
        'error'
      );
      return;
    }

    if (window.FerrariTools && window.FerrariTools.deactivateAllTools) {
      // Evitar recursión: solo desactivar otros si no somos nosotros
      window.FerrariTools.deactivateAllTools();
    }

    _manipActive = true;
    _manipMode = mode === 'scale' ? 'scale' : 'move';
    window.currentTool = 'kmz-manip';

    const container = document.getElementById('panorama-container');
    if (container) container.classList.add('kmz-manip-active', 'drawing-active');

    const layer = _ensureLayer();
    if (layer) {
      layer.classList.add('kmz-calco--interactive');
      layer.style.pointerEvents = 'none'; // eventos en el viewer, no en paths
    }

    _setPannellumDraggable(false);
    state.visible = true;
    _updateUi();

    window.FerrariHUD && window.FerrariHUD.showDraw('kmz-manip');
    window.FerrariUI && window.FerrariUI.showToast(
      'Arrastrar = mover · Ctrl+arrastrar = rotar · Alt+arrastrar/rueda = escala · Ctrl+rueda = rotar fino · Esc = salir',
      'info'
    );
  }

  function deactivate() {
    if (!_manipActive && !_dragging) {
      // igual limpiar clases
    }
    _manipActive = false;
    _dragging = false;
    _dragStart = null;
    _setPannellumDraggable(true);

    const container = document.getElementById('panorama-container');
    if (container) {
      container.classList.remove('kmz-manip-active');
      // no quitar drawing-active si otra tool lo usa — solo si somos la tool
      if (window.currentTool === 'kmz-manip' || window.currentTool == null) {
        container.classList.remove('drawing-active');
      }
    }

    const layer = _ensureLayer();
    if (layer) layer.classList.remove('kmz-calco--interactive');

    window.FerrariHUD && window.FerrariHUD.hideDraw();
    _updateUi();
  }

  function isActive() {
    return _manipActive;
  }

  function _onPointerDown(e) {
    if (!_manipActive || !state.features.length) return;
    if (e.button != null && e.button !== 0) return;
    // No capturar clics en panel
    if (e.target && e.target.closest && (
      e.target.closest('#kpk-panel') ||
      e.target.closest('#kpk-lote-panel') ||
      e.target.closest('#f-geo-editor')
    )) return;

    const coords = _getViewerCoords(e);
    if (!coords) return;
    const [pitch, yaw] = coords;
    const g = _coordsToGround(pitch, yaw);
    if (!g) return;

    e.preventDefault();
    e.stopPropagation();

    _dragging = true;
    const c = _centroidGroundTransformed();
    const dx = g.x - c.x;
    const dz = g.z - c.z;
    const dist0 = Math.sqrt(dx * dx + dz * dz) || 1;

    // Ctrl/Cmd = rotar, Alt = escalar, plain = mover
    let mode = 'move';
    if (e.ctrlKey || e.metaKey) {
      mode = 'rotate';
    } else if (e.altKey || e.shiftKey || _manipMode === 'scale') {
      mode = 'scale';
    }

    _dragStart = {
      gx: g.x,
      gz: g.z,
      offsetX: state.offsetX,
      offsetZ: state.offsetZ,
      scale: state.scale,
      rotOffset: state._rotOffset || 0,
      dist0,
      mode
    };
  }

  function _onPointerMove(e) {
    if (!_dragging || !_dragStart) return;
    const coords = _getViewerCoords(e);
    if (!coords) return;
    const g = _coordsToGround(coords[0], coords[1]);
    if (!g) return;

    e.preventDefault();

    if (_dragStart.mode === 'rotate') {
      // Rotar alrededor del centro visual (centroide + offset)
      const cxv = state.centroidX + _dragStart.offsetX;
      const czv = state.centroidZ + _dragStart.offsetZ;
      const angle0 = Math.atan2(_dragStart.gz - czv, _dragStart.gx - cxv);
      const angle1 = Math.atan2(g.z - czv, g.x - cxv);
      const delta = (angle1 - angle0) * 180 / Math.PI;
      state._rotOffset = _dragStart.rotOffset + delta;
    } else if (_dragStart.mode === 'scale') {
      const cx = state.centroidX + _dragStart.offsetX;
      const cz = state.centroidZ + _dragStart.offsetZ;
      const dx = g.x - cx;
      const dz = g.z - cz;
      const dist = Math.sqrt(dx * dx + dz * dz) || 1;
      let next = _dragStart.scale * (dist / _dragStart.dist0);
      next = Math.max(0.15, Math.min(4, next));
      state.scale = next;
      state.offsetX = _dragStart.offsetX;
      state.offsetZ = _dragStart.offsetZ;
    } else {
      state.offsetX = _dragStart.offsetX + (g.x - _dragStart.gx);
      state.offsetZ = _dragStart.offsetZ + (g.z - _dragStart.gz);
    }

    applyTransformToPuntos();
    updatePaths();
    _updateUiTransformOnly();
  }

  function _onPointerUp(e) {
    if (!_dragging) return;
    _dragging = false;
    _dragStart = null;
    _saveSettings();
  }

  function _onWheel(e) {
    if (!_manipActive || !state.features.length) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey) {
      // Ctrl+rueda: rotar fino
      const dir = e.deltaY > 0 ? -0.5 : 0.5;
      state._rotOffset = (state._rotOffset || 0) + dir;
    } else {
      // Rueda simple o con Shift: escalar
      const delta = e.deltaY > 0 ? 0.95 : 1.05;
      state.scale = Math.max(0.15, Math.min(4, state.scale * delta));
    }
    applyTransformToPuntos();
    updatePaths();
    _updateUiTransformOnly();
    _saveSettings();
  }

  function _onKeyDown(e) {
    if (!_manipActive) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      deactivate();
      if (window.FerrariTools) {
        // limpiar botones
        document.querySelectorAll('.kpk-tool-btn').forEach(btn => {
          btn.classList.remove('active');
          btn.setAttribute('aria-pressed', 'false');
        });
      }
      window.FerrariUI && window.FerrariUI.showToast('Manipulación del calco desactivada.', 'info');
    }
  }

  function setScale(v) {
    state.scale = Math.max(0.15, Math.min(4, v));
    _saveSettings();
    applyTransformToPuntos();
    updatePaths();
    _updateUi();
  }

  function setOffset(x, z) {
    state.offsetX = x;
    state.offsetZ = z;
    applyTransformToPuntos();
    updatePaths();
    _updateUi();
  }

  // ─── Settings persistence ─────────────────────────────────────────

  function _saveSettings() {
    try {
      localStorage.setItem(STORAGE_SETTINGS, JSON.stringify({
        opacity: state.opacity,
        altitude: state.altitude,
        rotationFine: state.rotationFine,
        visible: state.visible,
        scale: state.scale,
        rotOffset: state._rotOffset
      }));
    } catch (e) {}
  }

  function _loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_SETTINGS);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (typeof o.opacity === 'number') state.opacity = Math.max(0.05, Math.min(1, o.opacity));
      if (typeof o.altitude === 'number') state.altitude = Math.max(10, Math.min(500, o.altitude));
      if (typeof o.rotationFine === 'number') state.rotationFine = Math.max(-45, Math.min(45, o.rotationFine));
      if (typeof o.visible === 'boolean') state.visible = o.visible;
      if (typeof o.scale === 'number') state.scale = Math.max(0.15, Math.min(4, o.scale));
      if (typeof o.rotOffset === 'number') state._rotOffset = o.rotOffset;
    } catch (e) {}
  }

  // ─── UI ───────────────────────────────────────────────────────────

  function _updateUiTransformOnly() {
    const scSl = document.getElementById('kmz-scale-slider');
    const scVal = document.getElementById('kmz-scale-value');
    if (scSl) scSl.value = String(Math.round(state.scale * 100));
    if (scVal) scVal.textContent = Math.round(state.scale * 100) + '%';

    const offEl = document.getElementById('kmz-offset-value');
    if (offEl) {
      const rot = state._rotOffset || 0;
      offEl.textContent = `${state.offsetX.toFixed(1)} m · ${state.offsetZ.toFixed(1)} m${rot ? ' · rot ' + rot.toFixed(1) + '°' : ''}`;
    }
  }

  function _updateUi() {
    const panel = document.getElementById('kmz-calco-panel');
    if (panel) {
      panel.style.display = state.features.length ? '' : 'none';
    }

    const meta = document.getElementById('kmz-calco-meta');
    if (meta) {
      if (!state.features.length) {
        meta.textContent = 'Sin calco';
      } else {
        const nP = state.features.filter(f => f.kind === 'polygon').length;
        const nL = state.features.filter(f => f.kind === 'linestring').length;
        meta.textContent = `${state.fileName || 'calco'} · ${nP} polígonos · ${nL} líneas`;
      }
    }

    const opVal = document.getElementById('kmz-opacity-value');
    const opSl = document.getElementById('kmz-opacity-slider');
    if (opSl) opSl.value = String(Math.round(state.opacity * 100));
    if (opVal) opVal.textContent = Math.round(state.opacity * 100) + '%';

    const altIn = document.getElementById('kmz-altitude-input');
    if (altIn) altIn.value = String(state.altitude);

    const rotSl = document.getElementById('kmz-rotation-slider');
    const rotVal = document.getElementById('kmz-rotation-value');
    if (rotSl) rotSl.value = String(state.rotationFine);
    if (rotVal) rotVal.textContent = (state.rotationFine >= 0 ? '+' : '') + state.rotationFine.toFixed(1) + '°';

    _updateUiTransformOnly();

    const visBtn = document.getElementById('kmz-toggle-visible');
    if (visBtn) {
      visBtn.classList.toggle('active', state.visible);
      visBtn.setAttribute('aria-pressed', state.visible ? 'true' : 'false');
      const lab = visBtn.querySelector('span');
      if (lab) lab.textContent = state.visible ? 'Calco ON' : 'Calco OFF';
    }

    const manipBtn = document.getElementById('kmz-btn-manip');
    if (manipBtn) {
      manipBtn.classList.toggle('active', _manipActive);
      manipBtn.setAttribute('aria-pressed', _manipActive ? 'true' : 'false');
    }

    const layer = _ensureLayer();
    if (layer) {
      layer.style.opacity = String(state.opacity);
      layer.style.display = (state.visible && state.features.length) ? '' : 'none';
    }
  }

  function setOpacity(v) {
    state.opacity = Math.max(0.05, Math.min(1, v));
    _saveSettings();
    _updateUi();
  }

  function setAltitude(v) {
    state.altitude = Math.max(10, Math.min(500, v));
    _saveSettings();
    if (state.features.length) {
      // Altitud solo afecta pitch/yaw, no groundBase
      applyTransformToPuntos();
      updatePaths();
    }
    _updateUi();
  }

  function setRotationFine(v) {
    state.rotationFine = Math.max(-45, Math.min(45, v));
    _saveSettings();
    if (state.features.length) {
      // Rotación cambia groundBase (rumbo)
      reprojectAll();
      updatePaths();
    }
    _updateUi();
  }

  function setVisible(v) {
    state.visible = !!v;
    _saveSettings();
    _updateUi();
    if (window.FerrariRAF && window.FerrariRAF.markDataDirty) {
      window.FerrariRAF.markDataDirty();
    }
  }

  function toggleVisible() {
    setVisible(!state.visible);
  }

  function openFilePicker() {
    const input = document.getElementById('kmz-file-input');
    if (input) input.click();
  }

  function bindEvents() {
    if (_bound) return;
    _bound = true;

    _loadSettings();

    const fileInput = document.getElementById('kmz-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        const f = fileInput.files && fileInput.files[0];
        if (f) loadFile(f);
        fileInput.value = '';
      }, false);
    }

    const btnImport = document.getElementById('tool-kmz-import');
    if (btnImport) {
      btnImport.addEventListener('click', function () {
        openFilePicker();
      }, false);
    }

    const btnApply = document.getElementById('kmz-btn-apply');
    if (btnApply) {
      btnApply.addEventListener('click', function () {
        const replace = !!(document.getElementById('kmz-replace-existing') &&
          document.getElementById('kmz-replace-existing').checked);
        const keepCalco = !!(document.getElementById('kmz-keep-calco') &&
          document.getElementById('kmz-keep-calco').checked);
        if (replace && !(window.allDrawnLines && window.allDrawnLines.length === 0)) {
          if (!confirm('¿Reemplazar todo el diseño actual por el calco KMZ?')) return;
        }
        applyToDesign({ replace, removeCalco: !keepCalco });
      }, false);
    }

    const btnClear = document.getElementById('kmz-btn-clear');
    if (btnClear) {
      btnClear.addEventListener('click', function () {
        if (!state.features.length) return;
        if (!confirm('¿Quitar el calco de la foto?\n\nLos lotes y calles ya aplicados al diseño NO se borran.')) return;
        clearCalco();
      }, false);
    }

    const btnManip = document.getElementById('kmz-btn-manip');
    if (btnManip) {
      btnManip.addEventListener('click', function () {
        if (_manipActive) {
          deactivate();
          btnManip.classList.remove('active');
        } else {
          activate('move');
          btnManip.classList.add('active');
          document.querySelectorAll('.kpk-tool-btn').forEach(btn => {
            if (btn.id !== 'kmz-btn-manip') {
              btn.classList.remove('active');
              btn.setAttribute('aria-pressed', 'false');
            }
          });
        }
      }, false);
    }

    const btnReset = document.getElementById('kmz-btn-reset-xform');
    if (btnReset) {
      btnReset.addEventListener('click', function () {
        if (!state.features.length) return;
        resetTransform();
      }, false);
    }

    const btnVis = document.getElementById('kmz-toggle-visible');
    if (btnVis) {
      btnVis.addEventListener('click', function () {
        toggleVisible();
      }, false);
    }

    const opSl = document.getElementById('kmz-opacity-slider');
    if (opSl) {
      opSl.addEventListener('input', function () {
        setOpacity(parseInt(opSl.value, 10) / 100);
      }, false);
    }

    const altIn = document.getElementById('kmz-altitude-input');
    if (altIn) {
      altIn.addEventListener('change', function () {
        setAltitude(parseFloat(altIn.value) || 120);
      }, false);
    }

    const rotSl = document.getElementById('kmz-rotation-slider');
    if (rotSl) {
      rotSl.addEventListener('input', function () {
        setRotationFine(parseFloat(rotSl.value) || 0);
      }, false);
    }

    const scSl = document.getElementById('kmz-scale-slider');
    if (scSl) {
      scSl.addEventListener('input', function () {
        setScale(parseInt(scSl.value, 10) / 100);
      }, false);
    }

    // Pointer manip sobre el viewer
    const viewerEl = document.getElementById('pannellum-viewer') || document.getElementById('panorama-container');
    if (viewerEl && !_listenersBound) {
      _listenersBound = true;
      viewerEl.addEventListener('mousedown', _onPointerDown, false);
      viewerEl.addEventListener('mousemove', _onPointerMove, false);
      window.addEventListener('mouseup', _onPointerUp, false);
      viewerEl.addEventListener('touchstart', _onPointerDown, { passive: false });
      viewerEl.addEventListener('touchmove', _onPointerMove, { passive: false });
      window.addEventListener('touchend', _onPointerUp, false);
      viewerEl.addEventListener('wheel', _onWheel, { passive: false });
      document.addEventListener('keydown', _onKeyDown, false);
    }

    document.addEventListener('ferrari:geo-changed', function () {
      if (!state.features.length) return;
      // Si se acaba de definir un droneOrigin real, descartar el virtual
      if (window.FerrariGeo && window.FerrariGeo.droneOrigin) {
        state._virtualOrigin = null;
      }
      reprojectAll();
      updatePaths();
      _updateUi();
    }, false);

    _updateUi();
    console.log('[Ferrari/KmzCalco] ✓ Eventos registrados (manipulación activa)');
  }

  // ─── API ──────────────────────────────────────────────────────────

  window.FerrariKmzCalco = {
    bindEvents,
    loadFile,
    clearCalco,
    applyToDesign,
    reprojectAll,
    applyTransformToPuntos,
    updatePaths,
    rebuildDom,
    getSnapVertices,
    findSnapPoint,
    findSnapNearPixel,
    setOpacity,
    setAltitude,
    setRotationFine,
    setScale,
    setOffset,
    resetTransform,
    setVisible,
    toggleVisible,
    openFilePicker,
    activate,
    deactivate,
    isActive,
    get state() { return state; },
    hasCalco() { return state.features.length > 0; },
    isVisible() { return state.visible && state.features.length > 0; }
  };

  console.log('[Ferrari/KmzCalco] ✓ Módulo cargado');

})();
