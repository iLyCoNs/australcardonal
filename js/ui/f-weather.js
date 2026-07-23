/**
 * f-weather.js — Widget meteorológico premium para KPrano Killer 360
 * API: Open-Meteo · Reloj local en vivo · Glass armónico móvil/desktop
 */
'use strict';

(function () {

  const WMO_CODES = {
    0:  { label: 'Despejado',      icon: '☀️' },
    1:  { label: 'Mayormente despejado', icon: '🌤️' },
    2:  { label: 'Parcialmente nublado', icon: '⛅' },
    3:  { label: 'Nublado',        icon: '☁️' },
    45: { label: 'Niebla',         icon: '🌫️' },
    48: { label: 'Niebla helada',  icon: '🌫️' },
    51: { label: 'Llovizna leve',  icon: '🌦️' },
    53: { label: 'Llovizna',       icon: '🌦️' },
    55: { label: 'Llovizna intensa', icon: '🌧️' },
    61: { label: 'Lluvia leve',    icon: '🌧️' },
    63: { label: 'Lluvia',         icon: '🌧️' },
    65: { label: 'Lluvia intensa', icon: '🌧️' },
    71: { label: 'Nieve leve',     icon: '🌨️' },
    73: { label: 'Nieve',          icon: '❄️' },
    75: { label: 'Nieve intensa',  icon: '❄️' },
    80: { label: 'Chubascos',      icon: '🌦️' },
    81: { label: 'Chubascos',      icon: '🌧️' },
    82: { label: 'Chubascos fuertes', icon: '⛈️' },
    85: { label: 'Nieve moderada', icon: '🌨️' },
    86: { label: 'Nieve intensa',  icon: '❄️' },
    95: { label: 'Tormenta',       icon: '⛈️' },
    96: { label: 'Tormenta con granizo', icon: '⛈️' },
    99: { label: 'Tormenta fuerte', icon: '🌩️' }
  };

  const WIND_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

  function windDir(deg) {
    return WIND_DIRS[Math.round(deg / 45) % 8];
  }

  let _widget = null;
  let _refreshTimer = null;
  let _clockTimer = null;
  let _collapsed = true; // al cargar: minimizado; el cliente lo abre
  let _tz = 'America/Santiago';
  let _lastLat = null;
  let _lastLng = null;

  const ICON_EXPAND =
    `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 2v6M2 5h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const ICON_COLLAPSE =
    `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

  function createWidget() {
    const el = document.createElement('div');
    el.id = 'kpk-weather-widget';
    el.className = 'kpk-weather kpk-weather--collapsed';
    el.setAttribute('role', 'complementary');
    el.setAttribute('aria-label', 'Widget del clima');
    el.innerHTML = `
      <button class="kpk-weather__collapse" id="kpk-weather-toggle" title="Expandir clima" type="button" aria-expanded="false" aria-label="Expandir clima">
        ${ICON_EXPAND}
      </button>
      <div class="kpk-weather__handle" id="kpk-weather-handle" title="Arrastrar" hidden>
        <span class="kpk-weather__drag-label">CLIMA DEL LUGAR</span>
      </div>
      <div class="kpk-weather__body" id="kpk-weather-body" style="display:none">
        <div class="kpk-weather__main">
          <div class="kpk-weather__icon" id="kpk-w-icon">—</div>
          <div class="kpk-weather__temp-wrap">
            <div class="kpk-weather__temp" id="kpk-w-temp">—</div>
            <div class="kpk-weather__label" id="kpk-w-label">Cargando…</div>
          </div>
        </div>
        <div class="kpk-weather__clock" id="kpk-w-clock" aria-live="off">--:--:--</div>
        <div class="kpk-weather__details" id="kpk-w-details"></div>
        <div class="kpk-weather__footer" id="kpk-w-footer"></div>
      </div>
    `;
    document.body.appendChild(el);
    _widget = el;

    if (window.FerrariDrag) {
      window.FerrariDrag.attach(el, { handle: '#kpk-weather-handle' });
    }

    el.querySelector('#kpk-weather-toggle').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleCollapse();
    });
    startClock();
    return el;
  }

  function applyCollapseUi() {
    if (!_widget) return;
    const body = _widget.querySelector('#kpk-weather-body');
    const btn  = _widget.querySelector('#kpk-weather-toggle');
    const handle = _widget.querySelector('#kpk-weather-handle');
    if (body) body.style.display = _collapsed ? 'none' : '';
    if (handle) handle.hidden = !!_collapsed;
    _widget.classList.toggle('kpk-weather--collapsed', _collapsed);
    if (btn) {
      btn.innerHTML = _collapsed ? ICON_EXPAND : ICON_COLLAPSE;
      btn.title = _collapsed ? 'Expandir clima' : 'Minimizar';
      btn.setAttribute('aria-label', _collapsed ? 'Expandir clima' : 'Minimizar clima');
      btn.setAttribute('aria-expanded', _collapsed ? 'false' : 'true');
    }
  }

  function toggleCollapse() {
    _collapsed = !_collapsed;
    applyCollapseUi();
  }

  function expand() {
    if (!_widget) createWidget();
    _collapsed = false;
    applyCollapseUi();
  }

  function collapse() {
    if (!_widget) return;
    _collapsed = true;
    applyCollapseUi();
  }

  function isCollapsed() {
    return !!_collapsed;
  }

  function formatLiveClock() {
    try {
      return new Date().toLocaleTimeString('es-CL', {
        timeZone: _tz || 'America/Santiago',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch (e) {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }
  }

  function tickClock() {
    if (!_widget) return;
    const clock = _widget.querySelector('#kpk-w-clock');
    if (clock) clock.textContent = formatLiveClock();
  }

  function startClock() {
    if (_clockTimer) clearInterval(_clockTimer);
    tickClock();
    _clockTimer = setInterval(tickClock, 1000);
  }

  async function fetchWeather() {
    const origin = window.FerrariGeo && window.FerrariGeo.droneOrigin;
    if (!origin || origin.lat == null || origin.lng == null) {
      setError('Sin coordenadas de origen.');
      return;
    }

    const { lat, lng } = origin;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation` +
      `&wind_speed_unit=kmh&timezone=auto&forecast_days=1`;

    try {
      setLoading();
      const res  = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderWeather(data, lat, lng);
    } catch (err) {
      console.warn('[KPK/Weather]', err);
      setError('No se pudo obtener el clima.');
    }
  }

  function setLoading() {
    const icon = _widget.querySelector('#kpk-w-icon');
    const temp = _widget.querySelector('#kpk-w-temp');
    const lbl  = _widget.querySelector('#kpk-w-label');
    if (icon) icon.textContent = '⟳';
    if (temp) temp.textContent = '—';
    if (lbl)  lbl.textContent  = 'Actualizando…';
  }

  function setError(msg) {
    const lbl = _widget.querySelector('#kpk-w-label');
    const det = _widget.querySelector('#kpk-w-details');
    if (lbl) lbl.textContent = msg;
    if (det) det.innerHTML = '';
  }

  function renderWeather(data, lat, lng) {
    const c    = data.current;
    const wmo  = WMO_CODES[c.weather_code] || { label: 'Desconocido', icon: '❓' };
    const temp = Math.round(c.temperature_2m);
    const feel = Math.round(c.apparent_temperature);
    const wind = Math.round(c.wind_speed_10m);
    const dir  = windDir(c.wind_direction_10m);
    const hum  = c.relative_humidity_2m;
    const prec = c.precipitation;

    if (data.timezone) _tz = data.timezone;
    _lastLat = lat;
    _lastLng = lng;

    _widget.querySelector('#kpk-w-icon').textContent = wmo.icon;
    _widget.querySelector('#kpk-w-temp').textContent = `${temp}°`;
    _widget.querySelector('#kpk-w-label').textContent = wmo.label;
    _widget.querySelector('#kpk-w-details').innerHTML =
      '<span class="kpk-weather__chip" title="Sensación térmica"><em>ST</em> ' + feel + '°</span>' +
      '<span class="kpk-weather__chip" title="Humedad"><em>Hum</em> ' + hum + '%</span>' +
      '<span class="kpk-weather__chip" title="Viento"><em>' + dir + '</em> ' + wind + ' km/h</span>' +
      (prec > 0
        ? '<span class="kpk-weather__chip" title="Precipitación"><em>Lluvia</em> ' + prec.toFixed(1) + ' mm</span>'
        : '');
    _widget.querySelector('#kpk-w-footer').textContent =
      lat.toFixed(3) + ', ' + lng.toFixed(3);
    tickClock();
  }

  function init() {
    createWidget();

    let attempts = 0;
    const tryFetch = () => {
      const origin = window.FerrariGeo && window.FerrariGeo.droneOrigin;
      if (origin && origin.lat != null) {
        fetchWeather();
      } else if (attempts++ < 20) {
        setTimeout(tryFetch, 500);
      } else {
        setError('Configura el origen del dron para ver el clima.');
      }
    };
    tryFetch();

    _refreshTimer = setInterval(fetchWeather, 15 * 60 * 1000);
    document.addEventListener('ferrari:geo-changed', fetchWeather);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.FerrariWeather = {
    refresh: fetchWeather,
    expand,
    collapse,
    toggle: toggleCollapse,
    isCollapsed
  };

})();
