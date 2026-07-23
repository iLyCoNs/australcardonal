/**
 * f-buyer-dock.js — Dock informativo del comprador (colapsable)
 * Solo lectura. Minimiza la visión 360° hasta que el lector lo despliega.
 * Rutas Maps/Waze ancladas al origen del dron + minimapa satélite.
 */

'use strict';

(function () {

  const ESTADOS = [
    { id: 'todos', label: 'Todos' },
    { id: 'disponible', label: 'Disponibles' },
    { id: 'reservado', label: 'Reservados' },
    { id: 'vendido', label: 'Vendidos' },
    { id: 'nodisponible', label: 'No disp.' }
  ];

  const POI_GROUPS = [
    { id: 'all', label: 'Todos' },
    { id: 'salud', label: 'Salud', cats: ['hospital', 'consultorio', 'posta', 'sapu', 'farmacia', 'asistencia'] },
    { id: 'seguridad', label: 'Seguridad', cats: ['comisaria', 'reten', 'bomberos'] },
    { id: 'educacion', label: 'Colegios', cats: ['colegio'] },
    { id: 'compras', label: 'Compras', cats: ['supermercado', 'comercio', 'negocio'] },
    { id: 'servicios', label: 'Servicios', cats: ['bencinera', 'otro'] }
  ];

  const ICON_MAPS = 'assets/icons/google-maps.svg';
  const ICON_WAZE = 'assets/icons/waze.svg?v=2';

  let _root = null;
  let _loteFilter = 'todos';
  let _poiFilter = 'all';
  let _tab = 'lotes'; // lotes | lugares | mapa
  let _expanded = false;
  let _ctaOpen = false;
  let _bound = false;
  let _spotlightNearbyId = null; // pin cercano visible en la foto (comprador)
  let _nearbyOnPhoto = false;
  let _mapLoadedFor = null;
  let _nearbyRadius = 10; // km, configurable por el cliente 1–30
  let _nearbySearched = false; // true una vez que se disparó la búsqueda OSM en la sesión
  let _showMapInLugares = false; // si el usuario quiere ver el mini-mapa dentro del tab Cercanos

  const ICON_PLUS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  const ICON_MINUS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg>';

  function _syncToggleChrome() {
    const root = _ensure();
    const toggle = root.querySelector('#kbd-toggle');
    const ico = toggle && toggle.querySelector('.kbd-toggle-ico');
    const label = root.querySelector('#kbd-toggle-label');
    if (!toggle) return;
    toggle.hidden = false;
    toggle.setAttribute('aria-expanded', _expanded ? 'true' : 'false');
    if (ico) ico.innerHTML = _expanded ? ICON_MINUS : ICON_PLUS;
    if (label) {
      label.textContent = _expanded ? 'Minimizar dock informativo' : 'Desplegar dock informativo';
    }
  }

  function _setNearbyOnPhoto(show, pinId) {
    _nearbyOnPhoto = !!show;
    _spotlightNearbyId = show ? (pinId || null) : null;
    if (window.FerrariGeoPins && typeof window.FerrariGeoPins.setBuyerNearbyFilter === 'function') {
      window.FerrariGeoPins.setBuyerNearbyFilter({
        enabled: true,
        show: _nearbyOnPhoto,
        spotlightId: _spotlightNearbyId
      });
    }
  }

  function _contact() {
    if (window.FerrariBrandDock && typeof window.FerrariBrandDock.getContact === 'function') {
      return window.FerrariBrandDock.getContact();
    }
    return {
      platformCta: 'Consigue tu 360° aquí',
      platformWhatsapp: '',
      platformWeb: 'https://www.australdrone.cl',
      platformLogo: 'https://raw.githubusercontent.com/iLyCoNs/austral-drones/refs/heads/main/logobanner.png',
      platformName: 'Austral Drone'
    };
  }

  function _isToolMode() {
    if (window.FerrariPanel && typeof window.FerrariPanel.isToolMode === 'function') {
      return window.FerrariPanel.isToolMode();
    }
    const panel = document.getElementById('kpk-panel');
    return !!(panel && panel.classList.contains('kpk-panel--open'));
  }

  function _origin() {
    return (window.FerrariGeo && window.FerrariGeo.droneOrigin) || null;
  }

  function _originLinks() {
    const o = _origin();
    if (!o) return null;
    const q = `${o.lat},${o.lng}`;
    return {
      maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
      satellite: `https://www.google.com/maps/@${o.lat},${o.lng},17z/data=!3m1!1e3`,
      waze: `https://waze.com/ul?ll=${encodeURIComponent(q)}&navigate=yes`,
      embed: `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=16&t=k&hl=es&output=embed`
    };
  }

  // Construye una URL de embed de Google Maps que muestra la búsqueda de POIs
  // del filtro activo, centrada exactamente en las coordenadas del drone.
  function _buildPoiMapUrl() {
    const o = _origin();
    if (!o) return null;
    // Mapeo de filtro → término de búsqueda en español + inglés para mayor cobertura OSM
    const queryMap = {
      all:       'servicios cercanos',
      salud:     'hospital clínica farmacia',
      seguridad: 'carabineros bomberos policía',
      educacion: 'colegio escuela liceo',
      compras:   'supermercado market comercio',
      servicios: 'bencinera gasolinera servicios'
    };
    const term = queryMap[_poiFilter] || 'servicios cercanos';
    // Embed sin API key (evita secret scanning). Misma familia que el minimapa satélite.
    const q = encodeURIComponent(`${term} cerca de ${o.lat},${o.lng}`);
    return `https://maps.google.com/maps?q=${q}&z=14&t=m&hl=es&output=embed`;
  }

  // Envía el query de búsqueda de POIs abriendo Google Maps en una nueva pestaña
  // como alternativa cuando el API key del embed falla
  function _openPoiSearch() {
    const o = _origin();
    if (!o) return;
    const queryMap = {
      all:       'servicios',
      salud:     'hospital farmacia',
      seguridad: 'carabineros bomberos',
      educacion: 'colegio escuela',
      compras:   'supermercado',
      servicios: 'gasolinera servicios'
    };
    const term = queryMap[_poiFilter] || 'servicios';
    const url = `https://www.google.com/maps/search/${encodeURIComponent(term)}/@${o.lat},${o.lng},14z?hl=es`;
    window.open(url, '_blank', 'noopener');
  }

  function _destLinks(lat, lng) {
    if (lat == null || lng == null || !window.FerrariGeo || !window.FerrariGeo.mapsLinks) {
      return null;
    }
    return window.FerrariGeo.mapsLinks(lat, lng);
  }

  function _ensure() {
    if (_root) return _root;
    _root = document.createElement('div');
    _root.id = 'kpk-buyer-dock';
    _root.className = 'kpk-buyer-dock';
    _root.innerHTML = `
      <div class="kbd-stack">
        <button type="button" class="kbd-toggle" id="kbd-toggle" aria-expanded="false">
          <span class="kbd-toggle-ico" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </span>
          <span class="kbd-toggle-label" id="kbd-toggle-label">Desplegar dock informativo</span>
        </button>

        <button type="button" class="kbd-cta-btn" id="kbd-cta-btn" aria-expanded="false">
          <span class="kbd-cta-btn-mark" aria-hidden="true">360°</span>
          <span class="kbd-cta-btn-label" id="kbd-cta-label">Consigue tu 360° aquí</span>
          <span class="kbd-cta-btn-chev" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
          </span>
        </button>

        <div class="kbd-cta-sheet" id="kbd-cta-sheet" hidden>
          <div class="kbd-cta-glass">
            <button type="button" class="kbd-cta-close" id="kbd-cta-close" aria-label="Cerrar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            <div class="kbd-cta-brand">
              <div class="kbd-cta-logo-wrap">
                <img id="kbd-cta-logo" class="kbd-cta-logo" alt="Austral Drone" src="" hidden>
              </div>
              <div class="kbd-cta-brand-text">
                <div class="kbd-cta-eyebrow" id="kbd-cta-eyebrow">Diseño de tours 360°</div>
                <div class="kbd-cta-name" id="kbd-cta-name">Austral Drone</div>
              </div>
            </div>
            <div class="kbd-cta-rule" aria-hidden="true"></div>
            <p class="kbd-cta-copy">¿Necesitas más información o tu propio recorrido inmersivo? Habla directo con el equipo.</p>
            <div class="kbd-cta-actions" id="kbd-cta-actions"></div>
          </div>
        </div>

        <div class="kbd-panel" id="kbd-panel" hidden>
          <div class="kbd-glass">
            <div class="kbd-head">
              <div class="kbd-head-title">Información del proyecto</div>
              <button type="button" class="kbd-collapse" id="kbd-collapse" aria-label="Cerrar dock">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div class="kbd-origin" id="kbd-origin"></div>

            <div class="kbd-tabs" role="tablist">
              <button type="button" class="kbd-tab is-on" data-tab="lotes" role="tab">Lotes</button>
              <button type="button" class="kbd-tab" data-tab="lugares" role="tab">Cercanos</button>
              <button type="button" class="kbd-tab" data-tab="mapa" role="tab">Mapa</button>
            </div>

            <div class="kbd-body" id="kbd-body-lists">
              <div class="kbd-filters" id="kbd-filters"></div>
              <div class="kbd-radius-row" id="kbd-radius-row" hidden>
                <label class="kbd-radius-label">Radio de búsqueda</label>
                <div class="kbd-radius-control">
                  <input type="range" class="kbd-radius-slider" id="kbd-radius-slider" min="1" max="30" value="10" step="1">
                  <span class="kbd-radius-value" id="kbd-radius-value">10 km</span>
                </div>
              </div>
              <div class="kbd-search-row" id="kbd-search-row" hidden>
                <button type="button" class="kbd-search-btn" data-action="search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M16 16l5 5"/></svg>
                  Buscar lugares cercanos
                </button>
              </div>
              <div class="kbd-list" id="kbd-list" role="list"></div>
              <div class="kbd-foot" id="kbd-foot"></div>
            </div>

            <div class="kbd-body kbd-body--map" id="kbd-body-map" hidden>
              <div class="kbd-map-wrap" id="kbd-map-wrap">
                <div class="kbd-map-empty" id="kbd-map-empty">Define el origen del dron para ver el minimapa satélite.</div>
                <iframe id="kbd-map-frame" class="kbd-map-frame" title="Minimapa satélite del origen" loading="lazy" referrerpolicy="no-referrer-when-downgrade" hidden></iframe>
              </div>
              <div class="kbd-map-actions" id="kbd-map-actions"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(_root);

    _root.querySelector('#kbd-toggle').addEventListener('click', () => {
      setCtaOpen(false);
      setExpanded(!_expanded);
    });
    _root.querySelector('#kbd-collapse').addEventListener('click', () => setExpanded(false));
    _root.querySelector('#kbd-cta-btn').addEventListener('click', () => {
      setExpanded(false);
      setCtaOpen(!_ctaOpen);
    });
    _root.querySelector('#kbd-cta-close').addEventListener('click', () => setCtaOpen(false));
    _root.querySelector('#kbd-cta-actions').addEventListener('click', (e) => {
      const a = e.target.closest('[data-cta]');
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href') || a.dataset.href;
      if (href) window.open(href, '_blank', 'noopener');
    });

    _root.querySelector('.kbd-tabs').addEventListener('click', (e) => {
      if (!_expanded) return;
      const tab = e.target.closest('.kbd-tab');
      if (!tab) return;
      _tab = tab.dataset.tab;
      _root.querySelectorAll('.kbd-tab').forEach(t => t.classList.toggle('is-on', t === tab));
      // Lotes/mapa: foto limpia para comprar; cercanos se eligen uno a uno
      if (_tab !== 'lugares') {
        _setNearbyOnPhoto(false, null);
      }
      // Al cambiar a Cercanos desde la barra de tabs: auto-buscar si no se hizo
      if (_tab === 'lugares' && !_nearbySearched && _origin()) {
        _nearbySearched = true;
        _searchNearby({ silent: true });
      }
      render();
    });

    _root.querySelector('#kbd-body-lists').addEventListener('click', (e) => {
      if (!_expanded) return;
      const chip = e.target.closest('.kbd-chip');
      if (chip) {
        if (_tab === 'lotes') _loteFilter = chip.dataset.id;
        else {
          _poiFilter = chip.dataset.id;
          // Al cambiar el filtro, invalidar el mapa de POIs para que se recargue
          _mapLoadedFor = null;
        }
        render();
        return;
      }
      const searchBtn = e.target.closest('[data-action="search"]');
      if (searchBtn && _tab === 'lugares') {
        _searchNearby();
      }
    });

    _root.querySelector('#kbd-radius-slider').addEventListener('input', (e) => {
      _nearbyRadius = parseInt(e.target.value, 10);
      const val = _root.querySelector('#kbd-radius-value');
      if (val) val.textContent = _nearbyRadius + ' km';
    });

    _root.querySelector('#kbd-list').addEventListener('click', (e) => {
      if (!_expanded) return;
      const nav = e.target.closest('[data-nav]');
      if (nav) {
        e.preventDefault();
        e.stopPropagation();
        const url = nav.getAttribute('href') || nav.dataset.href;
        if (url) window.open(url, '_blank', 'noopener');
        return;
      }
      const item = e.target.closest('[data-lote-id],[data-pin-id]');
      if (!item) return;
      if (item.dataset.loteId) {
        if (window.FerrariUI && window.FerrariUI.openLotePanel) {
          window.FerrariUI.openLotePanel(item.dataset.loteId);
        }
      } else if (item.dataset.pinId) {
        _focusPin(item.dataset.pinId);
        render();
      }
    });

    _root.querySelector('#kbd-map-actions').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const links = _originLinks();
      const o = _origin();
      if (act === 'maps' && links) window.open(links.maps, '_blank', 'noopener');
      if (act === 'satellite' && links) window.open(links.satellite, '_blank', 'noopener');
      if (act === 'waze' && links) window.open(links.waze, '_blank', 'noopener');
      if (act === 'search-poi') _openPoiSearch();
      if (act === 'copy' && o) {
        const txt = `${o.lat}, ${o.lng}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(() => {
            window.FerrariUI && window.FerrariUI.showToast('Coordenadas copiadas', 'success');
          }).catch(() => {});
        }
      }
    });

    return _root;
  }

  function setExpanded(on) {
    _expanded = !!on;
    const root = _ensure();
    root.classList.toggle('is-expanded', _expanded);
    const panel = root.querySelector('#kbd-panel');
    if (panel) panel.hidden = !_expanded;
    _syncToggleChrome();

    if (!_expanded) {
      // Al minimizar: quitar pins cercanos de la foto (el terreno queda limpio)
      _setNearbyOnPhoto(false, null);
      _tab = 'lotes';
      root.querySelectorAll('.kbd-tab').forEach(t => {
        t.classList.toggle('is-on', t.dataset.tab === 'lotes');
      });
      const mapBody = root.querySelector('#kbd-body-map');
      const lists = root.querySelector('#kbd-body-lists');
      if (mapBody) mapBody.hidden = true;
      if (lists) lists.hidden = false;
      return;
    }

    setCtaOpen(false);
    render();
  }

  function setCtaOpen(on) {
    _ctaOpen = !!on;
    const root = _ensure();
    root.classList.toggle('is-cta-open', _ctaOpen);
    const sheet = root.querySelector('#kbd-cta-sheet');
    const btn = root.querySelector('#kbd-cta-btn');
    if (sheet) sheet.hidden = !_ctaOpen;
    if (btn) btn.setAttribute('aria-expanded', _ctaOpen ? 'true' : 'false');
    if (_ctaOpen) _renderCta();
  }

  function _renderCta() {
    const root = _ensure();
    const c = _contact();
    const label = root.querySelector('#kbd-cta-label');
    const name = root.querySelector('#kbd-cta-name');
    const eyebrow = root.querySelector('#kbd-cta-eyebrow');
    const logo = root.querySelector('#kbd-cta-logo');
    const actions = root.querySelector('#kbd-cta-actions');
    if (label) label.textContent = c.platformCta || 'Consigue tu 360° aquí';
    if (name) name.textContent = c.platformName || 'Austral Drone';
    if (eyebrow) eyebrow.textContent = 'Diseño de tours 360°';
    if (logo) {
      if (c.platformLogo) {
        logo.src = c.platformLogo;
        logo.alt = c.platformName || 'Logo';
        logo.hidden = false;
      } else {
        logo.hidden = true;
      }
    }
    if (!actions) return;

    const waText = `Hola ${c.platformName || 'Austral Drone'}, vi un tour 360° y quiero más información para mi proyecto.`;
    let waHref = null;
    if (window.FerrariBrandDock && window.FerrariBrandDock.whatsappUrl) {
      waHref = window.FerrariBrandDock.whatsappUrl(c.platformWhatsapp, waText);
    }
    const web = (c.platformWeb || 'https://www.australdrone.cl').trim();
    const webHref = /^https?:\/\//i.test(web) ? web : `https://${web}`;

    actions.innerHTML = `
      ${waHref ? `
        <a class="kbd-cta-link kbd-cta-link--wa" data-cta href="${waHref}" target="_blank" rel="noopener">
          <span class="kbd-cta-link-ico" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.888-.788-1.489-1.761-1.663-2.06-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          </span>
          <span class="kbd-cta-link-txt">
            <span class="kbd-cta-link-title">WhatsApp directo</span>
            <span class="kbd-cta-link-sub">Respuesta del equipo comercial</span>
          </span>
        </a>` : `
        <div class="kbd-cta-hint">Configura el WhatsApp de la plataforma en Admin → Contacto.</div>`}
      <a class="kbd-cta-link kbd-cta-link--web" data-cta href="${_esc(webHref)}" target="_blank" rel="noopener">
        <span class="kbd-cta-link-ico" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
        </span>
        <span class="kbd-cta-link-txt">
          <span class="kbd-cta-link-title">${_esc((webHref || '').replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</span>
          <span class="kbd-cta-link-sub">Sitio oficial · portafolio 360°</span>
        </span>
      </a>
    `;
  }

  function _loteLines() {
    return (window.allDrawnLines || []).filter(l => l && l.hasSmartPin);
  }

  function _poiPins() {
    const pins = (window.FerrariGeo && window.FerrariGeo.pins) || [];
    return pins
      .filter(p => p.tipo === 'poi' || (p.lat != null && p.lng != null))
      .filter(p => p.tipo === 'poi' || p.tipo === 'ruta' || p.tipo === 'horizonte')
      .slice()
      .sort((a, b) => (a._distM || 1e12) - (b._distM || 1e12));
  }

  function _poiOnly() {
    return _poiPins().filter(p => p.tipo === 'poi');
  }

  function _searchNearby(opts) {
    const o = _origin();
    if (!o) {
      if (!(opts && opts.silent)) {
        window.FerrariUI && window.FerrariUI.showToast('Define primero el origen del dron.', 'error');
      }
      return;
    }
    const group = POI_GROUPS.find(g => g.id === _poiFilter);
    const cats = group && group.cats ? group.cats : POI_GROUPS.flatMap(g => g.cats || []).filter((v, i, a) => a.indexOf(v) === i);
    if (window.FerrariGeoTools && window.FerrariGeoTools.fetchNearby) {
      window.FerrariGeoTools.fetchNearby(_nearbyRadius * 1000, cats, o, opts || {});
    }
  }

  function _focusPin(id) {
    const pin = window.FerrariGeo && window.FerrariGeo.getPin(id);
    if (!pin) return;

    // 1) Mostrar solo este pin en el visor 360°
    _setNearbyOnPhoto(true, id);

    // 2) Girar la cámara suavemente hacia el pin con animación
    const viewer = window.Ferrari && window.Ferrari.viewer;
    if (viewer) {
      try {
        const targetPitch = pin.pitch != null ? Math.max(-20, Math.min(12, pin.pitch)) : 0;
        if (typeof viewer.lookAt === 'function') {
          // lookAt(pitch, yaw, hfov, transitionDuration)
          viewer.lookAt(targetPitch, pin.yaw, 75, 1000);
        } else if (typeof viewer.setYaw === 'function') {
          viewer.setYaw(pin.yaw);
          if (typeof viewer.setPitch === 'function') {
            viewer.setPitch(targetPitch);
          }
        }
      } catch (e) {}
    }

    const pinTitle = pin.titulo || pin.nombre || 'Punto de Interés';

    // 3) Abrir mapa flotante con la ruta al pin (si tiene coordenadas)
    if (pin.lat != null && pin.lng != null) {
      if (window.FerrariUI && typeof window.FerrariUI.openMapWidget === 'function') {
        window.FerrariUI.openMapWidget(pin.lat, pin.lng, pinTitle);
      }
    }

    // 4) Inyectar mensaje de Jarvis en el chatbot narrando la acción
    if (pin.titulo || pin.nombre) {
      const useRoute = !!(pin._routeDistM && (pin._routeSec || pin._routeDurationS));
      const distKm = useRoute
        ? (pin._routeDistM / 1000).toFixed(1) + ' km'
        : (pin._distM ? (pin._distM / 1000).toFixed(1) + ' km aprox.' : '');
      const tiempoMin = useRoute
        ? Math.round((pin._routeSec || pin._routeDurationS) / 60) + ' min'
        : '';
      const infoTexto = (distKm && tiempoMin)
        ? `a ${distKm} por ruta — ${tiempoMin} en vehículo`
        : distKm
          ? (pin.tipo === 'horizonte' ? `a ${distKm} (aprox. línea recta)` : `a ${distKm} del proyecto`)
          : '';

      const jarvisMsg = `He girado la cámara 360° hacia ${pinTitle}${infoTexto ? ', ' + infoTexto : ''}. El mapa interactivo muestra la ruta de acceso con las opciones de navegación para Google Maps y Waze, señor.`;

      if (window.FerrariUI && typeof window.FerrariUI.injectBotMessage === 'function') {
        window.FerrariUI.injectBotMessage(jarvisMsg);
      }
    }
  }

  function _estadoLabel(st) {
    return ({
      disponible: 'Disponible',
      vendido: 'Vendido',
      reservado: 'Reservado',
      nodisponible: 'No disponible'
    })[st] || st;
  }

  function _renderOriginBar() {
    const box = _root.querySelector('#kbd-origin');
    if (!box) return;
    const o = _origin();
    if (!o) {
      box.innerHTML = `<div class="kbd-origin-empty">Sin origen dron · las rutas se activan al calibrar GPS</div>`;
      return;
    }
    const links = _originLinks();
    const label = o.label || 'Origen del dron';
    box.innerHTML = `
      <div class="kbd-origin-main">
        <div class="kbd-origin-dot" aria-hidden="true"></div>
        <div class="kbd-origin-text">
          <div class="kbd-origin-title">${_esc(label)}</div>
          <div class="kbd-origin-coords">${o.lat.toFixed(6)}, ${o.lng.toFixed(6)}</div>
        </div>
      </div>
      <div class="kbd-origin-actions">
        <a class="kbd-nav-btn" data-nav href="${links.maps}" target="_blank" rel="noopener" title="Google Maps">
          <img src="${ICON_MAPS}" alt="" width="14" height="14">
        </a>
        <a class="kbd-nav-btn" data-nav href="${links.waze}" target="_blank" rel="noopener" title="Waze">
          <img src="${ICON_WAZE}" alt="" width="14" height="14">
        </a>
      </div>
    `;
  }

  function _renderMap(embedUrl) {
    const lists = _root.querySelector('#kbd-body-lists');
    const mapBody = _root.querySelector('#kbd-body-map');
    const frame = _root.querySelector('#kbd-map-frame');
    const empty = _root.querySelector('#kbd-map-empty');
    const actions = _root.querySelector('#kbd-map-actions');
    if (lists) lists.hidden = true;
    if (mapBody) mapBody.hidden = false;

    const o = _origin();
    const links = _originLinks();
    if (!o || !links) {
      if (frame) { frame.hidden = true; frame.removeAttribute('src'); }
      if (empty) empty.hidden = false;
      if (actions) actions.innerHTML = '';
      _mapLoadedFor = null;
      return;
    }

    // Si se pasa una URL de embed personalizada (POI search), usarla; si no, satélite de origen
    const targetUrl = embedUrl || links.embed;
    const cacheKey = targetUrl;

    if (empty) empty.hidden = true;
    if (frame) {
      if (_mapLoadedFor !== cacheKey) {
        frame.src = targetUrl;
        _mapLoadedFor = cacheKey;
      }
      frame.hidden = false;
    }

    if (actions) {
      actions.innerHTML = `
        <button type="button" class="kbd-map-btn" data-act="satellite">
          <img src="${ICON_MAPS}" alt="" width="14" height="14">
          <span>Satélite</span>
        </button>
        <button type="button" class="kbd-map-btn" data-act="waze">
          <img src="${ICON_WAZE}" alt="" width="14" height="14">
          <span>Waze</span>
        </button>
        <button type="button" class="kbd-map-btn" data-act="search-poi">
          <span>🔍 Buscar en Maps</span>
        </button>
        <button type="button" class="kbd-map-btn kbd-map-btn--ghost" data-act="copy">
          <span>Copiar coords</span>
        </button>
      `;
    }
  }

  function _navBtns(lat, lng) {
    const links = _destLinks(lat, lng);
    if (!links) return '';
    return `
      <span class="kbd-item-nav">
        <a class="kbd-nav-btn" data-nav href="${links.google}" target="_blank" rel="noopener" title="Ruta Google Maps desde el origen">
          <img src="${ICON_MAPS}" alt="" width="13" height="13">
        </a>
        <a class="kbd-nav-btn" data-nav href="${links.waze}" target="_blank" rel="noopener" title="Navegar con Waze">
          <img src="${ICON_WAZE}" alt="" width="13" height="13">
        </a>
      </span>
    `;
  }

  function render() {
    const root = _ensure();
    if (_isToolMode()) {
      root.classList.remove('is-visible');
      // En modo herramienta: mostrar todos los pins geo
      if (window.FerrariGeoPins && window.FerrariGeoPins.setBuyerNearbyFilter) {
        window.FerrariGeoPins.setBuyerNearbyFilter({ enabled: false });
      }
      return;
    }
    root.classList.add('is-visible');
    root.classList.toggle('is-expanded', _expanded);
    _syncToggleChrome();
    try {
      if (window.FerrariHUD && typeof window.FerrariHUD.syncPlacement === 'function') {
        window.FerrariHUD.syncPlacement();
      }
    } catch (e) {}

    // Filtro comprador: cercanos solo si el dock pidió spotlight
    if (window.FerrariGeoPins && window.FerrariGeoPins.setBuyerNearbyFilter) {
      window.FerrariGeoPins.setBuyerNearbyFilter({
        enabled: true,
        show: _nearbyOnPhoto && _expanded,
        spotlightId: _spotlightNearbyId
      });
    }

    if (!_expanded) {
      const panel = root.querySelector('#kbd-panel');
      if (panel) panel.hidden = true;
      return;
    }

    _renderOriginBar();

    const lists = root.querySelector('#kbd-body-lists');
    const mapBody = root.querySelector('#kbd-body-map');
    const filters = root.querySelector('#kbd-filters');
    const list = root.querySelector('#kbd-list');
    const foot = root.querySelector('#kbd-foot');
    const searchRow = root.querySelector('#kbd-search-row');
    if (searchRow) searchRow.hidden = true;
    const radiusRow = root.querySelector('#kbd-radius-row');
    if (radiusRow) radiusRow.hidden = true;

    // Asegurar visibilidad correcta de cuerpos
    if (_tab === 'mapa') {
      if (lists) lists.hidden = true;
      if (mapBody) mapBody.hidden = false;
      _renderMap();
      return;
    }

    if (lists) lists.hidden = false;
    if (mapBody) mapBody.hidden = true;

    if (_tab === 'lotes') {
      // Al ver lotes, no forzar pins cercanos en foto
      filters.innerHTML = ESTADOS.map(e => `
        <button type="button" class="kbd-chip ${_loteFilter === e.id ? 'is-on' : ''}" data-id="${e.id}">${e.label}</button>
      `).join('');

      let lotes = _loteLines();
      if (_loteFilter !== 'todos') {
        lotes = lotes.filter(l => (l.estado || 'disponible') === _loteFilter);
      }
      const order = { disponible: 0, reservado: 1, vendido: 2, nodisponible: 3 };
      lotes.sort((a, b) => (order[a.estado || 'disponible'] ?? 9) - (order[b.estado || 'disponible'] ?? 9));

      if (!lotes.length) {
        list.innerHTML = `<div class="kbd-empty">No hay lotes con este filtro.</div>`;
      } else {
        list.innerHTML = lotes.map(l => {
          const st = l.estado || 'disponible';
          const uf = l.valorUF != null ? `${Number(l.valorUF).toLocaleString('es-CL')} UF` : '—';
          const area = l.dimensiones ? `${l.dimensiones} m²` : '—';
          return `
            <button type="button" class="kbd-item" data-lote-id="${l.id}" role="listitem">
              <span class="kbd-dot kbd-dot--${st}"></span>
              <span class="kbd-item-main">
                <span class="kbd-item-title">${_esc(l.titulo || 'Lote')}</span>
                <span class="kbd-item-sub">${_esc(_estadoLabel(st))} · ${area} · ${uf}</span>
              </span>
              <span class="kbd-chevron">›</span>
            </button>
          `;
        }).join('');
      }
      const total = _loteLines().length;
      const disp = _loteLines().filter(l => (l.estado || 'disponible') === 'disponible').length;
      foot.textContent = `${disp} disponibles · ${total} en total`;
    } else {
      // Cercanos: lista en el dock; pin en foto solo al tocar uno
      filters.innerHTML = POI_GROUPS.map(g => `
        <button type="button" class="kbd-chip ${_poiFilter === g.id ? 'is-on' : ''}" data-id="${g.id}">${g.label}</button>
      `).join('');
      if (searchRow) searchRow.hidden = false;
      // Radio de búsqueda configurable 1–30 km
      const radiusSlider = _root.querySelector('#kbd-radius-slider');
      const radiusVal = _root.querySelector('#kbd-radius-value');
      if (radiusRow) { radiusRow.hidden = false; }
      if (radiusSlider) { radiusSlider.value = _nearbyRadius; }
      if (radiusVal) { radiusVal.textContent = _nearbyRadius + ' km'; }

      let pins = _poiOnly();
      const group = POI_GROUPS.find(g => g.id === _poiFilter);
      if (group && group.cats) {
        pins = pins.filter(p => group.cats.indexOf(p.categoria) !== -1);
      }

      const o = _origin();
      if (!pins.length) {
        list.innerHTML = `<div class="kbd-empty">${o ? 'Aún no hay lugares cercanos publicados.' : 'Calibra el origen del dron para distancias y rutas.'}</div>`;
      } else {
        list.innerHTML = pins.map(p => {
          const meta = window.FerrariGeo.categoryMeta('poi', p.categoria);
          let dist = window.FerrariGeo.formatPinDistanceEta
            ? window.FerrariGeo.formatPinDistanceEta(p)
            : null;
          if (!dist || dist === '—') {
            dist = p.lat != null ? 'Sin origen dron' : meta.label;
          }
          const nav = (p.lat != null && p.lng != null) ? _navBtns(p.lat, p.lng) : '';
          const on = _spotlightNearbyId === p.id;
          return `
            <div class="kbd-item kbd-item--row ${on ? 'is-on' : ''}" data-pin-id="${p.id}" role="listitem">
              <button type="button" class="kbd-item-hit">
                <span class="kbd-emoji">${meta.emoji || '📍'}</span>
                <span class="kbd-item-main">
                  <span class="kbd-item-title">${_esc(p.titulo || meta.label)}</span>
                  <span class="kbd-item-sub">${_esc(dist)}</span>
                </span>
              </button>
              ${nav}
            </div>
          `;
        }).join('');

        list.querySelectorAll('.kbd-item-hit').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wrap = btn.closest('[data-pin-id]');
            if (wrap) {
              _focusPin(wrap.dataset.pinId);
              render();
            }
          });
        });
      }
      // Pie del tab con conteo y botón "Ver en mapa"
      const hasOrigin = !!o;
      const mapBtnHtml = hasOrigin
        ? `<button type="button" class="kbd-map-inline-btn" data-action="view-poi-map">🗺️ Ver en mapa</button>`
        : '';
      foot.innerHTML = `<span>${o ? `${pins.length} lugar${pins.length !== 1 ? 'es' : ''} · toca uno para verlo en el 360°` : `${pins.length} lugar${pins.length !== 1 ? 'es' : ''}`}</span>${mapBtnHtml}`;

      // Listener del botón mapa inline
      const mapBtn = foot.querySelector('[data-action="view-poi-map"]');
      if (mapBtn) {
        mapBtn.addEventListener('click', () => {
          _tab = 'mapa';
          // Forzar reload del mapa al cambiar filtro
          _mapLoadedFor = null;
          const poiUrl = _buildPoiMapUrl();
          const tabBtn = _root.querySelector('.kbd-tab[data-tab="mapa"]');
          if (tabBtn) _root.querySelectorAll('.kbd-tab').forEach(t => t.classList.toggle('is-on', t === tabBtn));
          _renderMap(poiUrl);
        });
      }
    }
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function refresh() {
    if (!_root && document.body) _ensure();
    render();
  }

  function bind() {
    if (_bound) return;
    _bound = true;
    _ensure();
    setExpanded(false);
    setCtaOpen(false);
    _renderCta();
    render();
    
    // Auto-gatillar búsqueda de lugares cercanos al iniciar si el origen ya existe
    // silent: evita toast rojo 504/404 si Overpass está caído al cargar la demo
    if (!_nearbySearched && _origin()) {
      _nearbySearched = true;
      setTimeout(() => _searchNearby({ silent: true }), 1000);
    }

    setInterval(() => {
      if (_root && _root.classList.contains('is-visible') && _expanded) render();
      else if (!_isToolMode()) render();
      if (_root && !_isToolMode()) _renderCta();
    }, 3000);
    document.addEventListener('ferrari:panel-toggle', render);
    document.addEventListener('ferrari:geo-changed', () => {
      _mapLoadedFor = null;
      if (!_nearbySearched && _origin()) {
        _nearbySearched = true;
        setTimeout(() => _searchNearby({ silent: true }), 500);
      }
      render();
    });
    document.addEventListener('ferrari:lotes-changed', render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }

  function setTab(tabName) {
    if (['lotes', 'lugares', 'mapa'].indexOf(tabName) === -1) return;
    _tab = tabName;
    const root = _ensure();
    const tabBtn = root.querySelector(`.kbd-tab[data-tab="${tabName}"]`);
    if (tabBtn) {
      root.querySelectorAll('.kbd-tab').forEach(t => t.classList.toggle('is-on', t === tabBtn));
    }
    // Al abrir la pestaña Cercanos: auto-disparar búsqueda OSM si aún no se ha hecho
    if (tabName === 'lugares' && !_nearbySearched && _origin()) {
      _nearbySearched = true;
      _searchNearby({ silent: true });
    }
    render();
  }

  function setRadius(km) {
    const radius = Math.max(1, Math.min(30, Number(km) || 10));
    _nearbyRadius = radius;
    const root = _ensure();
    const radiusVal = root.querySelector('#kbd-radius-value');
    if (radiusVal) {
      radiusVal.textContent = _nearbyRadius + ' km';
    }
    const input = root.querySelector('#kbd-radius-input');
    if (input) {
      input.value = _nearbyRadius;
    }
    render();
  }

  function getNearbyPlaces() {
    const pins = (window.FerrariGeo && window.FerrariGeo.pins) || [];
    return pins.filter(p => p.tipo === 'poi' || p.tipo === 'ruta').map(p => ({
      nombre: p.nombre || 'Lugar sin nombre',
      categoria: p.categoria || 'Servicio',
      distanciaM: p._distM || 0,
      rutaM: p._routeDistM || 0,
      tiempoRutaSeg: p._routeDurationS || 0,
      lat: p.lat,
      lng: p.lng
    }));
  }

  function setFilter(filterId) {
    if (POI_GROUPS.some(g => g.id === filterId)) {
      _poiFilter = filterId;
      render();
    }
  }

  function searchNearby() {
    _searchNearby();
  }

  window.FerrariBuyerDock = { refresh, render, setExpanded, setCtaOpen, setTab, setRadius, setFilter, getNearbyPlaces, searchNearby };

  console.log('[Ferrari/BuyerDock] ✓ Módulo cargado (colapsable + 360° CTA)');

})();
