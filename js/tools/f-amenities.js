/**
 * f-amenities.js — Tool Amenities Los Lagos: dock catálogo + colocar en 360
 */
'use strict';

(function () {
  var _active = false;
  var _bound = false;
  var _selectedId = 'laguna';
  var _presentation = false;
  var _groupFilter = 'all';
  var _dock = null;
  var _legend = null;

  function _catalog() {
    return window.FerrariAmenitiesCatalog;
  }

  function activate() {
    window.FerrariTools.deactivateAllTools();
    _active = true;
    window.currentTool = 'geo-amenidad';
    document.getElementById('panorama-container').classList.add('geo-tool-active', 'amenity-tool-active');
    _ensureDock();
    _showDock(true);
    _renderGrid();
    window.FerrariHUD && window.FerrariHUD.showDraw('geo-amenidad');
    window.FerrariUI && window.FerrariUI.showToast(
      'Amenities: elige un icono y haz clic en el panorama para desplegarlo.',
      'info'
    );
  }

  function deactivate() {
    if (!_active) {
      _showDock(false);
      return;
    }
    _active = false;
    var host = document.getElementById('panorama-container');
    if (host) host.classList.remove('geo-tool-active', 'amenity-tool-active');
    _showDock(false);
    window.FerrariHUD && window.FerrariHUD.hideDraw();
  }

  function isActive() { return _active; }

  function bindEvents() {
    if (_bound) return;
    _bound = true;
    var container = document.getElementById('pannellum-viewer');
    if (!container) return;
    container.addEventListener('click', _onClick, false);
    document.addEventListener('keydown', function (e) {
      if (!_active) return;
      if (e.key === 'Escape') {
        if (window.FerrariTools) window.FerrariTools.deactivateAllTools();
      }
    }, false);
  }

  function _getCoords(e) {
    var viewer = window.Ferrari && window.Ferrari.viewer;
    if (!viewer) return null;
    try { return viewer.mouseEventToCoords(e); } catch (err) { return null; }
  }

  function _hitUi(e) {
    if (e.target && e.target.closest && (
      e.target.closest('.f-geo-pin') ||
      e.target.closest('#kpk-amenity-dock') ||
      e.target.closest('#kpk-amenity-legend') ||
      e.target.closest('#kpk-panel') ||
      e.target.closest('#f-geo-editor')
    )) return true;
    try {
      var stack = document.elementsFromPoint
        ? document.elementsFromPoint(e.clientX, e.clientY)
        : [];
      return stack.some(function (n) {
        return n && n.closest && (n.closest('.f-geo-pin') || n.closest('#kpk-amenity-dock'));
      });
    } catch (err) {
      return false;
    }
  }

  function _onClick(e) {
    if (!_active) return;
    if (e.button !== 0) return;
    if (window.FerrariGeoPins) {
      if (typeof window.FerrariGeoPins.isDragging === 'function' && window.FerrariGeoPins.isDragging()) return;
      if (typeof window.FerrariGeoPins.consumeInteractGuard === 'function' && window.FerrariGeoPins.consumeInteractGuard()) return;
    }
    if (_hitUi(e)) return;

    var coords = _getCoords(e);
    if (!coords) return;
    var pitch = coords[0];
    var yaw = coords[1];
    var cat = _catalog();
    var meta = cat ? cat.get(_selectedId) : { label: 'Amenidad' };
    var grupo = meta.group || 'equipamiento';

    var id = window.FerrariGeo.addPin({
      tipo: 'amenidad',
      categoria: _selectedId,
      icon: _selectedId,
      grupo: grupo,
      titulo: meta.label || 'Amenidad',
      pitch: pitch,
      yaw: yaw,
      scale: 1,
      autoYaw: false,
      lockYaw: true
    });

    if (window.FerrariGeoPins && window.FerrariGeoPins.rebuild) {
      window.FerrariGeoPins.rebuild();
    }
    _refreshLegend();
    window.FerrariUI && window.FerrariUI.showToast((meta.label || 'Amenidad') + ' colocada.', 'success');
    return id;
  }

  function _ensureDock() {
    if (_dock) return _dock;
    _dock = document.createElement('div');
    _dock.id = 'kpk-amenity-dock';
    _dock.className = 'kpk-amenity-dock';
    _dock.innerHTML =
      '<div class="kad-head">' +
        '<div class="kad-title">Amenities · Los Lagos</div>' +
        '<div class="kad-actions">' +
          '<button type="button" class="kad-btn" data-act="presentation" title="Modo presentación">Presentar</button>' +
          '<button type="button" class="kad-btn kad-btn--ghost" data-act="close" title="Cerrar">✕</button>' +
        '</div>' +
      '</div>' +
      '<input type="search" class="kad-search" id="kad-search" placeholder="Buscar laguna, muelle, bosque…" autocomplete="off">' +
      '<div class="kad-groups" id="kad-groups"></div>' +
      '<div class="kad-grid" id="kad-grid"></div>' +
      '<div class="kad-foot">' +
        '<span class="kad-selected" id="kad-selected">Seleccionado: Laguna</span>' +
        '<span class="kad-hint">Clic en el 360 para desplegar</span>' +
      '</div>';
    document.body.appendChild(_dock);

    _dock.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'close') {
        if (window.FerrariTools) window.FerrariTools.deactivateAllTools();
      } else if (act === 'presentation') {
        setPresentation(!_presentation);
      }
    });

    _dock.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-amenity-id]');
      if (!chip) return;
      _selectedId = chip.getAttribute('data-amenity-id');
      _renderGrid();
      _updateSelectedLabel();
    });

    _dock.addEventListener('click', function (e) {
      var g = e.target.closest('[data-group]');
      if (!g) return;
      _groupFilter = g.getAttribute('data-group');
      _renderGroups();
      _renderGrid();
    });

    var search = _dock.querySelector('#kad-search');
    if (search) {
      search.addEventListener('input', function () {
        _renderGrid(search.value);
      });
    }

    if (window.FerrariDrag && window.FerrariDrag.attach) {
      try { window.FerrariDrag.attach(_dock, { handle: '.kad-head' }); } catch (err) {}
    }

    return _dock;
  }

  function _showDock(show) {
    _ensureDock();
    _dock.classList.toggle('is-open', !!show);
    if (show) {
      _renderGroups();
      _renderGrid();
      _updateSelectedLabel();
    }
  }

  function _renderGroups() {
    var el = document.getElementById('kad-groups');
    var cat = _catalog();
    if (!el || !cat) return;
    var html = '<button type="button" class="kad-group' + (_groupFilter === 'all' ? ' is-on' : '') + '" data-group="all">Todos</button>';
    cat.GROUPS.forEach(function (g) {
      html += '<button type="button" class="kad-group' + (_groupFilter === g.id ? ' is-on' : '') + '" data-group="' + g.id + '">' + g.label + '</button>';
    });
    el.innerHTML = html;
  }

  function _renderGrid(query) {
    var el = document.getElementById('kad-grid');
    var cat = _catalog();
    if (!el || !cat) return;
    var items = query ? cat.search(query) : cat.all();
    if (_groupFilter !== 'all' && !query) {
      items = items.filter(function (it) { return it.group === _groupFilter; });
    }
    el.innerHTML = items.map(function (it) {
      var on = it.id === _selectedId ? ' is-selected' : '';
      return '<button type="button" class="kad-item' + on + '" data-amenity-id="' + it.id + '" title="' + it.label + '">' +
        '<span class="kad-ico">' + it.svg + '</span>' +
        '<span class="kad-lab">' + it.label + '</span>' +
        '</button>';
    }).join('');
  }

  function _updateSelectedLabel() {
    var el = document.getElementById('kad-selected');
    var cat = _catalog();
    if (!el || !cat) return;
    var meta = cat.get(_selectedId);
    el.textContent = 'Seleccionado: ' + (meta.label || _selectedId);
  }

  function setPresentation(on) {
    _presentation = !!on;
    document.documentElement.classList.toggle('kpk-amenity-present', _presentation);
    var panel = document.getElementById('kpk-panel');
    if (_presentation) {
      if (panel) panel.classList.remove('kpk-panel--open');
      _showDock(false);
      _ensureLegend();
      _legend.classList.add('is-open');
      _refreshLegend();
      window.FerrariUI && window.FerrariUI.showToast('Modo presentación: solo amenities del masterplan.', 'info');
    } else {
      if (_legend) _legend.classList.remove('is-open');
      if (_active) _showDock(true);
    }
  }

  function _ensureLegend() {
    if (_legend) return _legend;
    _legend = document.createElement('div');
    _legend.id = 'kpk-amenity-legend';
    _legend.className = 'kpk-amenity-legend';
    _legend.innerHTML =
      '<div class="kal-head"><span>En el masterplan</span>' +
      '<button type="button" class="kal-close" data-act="exit-present">Salir</button></div>' +
      '<div class="kal-chips" id="kal-chips"></div>';
    document.body.appendChild(_legend);
    _legend.addEventListener('click', function (e) {
      if (e.target.closest('[data-act="exit-present"]')) {
        setPresentation(false);
        return;
      }
      var chip = e.target.closest('[data-spotlight]');
      if (!chip) return;
      var id = chip.getAttribute('data-spotlight');
      if (window.FerrariGeoPins && window.FerrariGeoPins.setAmenitySpotlight) {
        window.FerrariGeoPins.setAmenitySpotlight(id);
      }
      var pin = window.FerrariGeo && window.FerrariGeo.getPin(id);
      if (pin && window.Ferrari && window.Ferrari.viewer && window.Ferrari.viewer.lookAt) {
        window.Ferrari.viewer.lookAt(pin.pitch, pin.yaw, 70, 900);
      }
    });
    return _legend;
  }

  function _refreshLegend() {
    _ensureLegend();
    var box = document.getElementById('kal-chips');
    if (!box || !window.FerrariGeo) return;
    var cat = _catalog();
    var pins = (window.FerrariGeo.pins || []).filter(function (p) { return p.tipo === 'amenidad'; });
    if (!pins.length) {
      box.innerHTML = '<span class="kal-empty">Sin amenities aún</span>';
      return;
    }
    box.innerHTML = pins.map(function (p) {
      var meta = cat ? cat.get(p.icon || p.categoria) : null;
      var svg = meta ? meta.svg : '';
      var label = p.titulo || (meta && meta.label) || 'Amenidad';
      return '<button type="button" class="kal-chip" data-spotlight="' + p.id + '">' +
        '<span class="kal-ico">' + svg + '</span><span>' + label + '</span></button>';
    }).join('');
  }

  window.FerrariAmenities = {
    activate: activate,
    deactivate: deactivate,
    isActive: isActive,
    bindEvents: bindEvents,
    setPresentation: setPresentation,
    refreshLegend: _refreshLegend,
    getSelected: function () { return _selectedId; }
  };

  // Viewer: legend chips available when amenities exist (optional strip)
  document.addEventListener('ferrari:geo-changed', function () {
    if (_presentation) _refreshLegend();
  });
})();
