/**
 * f-amenities-catalog.js — Catálogo pictográfico Región de los Lagos (masterplan)
 * SVG stroke monocromo 24×24; se colorea vía CSS currentColor.
 */
'use strict';

(function () {
  function ico(paths) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }

  var GROUPS = [
    { id: 'agua', label: 'Agua & costa' },
    { id: 'nautica', label: 'Náutica' },
    { id: 'naturaleza', label: 'Naturaleza' },
    { id: 'outdoor', label: 'Outdoor' },
    { id: 'equipamiento', label: 'Equipamiento' },
    { id: 'servicios', label: 'Servicios on-site' }
  ];

  var ITEMS = {
    laguna: {
      label: 'Laguna', group: 'agua',
      svg: ico('<ellipse cx="12" cy="14" rx="8" ry="4"/><path d="M4 14c1.5-3 4-7 8-7s6.5 4 8 7"/><path d="M8 13.5c1 .6 2 .9 4 .9s3-.3 4-.9"/>')
    },
    lago: {
      label: 'Lago', group: 'agua',
      svg: ico('<path d="M3 15c2-1 4-1 6 0s4 1 6 0 4-1 6 0"/><path d="M3 18c2-1 4-1 6 0s4 1 6 0 4-1 6 0"/><path d="M5 12c1.5-4 4.5-7 7-7s5.5 3 7 7"/>')
    },
    estero: {
      label: 'Estero', group: 'agua',
      svg: ico('<path d="M6 4c2 3 2 5 0 8s-2 5 0 8"/><path d="M12 4c2 3 2 5 0 8s-2 5 0 8"/><path d="M18 4c2 3 2 5 0 8s-2 5 0 8"/>')
    },
    cascada: {
      label: 'Cascada', group: 'agua',
      svg: ico('<path d="M4 6h16"/><path d="M7 6c0 4-2 6-2 10"/><path d="M12 6c0 5-2 7-2 12"/><path d="M17 6c0 4-2 7-2 11"/>')
    },
    playa: {
      label: 'Playa', group: 'agua',
      svg: ico('<path d="M4 17c2.5-1.5 5-1.5 8 0s5.5 1.5 8 0"/><circle cx="17" cy="8" r="2.2"/><path d="M8 14l2-4 2 2 3-5"/>')
    },
    muelle: {
      label: 'Muelle', group: 'agua',
      svg: ico('<path d="M4 14h16"/><path d="M6 14v5M10 14v5M14 14v5M18 14v5"/><path d="M5 10h10l2 4"/>')
    },
    embarcadero: {
      label: 'Embarcadero', group: 'agua',
      svg: ico('<path d="M3 16h18"/><path d="M5 16l2-5h10l2 5"/><path d="M8 11V8h2"/><circle cx="16" cy="8" r="1.5"/>')
    },
    boya: {
      label: 'Boya', group: 'agua',
      svg: ico('<circle cx="12" cy="9" r="4"/><path d="M12 13v6"/><path d="M10 19h4"/><path d="M9 9h6"/>')
    },
    embarcacion: {
      label: 'Embarcaciones', group: 'nautica',
      svg: ico('<path d="M3 15l2 3h14l2-3"/><path d="M5 15l3-6h5l4 6"/><path d="M10 9V6h2"/>')
    },
    kayak: {
      label: 'Kayak', group: 'nautica',
      svg: ico('<path d="M3 14c3-2 6-3 9-3s6 1 9 3"/><path d="M7 14l2-4h6l2 4"/><path d="M12 10V7"/>')
    },
    pesca: {
      label: 'Pesca', group: 'nautica',
      svg: ico('<path d="M12 3v11"/><path d="M12 7c3 0 5 2 5 4"/><path d="M8 17c0 2 1.8 4 4 4s4-2 4-4c0-1.5-4-4-4-4s-4 2.5-4 4z"/>')
    },
    club_nautico: {
      label: 'Club náutico', group: 'nautica',
      svg: ico('<path d="M4 18h16"/><path d="M6 18V9l6-4 6 4v9"/><path d="M10 18v-5h4v5"/>')
    },
    bosque: {
      label: 'Bosque', group: 'naturaleza',
      svg: ico('<path d="M12 21v-6"/><path d="M7 15l5-9 5 9H7z"/><path d="M5 19l3.5-6H7l5-8 5 8h-1.5L19 19H5z"/>')
    },
    sendero: {
      label: 'Sendero', group: 'naturaleza',
      svg: ico('<path d="M8 4c2 3 2 5 0 8s-2 5 0 8"/><path d="M16 4c-2 3-2 5 0 8s2 5 0 8"/><circle cx="8" cy="7" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="14" r="1.2" fill="currentColor" stroke="none"/>')
    },
    mirador: {
      label: 'Mirador', group: 'naturaleza',
      svg: ico('<circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>')
    },
    fauna: {
      label: 'Fauna', group: 'naturaleza',
      svg: ico('<circle cx="9" cy="10" r="3"/><circle cx="16" cy="11" r="2.2"/><path d="M6 14c1 3 4 5 6 5s4-1 5-3"/><path d="M7 8l-2-2M11 8l1-2"/>')
    },
    humedal: {
      label: 'Humedal', group: 'naturaleza',
      svg: ico('<path d="M4 17c2-1 4-1 6 0s4 1 6 0 4-1 6 0"/><path d="M7 14c.5-3 2-6 5-8 3 2 4.5 5 5 8"/><path d="M10 14v-3M14 14v-2"/>')
    },
    reserva: {
      label: 'Reserva', group: 'naturaleza',
      svg: ico('<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z"/><path d="M9 12l2 2 4-4"/>')
    },
    caballos: {
      label: 'Caballos', group: 'outdoor',
      svg: ico('<path d="M5 18c1-4 2-7 4-8 1-2 3-3 5-2 2 0 3 2 3 4v6"/><path d="M8 18v2M14 18v2"/><path d="M14 8l3-2 1 3"/>')
    },
    bike: {
      label: 'Bicicleta', group: 'outdoor',
      svg: ico('<circle cx="6.5" cy="16" r="3.5"/><circle cx="17.5" cy="16" r="3.5"/><path d="M6.5 16l4-8h3l3 5"/><path d="M10.5 8h4"/>')
    },
    picnic: {
      label: 'Picnic', group: 'outdoor',
      svg: ico('<path d="M4 14h16v2H4z"/><path d="M6 14l2-6h8l2 6"/><path d="M12 4v4"/>')
    },
    fogon: {
      label: 'Fogón', group: 'outdoor',
      svg: ico('<path d="M12 3c2 3 4 5 4 8a4 4 0 1 1-8 0c0-3 2-5 4-8z"/><path d="M8 20h8"/><path d="M9 17h6"/>')
    },
    camping: {
      label: 'Camping', group: 'outdoor',
      svg: ico('<path d="M4 19h16"/><path d="M12 5l8 14H4L12 5z"/><path d="M12 12v7"/>')
    },
    trekking: {
      label: 'Trekking', group: 'outdoor',
      svg: ico('<circle cx="13" cy="5" r="2"/><path d="M9 21l2-7 2 3 2-5 2 9"/><path d="M7 12l3 2"/>')
    },
    plaza: {
      label: 'Plaza', group: 'equipamiento',
      svg: ico('<path d="M12 21V11"/><path d="M6 11h12l-1.5-5h-9L6 11z"/><path d="M4 21h16"/><path d="M8 11v4M16 11v4"/>')
    },
    clubhouse: {
      label: 'Clubhouse', group: 'equipamiento',
      svg: ico('<path d="M4 20V10l8-5 8 5v10"/><path d="M9 20v-6h6v6"/><path d="M4 10h16"/>')
    },
    cancha: {
      label: 'Cancha', group: 'equipamiento',
      svg: ico('<rect x="3" y="6" width="18" height="12" rx="1"/><path d="M12 6v12"/><circle cx="12" cy="12" r="2.5"/>')
    },
    quincho: {
      label: 'Quincho', group: 'equipamiento',
      svg: ico('<path d="M3 11l9-6 9 6"/><path d="M5 11v8h14v-8"/><path d="M9 19v-5h6v5"/>')
    },
    porteria: {
      label: 'Portería', group: 'equipamiento',
      svg: ico('<path d="M4 20V8h16v12"/><path d="M4 8l4-4h8l4 4"/><circle cx="12" cy="14" r="2"/>')
    },
    estacionamiento_interno: {
      label: 'Estacionamiento', group: 'equipamiento',
      svg: ico('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M9 15V9h3.2a2.2 2.2 0 0 1 0 4.4H9"/>')
    },
    acceso_loteo: {
      label: 'Acceso loteo', group: 'equipamiento',
      svg: ico('<path d="M5 4v16"/><path d="M19 4v16"/><path d="M5 6h6v4H5z"/><path d="M13 14h6v4h-6z"/><path d="M9 12h6"/>')
    },
    agua_potable: {
      label: 'Agua potable', group: 'servicios',
      svg: ico('<path d="M12 3c3 4 6 7 6 11a6 6 0 1 1-12 0c0-4 3-7 6-11z"/><path d="M10 14h4"/>')
    },
    energia: {
      label: 'Energía', group: 'servicios',
      svg: ico('<path d="M13 2L6 13h5l-1 9 8-12h-5l1-8z"/>')
    },
    senal: {
      label: 'Señal / WiFi', group: 'servicios',
      svg: ico('<path d="M5 12a9 9 0 0 1 14 0"/><path d="M8 15a5 5 0 0 1 8 0"/><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/>')
    },
    otro: {
      label: 'Otro', group: 'equipamiento',
      svg: ico('<circle cx="12" cy="12" r="8"/><path d="M12 8v5"/><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"/>')
    }
  };

  function get(id) {
    return ITEMS[id] || ITEMS.otro;
  }

  function listByGroup(groupId) {
    return Object.keys(ITEMS)
      .filter(function (k) { return ITEMS[k].group === groupId; })
      .map(function (k) { return Object.assign({ id: k }, ITEMS[k]); });
  }

  function all() {
    return Object.keys(ITEMS).map(function (k) {
      return Object.assign({ id: k }, ITEMS[k]);
    });
  }

  function search(q) {
    var s = String(q || '').trim().toLowerCase();
    if (!s) return all();
    return all().filter(function (it) {
      return it.id.indexOf(s) >= 0 || (it.label || '').toLowerCase().indexOf(s) >= 0
        || (it.group || '').indexOf(s) >= 0;
    });
  }

  /** CATEGORIES.amenidad compatible con FerrariGeo.categoryMeta */
  function toGeoCategories() {
    var bag = {};
    Object.keys(ITEMS).forEach(function (id) {
      bag[id] = { label: ITEMS[id].label, emoji: '◆', icon: id, group: ITEMS[id].group };
    });
    return bag;
  }

  window.FerrariAmenitiesCatalog = {
    GROUPS: GROUPS,
    ITEMS: ITEMS,
    get: get,
    listByGroup: listByGroup,
    all: all,
    search: search,
    toGeoCategories: toGeoCategories
  };

  if (window.FerrariGeo && window.FerrariGeo.CATEGORIES) {
    window.FerrariGeo.CATEGORIES.amenidad = toGeoCategories();
  }
})();
