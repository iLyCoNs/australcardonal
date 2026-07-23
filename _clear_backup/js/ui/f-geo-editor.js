/**
 * f-geo-editor.js — Editor modal macOS + búsqueda automática de lugares
 */

'use strict';

(function () {

  let _root = null;
  let _mode = null; // 'origin' | 'pin' | 'nearby'
  let _pinId = null;
  let _searchTimer = null;
  let _nearbyCats = null;

  const ICON_MAPS = `<img class="fge-brand-ico" src="assets/icons/google-maps.svg" alt="" width="18" height="18">`;
  const ICON_WAZE = `<img class="fge-brand-ico" src="assets/icons/waze.svg?v=2" alt="" width="18" height="18">`;

  function _ensure() {
    if (_root) return;
    _root = document.createElement('div');
    _root.id = 'f-geo-editor';
    _root.innerHTML = `
      <div class="fge-backdrop" data-close></div>
      <div class="fge-sheet" role="dialog" aria-modal="true">
        <div class="fge-chrome">
          <div class="fge-traffic" aria-hidden="true">
            <span class="fge-dot fge-close" data-close></span>
            <span class="fge-dot"></span>
            <span class="fge-dot"></span>
          </div>
          <div class="fge-title" id="fge-title">Editar</div>
          <button type="button" class="fge-x" data-close aria-label="Cerrar">✕</button>
        </div>
        <div class="fge-body" id="fge-body"></div>
        <div class="fge-foot">
          <button type="button" class="fge-btn fge-btn--ghost" id="fge-delete" style="display:none">Eliminar</button>
          <div style="flex:1"></div>
          <button type="button" class="fge-btn fge-btn--ghost" data-close>Cancelar</button>
          <button type="button" class="fge-btn fge-btn--primary" id="fge-save">Guardar</button>
        </div>
      </div>
    `;
    document.body.appendChild(_root);
    _root.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));
    document.getElementById('fge-save').addEventListener('click', _save);
    document.getElementById('fge-delete').addEventListener('click', _delete);
  }

  function _bias() {
    const o = window.FerrariGeo && window.FerrariGeo.droneOrigin;
    return o ? { lat: o.lat, lng: o.lng, countrycodes: 'cl' } : { countrycodes: 'cl' };
  }

  function _bindSearch(inputId, dropId, onPick) {
    const input = document.getElementById(inputId);
    const drop = document.getElementById(dropId);
    if (!input || !drop || !window.FerrariPlaces) return;

    const run = async () => {
      const q = input.value.trim();
      if (q.length < 2) {
        drop.classList.remove('is-open');
        drop.innerHTML = '';
        return;
      }
      drop.innerHTML = `<div class="fge-sug-loading">Buscando en mapas…</div>`;
      drop.classList.add('is-open');
      try {
        const results = await window.FerrariPlaces.search(q, Object.assign({ limit: 6 }, _bias()));
        if (!results.length) {
          drop.innerHTML = `<div class="fge-sug-empty">Sin resultados. Prueba “Volcán Osorno” o una ciudad.</div>`;
          return;
        }
        drop.innerHTML = results.map((r, i) => `
          <button type="button" class="fge-sug" data-i="${i}">
            <span class="fge-sug-name">${_esc(r.name)}</span>
            <span class="fge-sug-label">${_esc(r.label)}</span>
          </button>
        `).join('');
        drop._results = results;
        drop.querySelectorAll('.fge-sug').forEach(btn => {
          btn.addEventListener('click', () => {
            const item = drop._results[parseInt(btn.dataset.i, 10)];
            if (item) onPick(item);
            drop.classList.remove('is-open');
          });
        });
      } catch (e) {
        drop.innerHTML = `<div class="fge-sug-empty">Error de búsqueda. Reintenta.</div>`;
      }
    };

    input.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(run, 380);
    });
    input.addEventListener('focus', () => {
      if (drop.innerHTML) drop.classList.add('is-open');
    });
    document.addEventListener('click', (e) => {
      if (!drop.contains(e.target) && e.target !== input) drop.classList.remove('is-open');
    });
  }

  function openOrigin() {
    _ensure();
    _mode = 'origin';
    _pinId = null;
    document.getElementById('fge-title').textContent = 'Origen Dron';
    document.getElementById('fge-delete').style.display = 'none';
    document.getElementById('fge-save').textContent = 'Guardar';
    document.getElementById('fge-save').style.display = '';
    const o = window.FerrariGeo.droneOrigin || {};
    document.getElementById('fge-body').innerHTML = `
      <p class="fge-help">Busca la ubicación del takeoff o pega coordenadas en decimal o DMS. Todo el sistema mide distancias desde aquí.</p>
      <div class="fge-search-wrap">
        <label class="fge-field"><span>Buscar en el mapa</span>
          <input id="fge-search" type="text" placeholder="Ej: Puerto Varas, Chile" autocomplete="off">
        </label>
        <div class="fge-sug-list" id="fge-sug"></div>
      </div>
      <label class="fge-field"><span>Etiqueta</span>
        <input id="fge-label" type="text" value="${_esc(o.label || 'Origen dron')}" placeholder="Ej: Takeoff Loteo Norte">
      </label>
      <label class="fge-field"><span>Pegar coordenadas (par completo)</span>
        <input id="fge-coords-paste" type="text" spellcheck="false" autocomplete="off"
          placeholder='Ej: 41°52&apos;35.37"S 72°44&apos;50.81"W'>
      </label>
      <div class="fge-row">
        <label class="fge-field"><span>Latitud</span>
          <input id="fge-lat" type="text" inputmode="decimal" spellcheck="false" autocomplete="off"
            value="${o.lat != null ? o.lat : ''}" placeholder="-41.87649167 ó 41°52'35.37&quot;S">
        </label>
        <label class="fge-field"><span>Longitud</span>
          <input id="fge-lng" type="text" inputmode="decimal" spellcheck="false" autocomplete="off"
            value="${o.lng != null ? o.lng : ''}" placeholder="-72.74744722 ó 72°44'50.81&quot;W">
        </label>
      </div>
      <p class="fge-hint">Acepta decimal (<code>-41.87, -72.74</code>) o DMS (<code>41°52'35.37"S 72°44'50.81"W</code>). Al pegar el par se rellenan lat/lng. Guarda aquí y luego <strong>Guardar</strong> en el panel para publicar en GitHub.</p>
    `;
    _bindSearch('fge-search', 'fge-sug', (item) => {
      document.getElementById('fge-label').value = item.name;
      document.getElementById('fge-lat').value = item.lat;
      document.getElementById('fge-lng').value = item.lng;
      document.getElementById('fge-search').value = item.name;
      const paste = document.getElementById('fge-coords-paste');
      if (paste) paste.value = '';
    });
    _bindOriginCoordInputs();
    _root.classList.add('is-open');
  }

  function _applyParsedPair(pair, silent) {
    if (!pair) return false;
    const latEl = document.getElementById('fge-lat');
    const lngEl = document.getElementById('fge-lng');
    if (!latEl || !lngEl) return false;
    latEl.value = String(pair.lat);
    lngEl.value = String(pair.lng);
    if (!silent) {
      window.FerrariUI && window.FerrariUI.showToast(
        `✓ Coordenadas: ${pair.lat}, ${pair.lng}`,
        'success'
      );
    }
    return true;
  }

  function _bindOriginCoordInputs() {
    const paste = document.getElementById('fge-coords-paste');
    const latEl = document.getElementById('fge-lat');
    const lngEl = document.getElementById('fge-lng');
    if (!paste || !latEl || !lngEl) return;

    const tryPaste = () => {
      const raw = paste.value.trim();
      if (!raw) return;
      const pair = window.FerrariGeo.parseLatLngPair(raw);
      if (pair) _applyParsedPair(pair, false);
    };

    paste.addEventListener('paste', () => setTimeout(tryPaste, 0));
    paste.addEventListener('change', tryPaste);
    paste.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        tryPaste();
      }
    });

    const normalizeField = (el, kind) => {
      const raw = el.value.trim();
      if (!raw) return;
      // Si pegaron el par completo en un solo campo
      const pair = window.FerrariGeo.parseLatLngPair(raw);
      if (pair) {
        _applyParsedPair(pair, true);
        if (paste) paste.value = raw;
        return;
      }
      const v = window.FerrariGeo.parseCoordinate(raw, kind);
      if (!isNaN(v)) el.value = String(v);
    };

    latEl.addEventListener('change', () => normalizeField(latEl, 'lat'));
    lngEl.addEventListener('change', () => normalizeField(lngEl, 'lng'));
    latEl.addEventListener('paste', () => setTimeout(() => normalizeField(latEl, 'lat'), 0));
    lngEl.addEventListener('paste', () => setTimeout(() => normalizeField(lngEl, 'lng'), 0));
  }

  function open(pinId) {
    _ensure();
    const pin = window.FerrariGeo.getPin(pinId);
    if (!pin) return;
    _mode = 'pin';
    _pinId = pinId;

    const tipoLabel = { horizonte: 'Horizonte', ruta: 'Ruta / Acceso', poi: 'Lugar cercano' }[pin.tipo] || 'Pin';
    document.getElementById('fge-title').textContent = tipoLabel;
    document.getElementById('fge-delete').style.display = '';
    document.getElementById('fge-save').textContent = 'Guardar';
    document.getElementById('fge-save').style.display = '';

    const cats = window.FerrariGeo.CATEGORIES[pin.tipo] || {};
    const opts = Object.keys(cats).map(k =>
      `<option value="${k}" ${k === pin.categoria ? 'selected' : ''}>${cats[k].emoji} ${cats[k].label}</option>`
    ).join('');

    const dist = window.FerrariGeo.formatPinDistanceEta
      ? window.FerrariGeo.formatPinDistanceEta(pin)
      : (pin._distM != null
        ? `≈ ${window.FerrariGeo.formatDistance(pin._distM)} · ${window.FerrariGeo.formatEtaMinutes(pin._distM)}`
        : 'Define origen dron + lugar');

    const ph = pin.tipo === 'horizonte'
      ? 'Ej: Volcán Osorno, Puerto Varas…'
      : pin.tipo === 'ruta'
        ? 'Ej: Ruta 225, acceso norte…'
        : 'Ej: Hospital, Copec…';

    const routeDistM = pin.routeDistM != null ? pin.routeDistM : pin._routeDistM;
    const routeSec = pin.routeSec != null ? pin.routeSec : pin._routeSec;
    const routeKmVal = routeDistM != null ? (routeDistM / 1000).toFixed(1) : '';
    const routeEtaH = routeSec != null ? Math.floor(routeSec / 3600) : '';
    const routeEtaM = routeSec != null ? Math.round((routeSec % 3600) / 60) : '';

    document.getElementById('fge-body').innerHTML = `
      <div class="fge-search-wrap">
        <label class="fge-field"><span>Buscar lugar (auto-coordenadas)</span>
          <input id="fge-search" type="text" value="${_esc(pin.titulo || '')}" placeholder="${_esc(ph)}" autocomplete="off">
        </label>
        <div class="fge-sug-list" id="fge-sug"></div>
      </div>
      <label class="fge-field"><span>Nombre en el pin</span>
        <input id="fge-label" type="text" value="${_esc(pin.titulo || '')}" placeholder="Nombre visible">
      </label>
      <label class="fge-field"><span>Categoría</span>
        <select id="fge-cat">${opts}</select>
      </label>
      <div class="fge-row">
        <label class="fge-field"><span>Latitud</span>
          <input id="fge-lat" type="number" step="any" value="${pin.lat != null ? pin.lat : ''}" placeholder="Auto">
        </label>
        <label class="fge-field"><span>Longitud</span>
          <input id="fge-lng" type="number" step="any" value="${pin.lng != null ? pin.lng : ''}" placeholder="Auto">
        </label>
      </div>
      <div class="fge-metric">
        <span>Distancia / ETA desde origen</span>
        <strong id="fge-metric">${dist}</strong>
      </div>
      <div class="fge-google-route">
        <div class="fge-field"><span>Ruta Google (real · con ferry)</span></div>
        <p class="fge-hint" style="margin:0 0 8px">OSRM se equivoca en Carretera Austral. Abre Google Maps, copia km y tiempo (ej. 194 km · 6 h 26 min) y pégalos aquí.</p>
        <div class="fge-row">
          <label class="fge-field"><span>Km (Google)</span>
            <input id="fge-g-km" type="text" inputmode="decimal" value="${_esc(routeKmVal)}" placeholder="194">
          </label>
          <label class="fge-field"><span>Horas</span>
            <input id="fge-g-h" type="number" min="0" step="1" value="${routeEtaH}" placeholder="6">
          </label>
          <label class="fge-field"><span>Min</span>
            <input id="fge-g-m" type="number" min="0" max="59" step="1" value="${routeEtaM}" placeholder="26">
          </label>
        </div>
        <label class="fge-field" style="margin-top:8px"><span>O pega el texto de Google</span>
          <input id="fge-g-paste" type="text" placeholder="194 km · 6 h 26 min" autocomplete="off">
        </label>
        <div class="fge-row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
          <button type="button" class="fge-btn" id="fge-g-apply">Usar valores Google</button>
          <button type="button" class="fge-btn" id="fge-g-open">Abrir ruta en Google</button>
          ${pin.routeManual ? '<button type="button" class="fge-btn" id="fge-g-clear">Quitar override</button>' : ''}
        </div>
      </div>
      <label class="fge-field"><span>Notas</span>
        <textarea id="fge-notas" rows="2" placeholder="Detalle comercial para el comprador…">${_esc(pin.notas || '')}</textarea>
      </label>
      <label class="fge-check">
        <input type="checkbox" id="fge-autoyaw" ${pin.lockYaw ? '' : 'checked'}>
        <span>Alinear al bearing GPS (horizonte: déjalo off para no mover el pin del cielo)</span>
      </label>
      <div class="fge-links" id="fge-links"></div>
    `;

    _updateLinks(pin);
    _bindGoogleRouteUi(pin);
    _bindSearch('fge-search', 'fge-sug', (item) => {
      document.getElementById('fge-label').value = item.name;
      document.getElementById('fge-search').value = item.name;
      document.getElementById('fge-lat').value = item.lat;
      document.getElementById('fge-lng').value = item.lng;
      const cat = window.FerrariPlaces.guessCategoryFromType(pin.tipo, item.type);
      const sel = document.getElementById('fge-cat');
      if (sel && [...sel.options].some(o => o.value === cat)) sel.value = cat;
      // Horizonte: NO mover el pin del cielo (el usuario lo colocó a ojo).
      // Solo Ruta/POI alinean yaw al bearing GPS.
      if (pin.tipo !== 'horizonte') {
        document.getElementById('fge-autoyaw').checked = true;
      }
      _refreshMetric();
      _updateLinks({ lat: item.lat, lng: item.lng, titulo: item.name });
      window.FerrariUI && window.FerrariUI.showToast(
        pin.tipo === 'horizonte'
          ? 'GPS aplicado · el pin sigue donde lo colocaste en el panorama.'
          : 'Coordenadas aplicadas desde el mapa.',
        'success'
      );
    });

    document.getElementById('fge-lat').addEventListener('input', _refreshMetric);
    document.getElementById('fge-lng').addEventListener('input', _refreshMetric);
    _root.classList.add('is-open');
  }

  /** Modal de lugares cercanos con categorías + búsqueda puntual */
  function openNearby() {
    _ensure();
    _mode = 'nearby';
    _pinId = null;
    document.getElementById('fge-title').textContent = 'Lugares de primera necesidad';
    document.getElementById('fge-delete').style.display = 'none';
    document.getElementById('fge-save').textContent = 'Importar seleccionados';
    document.getElementById('fge-save').style.display = '';

    if (!window.FerrariGeo.droneOrigin) {
      window.FerrariUI && window.FerrariUI.showToast('Define primero el Origen Dron.', 'error');
      openOrigin();
      return;
    }

    const cats = window.FerrariGeo.CATEGORIES.poi;
    const groups = [
      { title: 'Salud', keys: ['hospital', 'consultorio', 'posta', 'sapu', 'asistencia', 'farmacia'] },
      { title: 'Seguridad', keys: ['comisaria', 'reten', 'bomberos'] },
      { title: 'Educación y compras', keys: ['colegio', 'supermercado', 'comercio', 'negocio'] },
      { title: 'Servicios', keys: ['bencinera'] }
    ];

    _nearbyCats = {};
    groups.forEach(g => g.keys.forEach(k => { _nearbyCats[k] = true; }));

    document.getElementById('fge-body').innerHTML = `
      <div class="fge-nearby-tabs">
        <button type="button" class="fge-ntab is-on" data-ntab="import">Importar por radio</button>
        <button type="button" class="fge-ntab" data-ntab="search">Buscar uno</button>
      </div>
      <div class="fge-npanel" id="fge-npanel-import">
        <p class="fge-help">Importa consultorios, postas, comisarías, colegios, supermercados, bomberos y más alrededor del origen del dron.</p>
        ${groups.map(g => `
          <div class="fge-field"><span>${g.title}</span></div>
          <div class="fge-chips">
            ${g.keys.map(k => `
              <button type="button" class="fge-chip is-on" data-cat="${k}">${cats[k].emoji} ${cats[k].label}</button>
            `).join('')}
          </div>
        `).join('')}
        <label class="fge-field"><span>Radio (metros)</span>
          <input id="fge-radius" type="number" min="500" max="30000" step="500" value="8000">
        </label>
        <p class="fge-hint">Datos de OpenStreetMap. Guarda con el botón Guardar del panel para publicar en datos.json.</p>
      </div>
      <div class="fge-npanel" id="fge-npanel-search" style="display:none">
        <p class="fge-help">Busca un lugar concreto (clínica, retén, local) y añádelo al panorama.</p>
        <div class="fge-search-wrap">
          <label class="fge-field"><span>Buscar y añadir</span>
            <input id="fge-search" type="text" placeholder="Ej: Hospital Puerto Montt, Bomberos…" autocomplete="off">
          </label>
          <div class="fge-sug-list" id="fge-sug"></div>
        </div>
      </div>
    `;

    document.querySelectorAll('.fge-ntab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.fge-ntab').forEach(t => t.classList.toggle('is-on', t === tab));
        const isImport = tab.dataset.ntab === 'import';
        document.getElementById('fge-npanel-import').style.display = isImport ? '' : 'none';
        document.getElementById('fge-npanel-search').style.display = isImport ? 'none' : '';
        document.getElementById('fge-save').style.display = isImport ? '' : 'none';
      });
    });

    document.getElementById('fge-body').addEventListener('click', (e) => {
      const chip = e.target.closest('.fge-chip');
      if (!chip) return;
      const cat = chip.dataset.cat;
      chip.classList.toggle('is-on');
      _nearbyCats[cat] = chip.classList.contains('is-on');
    });

    _bindSearch('fge-search', 'fge-sug', (item) => {
      const cat = window.FerrariPlaces.guessCategoryFromType('poi', item.type + ' ' + item.name + ' ' + item.label);
      window.FerrariGeo.addPin({
        tipo: 'poi',
        categoria: window.FerrariGeo.CATEGORIES.poi[cat] ? cat : 'otro',
        titulo: item.name,
        lat: item.lat,
        lng: item.lng,
        pitch: -6,
        autoYaw: true,
        lockYaw: false,
        notas: item.label
      });
      window.FerrariUI && window.FerrariUI.showToast(`✓ Añadido: ${item.name}`, 'success');
      document.getElementById('fge-search').value = '';
    });

    _root.classList.add('is-open');
  }

  /** Vista solo lectura para el comprador */
  function openInfo(id) {
    _ensure();
    const pin = window.FerrariGeo.getPin(id);
    if (!pin) return;
    _mode = 'info';
    _pinId = id;
    const meta = window.FerrariGeo.categoryMeta(pin.tipo, pin.categoria);
    document.getElementById('fge-title').textContent = pin.titulo || meta.label;
    document.getElementById('fge-delete').style.display = 'none';
    document.getElementById('fge-save').style.display = 'none';

    let metric = meta.label;
    if (window.FerrariGeo.formatPinDistanceEta) {
      const m = window.FerrariGeo.formatPinDistanceEta(pin);
      if (m && m !== '—') metric = m;
    } else if (pin._routeDistM != null && pin._routeSec != null) {
      metric = `${window.FerrariGeo.formatDistance(pin._routeDistM)} · ${window.FerrariGeo.formatEtaSeconds(pin._routeSec)}`;
    } else if (pin._distM != null) {
      metric = `≈ ${window.FerrariGeo.formatDistance(pin._distM)} · ${window.FerrariGeo.formatEtaMinutes(pin._distM)}`;
    }

    let linksHtml = '';
    if (pin.lat != null && pin.lng != null) {
      const links = window.FerrariGeo.mapsLinks(pin.lat, pin.lng);
      linksHtml = `
        <div class="fge-links">
          <a class="fge-ext fge-ext--brand" href="${links.google}" target="_blank" rel="noopener">
            ${ICON_MAPS}<span>Ruta en Google Maps</span>
          </a>
          <a class="fge-ext fge-ext--brand" href="${links.waze}" target="_blank" rel="noopener">
            ${ICON_WAZE}<span>Navegar con Waze</span>
          </a>
        </div>
      `;
    }

    document.getElementById('fge-body').innerHTML = `
      <div class="fge-info-hero">
        <div class="fge-info-emoji">${meta.emoji || '📍'}</div>
        <div>
          <div class="fge-info-cat">${_esc(meta.label)}</div>
          <div class="fge-info-metric">${_esc(metric)}</div>
        </div>
      </div>
      ${pin.notas ? `<p class="fge-help">${_esc(pin.notas)}</p>` : ''}
      ${linksHtml}
      <p class="fge-hint">Información de referencia para el comprador. No editable.</p>
    `;
    _root.classList.add('is-open');
  }

  function _bindGoogleRouteUi(pin) {
    const applyBtn = document.getElementById('fge-g-apply');
    const openBtn = document.getElementById('fge-g-open');
    const clearBtn = document.getElementById('fge-g-clear');
    const pasteEl = document.getElementById('fge-g-paste');

    if (pasteEl) {
      pasteEl.addEventListener('change', () => {
        const raw = pasteEl.value.trim();
        if (!raw) return;
        // "194 km · 6 h 26 min" o "194 km 6 h 26 min"
        const parts = raw.split(/[|\u00B7]+/).map(s => s.trim()).filter(Boolean);
        let distPart = parts[0] || raw;
        let etaPart = parts[1] || '';
        if (!etaPart) {
          const m = raw.match(/([\d.,]+\s*km)\s*(.+)/i);
          if (m) { distPart = m[1]; etaPart = m[2]; }
        }
        const parsed = window.FerrariGeo.parseGoogleRouteText(distPart, etaPart);
        if (!parsed) return;
        const kmEl = document.getElementById('fge-g-km');
        const hEl = document.getElementById('fge-g-h');
        const mEl = document.getElementById('fge-g-m');
        if (kmEl) kmEl.value = String(parsed.distKm);
        if (hEl) hEl.value = String(Math.floor(parsed.etaMin / 60));
        if (mEl) mEl.value = String(Math.round(parsed.etaMin % 60));
      });
    }

    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        const kmRaw = (document.getElementById('fge-g-km') && document.getElementById('fge-g-km').value) || '';
        const h = parseFloat((document.getElementById('fge-g-h') && document.getElementById('fge-g-h').value) || '0') || 0;
        const m = parseFloat((document.getElementById('fge-g-m') && document.getElementById('fge-g-m').value) || '0') || 0;
        let distKm = parseFloat(String(kmRaw).replace(',', '.').replace(/[^\d.]/g, ''));
        let etaMin = h * 60 + m;
        const paste = (document.getElementById('fge-g-paste') && document.getElementById('fge-g-paste').value || '').trim();
        if (paste && (!(distKm > 0) || !(etaMin > 0))) {
          const parts = paste.split(/[|\u00B7]+/).map(s => s.trim()).filter(Boolean);
          const parsed = window.FerrariGeo.parseGoogleRouteText(parts[0] || paste, parts[1] || '');
          if (parsed) {
            distKm = parsed.distKm;
            etaMin = parsed.etaMin;
          }
        }
        if (!(distKm > 0) || !(etaMin > 0)) {
          window.FerrariUI && window.FerrariUI.showToast('Ingresa km y tiempo de Google (ej. 194 y 6 h 26 min).', 'error');
          return;
        }
        if (!window.FerrariGeo.setManualRoute(_pinId, distKm, etaMin, 'google')) {
          window.FerrariUI && window.FerrariUI.showToast('No se pudo aplicar la ruta Google.', 'error');
          return;
        }
        const updated = window.FerrariGeo.getPin(_pinId);
        const metric = document.getElementById('fge-metric');
        if (metric && updated) metric.textContent = window.FerrariGeo.formatPinDistanceEta(updated);
        window.FerrariUI && window.FerrariUI.showToast(`✓ Ruta Google: ${distKm} km · ${window.FerrariGeo.formatEtaSeconds(etaMin * 60)}`, 'success');
      });
    }

    if (openBtn) {
      openBtn.addEventListener('click', () => {
        const lat = parseFloat(document.getElementById('fge-lat').value);
        const lng = parseFloat(document.getElementById('fge-lng').value);
        if (isNaN(lat) || isNaN(lng)) {
          window.FerrariUI && window.FerrariUI.showToast('Faltan coordenadas del destino.', 'error');
          return;
        }
        const links = window.FerrariGeo.mapsLinks(lat, lng);
        window.open(links.google, '_blank', 'noopener');
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        window.FerrariGeo.updatePin(_pinId, {
          routeManual: false,
          routeDistM: null,
          routeSec: null,
          routeSource: null
        });
        const p = window.FerrariGeo.getPin(_pinId);
        if (p) {
          p.routeManual = false;
          p.routeDistM = null;
          p.routeSec = null;
          p.routeSource = null;
          p._routeDistM = null;
          p._routeSec = null;
        }
        window.FerrariGeo.enrichPinRoutes(true).catch(() => {});
        const metric = document.getElementById('fge-metric');
        if (metric && p) metric.textContent = window.FerrariGeo.formatPinDistanceEta(p);
        window.FerrariUI && window.FerrariUI.showToast('Override Google quitado · se recalcula OSRM.', 'info');
      });
    }
  }

  function _refreshMetric() {
    const latEl = document.getElementById('fge-lat');
    const lngEl = document.getElementById('fge-lng');
    const m = document.getElementById('fge-metric');
    if (!latEl || !lngEl || !m) return;
    const la = parseFloat(latEl.value), ln = parseFloat(lngEl.value);
    if (isNaN(la) || isNaN(ln) || !window.FerrariGeo.droneOrigin) {
      m.textContent = 'Define origen dron + lugar';
      return;
    }
    const d = window.FerrariGeo.distanceFromOrigin(la, ln);
    const tipoEl = document.getElementById('fge-tipo');
    const tipo = (tipoEl && tipoEl.value) || (_pinId && window.FerrariGeo.getPin(_pinId) || {}).tipo || '';
    if (tipo === 'horizonte') {
      m.textContent = `≈ ${window.FerrariGeo.formatDistance(d)} · ${window.FerrariGeo.formatEtaMinutes(d)} (línea recta · la ruta en auto se calcula al guardar)`;
    } else {
      m.textContent = `${window.FerrariGeo.formatDistance(d)} · ${window.FerrariGeo.formatEtaMinutes(d)}`;
    }
  }

  function _updateLinks(pin) {
    const box = document.getElementById('fge-links');
    if (!box) return;
    if (pin.lat == null || pin.lng == null) {
      box.innerHTML = '';
      return;
    }
    const links = window.FerrariGeo.mapsLinks(pin.lat, pin.lng);
    const q = pin.titulo
      ? window.FerrariPlaces.googleSearchUrl(pin.titulo)
      : links.google;
    box.innerHTML = `
      <a class="fge-ext fge-ext--brand" href="${links.google}" target="_blank" rel="noopener">
        ${ICON_MAPS}<span>Ruta en Google Maps</span>
      </a>
      <a class="fge-ext fge-ext--brand" href="${links.waze}" target="_blank" rel="noopener">
        ${ICON_WAZE}<span>Navegar con Waze</span>
      </a>
      <a class="fge-ext" href="${q}" target="_blank" rel="noopener">Ver lugar en Google Maps</a>
    `;
  }

  function close() {
    if (_root) _root.classList.remove('is-open');
    _mode = null;
    _pinId = null;
    const saveBtn = document.getElementById('fge-save');
    if (saveBtn) {
      saveBtn.textContent = 'Guardar';
      saveBtn.style.display = '';
    }
  }

  function _save() {
    if (_mode === 'nearby') {
      const radius = parseInt(document.getElementById('fge-radius').value, 10) || 8000;
      const selected = Object.keys(_nearbyCats || {}).filter(k => _nearbyCats[k]);
      close();
      if (window.FerrariGeoTools && window.FerrariGeoTools.fetchNearby) {
        window.FerrariGeoTools.fetchNearby(radius, selected);
      }
      return;
    }

    if (_mode === 'origin') {
      const pasteRaw = (document.getElementById('fge-coords-paste')?.value || '').trim();
      let lat = document.getElementById('fge-lat').value;
      let lng = document.getElementById('fge-lng').value;
      const label = document.getElementById('fge-label').value;

      if (pasteRaw) {
        const pair = window.FerrariGeo.parseLatLngPair(pasteRaw);
        if (pair) {
          lat = pair.lat;
          lng = pair.lng;
        }
      }

      if (!window.FerrariGeo.setDroneOrigin(lat, lng, label)) {
        window.FerrariUI && window.FerrariUI.showToast(
          'Coordenadas inválidas. Usa decimal o DMS (ej: 41°52\'35.37"S 72°44\'50.81"W).',
          'error'
        );
        return;
      }
      const o = window.FerrariGeo.droneOrigin;
      window.FerrariUI && window.FerrariUI.showToast(
        o
          ? `✓ Origen fijado (${o.lat}, ${o.lng}). Usa Guardar del panel para publicarlo.`
          : 'Origen dron guardado localmente.',
        'success'
      );
      close();
      return;
    }

    if (_mode === 'pin' && _pinId) {
      const titulo = document.getElementById('fge-label').value.trim();
      const categoria = document.getElementById('fge-cat').value;
      const latRaw = document.getElementById('fge-lat').value;
      const lngRaw = document.getElementById('fge-lng').value;
      const notas = document.getElementById('fge-notas').value;
      const autoYaw = document.getElementById('fge-autoyaw').checked;

      const lat = latRaw === '' ? null : parseFloat(latRaw);
      const lng = lngRaw === '' ? null : parseFloat(lngRaw);
      if ((latRaw !== '' && isNaN(lat)) || (lngRaw !== '' && isNaN(lng))) {
        window.FerrariUI && window.FerrariUI.showToast('Coordenadas inválidas.', 'error');
        return;
      }

      const patch = { titulo, categoria, lat, lng, notas, lockYaw: !autoYaw };

      // Si el usuario dejó km/ETA Google rellenos, persistirlos al Guardar
      const kmRaw = (document.getElementById('fge-g-km') && document.getElementById('fge-g-km').value) || '';
      const gH = parseFloat((document.getElementById('fge-g-h') && document.getElementById('fge-g-h').value) || '');
      const gM = parseFloat((document.getElementById('fge-g-m') && document.getElementById('fge-g-m').value) || '');
      const distKm = parseFloat(String(kmRaw).replace(',', '.').replace(/[^\d.]/g, ''));
      if (distKm > 0 && ((gH > 0 || gM > 0) || !isNaN(gH) || !isNaN(gM))) {
        const etaMin = (isNaN(gH) ? 0 : gH) * 60 + (isNaN(gM) ? 0 : gM);
        if (etaMin > 0) {
          patch.routeDistM = Math.round(distKm * 1000);
          patch.routeSec = Math.round(etaMin * 60);
          patch.routeSource = 'google';
          patch.routeManual = true;
        }
      }

      if (autoYaw && lat != null && lng != null && window.FerrariGeo.droneOrigin) {
        const brg = window.FerrariGeo.bearingDeg(
          window.FerrariGeo.droneOrigin.lat,
          window.FerrariGeo.droneOrigin.lng,
          lat, lng
        );
        patch.yaw = window.FerrariGeo.bearingToYaw(brg);
        patch.lockYaw = false;
      }

      window.FerrariGeo.updatePin(_pinId, patch);
      window.FerrariUI && window.FerrariUI.showToast('Pin actualizado.', 'success');
      close();
    }
  }

  function _delete() {
    if (_mode !== 'pin' || !_pinId) return;
    if (!confirm('¿Eliminar este pin?')) return;
    window.FerrariGeo.removePin(_pinId);
    window.FerrariUI && window.FerrariUI.showToast('Pin eliminado.', 'info');
    close();
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  window.FerrariGeoEditor = { open, openOrigin, openNearby, openInfo, close };

  console.log('[Ferrari/GeoEditor] ✓ Módulo inicializado');

})();
