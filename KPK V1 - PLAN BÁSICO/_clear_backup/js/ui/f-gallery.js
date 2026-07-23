/**
 * f-gallery.js — Galería premium estilo macOS para Smart Pins
 *
 * API:
 *   FerrariGallery.open({ title, fotos: [{src,name?}], startIndex? })
 *   FerrariGallery.close()
 */

'use strict';

(function () {

  let _root = null;
  let _fotos = [];
  let _index = 0;
  let _title = '';
  let _bound = false;

  function _ensureDOM() {
    if (_root) return;

    _root = document.createElement('div');
    _root.id = 'f-gallery';
    _root.setAttribute('aria-hidden', 'true');
    _root.innerHTML = `
      <div class="fg-backdrop" data-fg-close></div>
      <div class="fg-window" role="dialog" aria-modal="true" aria-label="Galería de fotos">
        <div class="fg-chrome">
          <div class="fg-traffic" aria-hidden="true">
            <span class="fg-dot fg-dot--close" data-fg-close></span>
            <span class="fg-dot fg-dot--min"></span>
            <span class="fg-dot fg-dot--max"></span>
          </div>
          <div class="fg-chrome-title" id="fg-title">Galería</div>
          <div class="fg-chrome-meta">
            <span class="fg-counter" id="fg-counter">1 / 1</span>
            <button type="button" class="fg-icon-btn" data-fg-close aria-label="Cerrar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <div class="fg-stage">
          <button type="button" class="fg-nav fg-nav--prev" id="fg-prev" aria-label="Anterior">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>

          <div class="fg-frame">
            <img id="fg-img" class="fg-img" alt="" draggable="false">
            <div class="fg-empty" id="fg-empty">
              <div class="fg-empty-ico">📷</div>
              <p>Este lote aún no tiene fotos.</p>
            </div>
            <div class="fg-loader" id="fg-loader"></div>
          </div>

          <button type="button" class="fg-nav fg-nav--next" id="fg-next" aria-label="Siguiente">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

        <div class="fg-caption" id="fg-caption"></div>

        <div class="fg-strip-wrap">
          <div class="fg-strip" id="fg-strip" role="listbox" aria-label="Miniaturas"></div>
        </div>
      </div>
    `;
    document.body.appendChild(_root);

    _root.querySelectorAll('[data-fg-close]').forEach(el => {
      el.addEventListener('click', close);
    });
    document.getElementById('fg-prev').addEventListener('click', () => go(-1));
    document.getElementById('fg-next').addEventListener('click', () => go(1));

    // Swipe táctil
    const frame = _root.querySelector('.fg-frame');
    let sx = 0, sy = 0;
    frame.addEventListener('touchstart', e => {
      if (!e.touches[0]) return;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    }, { passive: true });
    frame.addEventListener('touchend', e => {
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy)) {
        go(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
  }

  function _bindKeys() {
    if (_bound) return;
    _bound = true;
    document.addEventListener('keydown', _onKey);
  }

  function _unbindKeys() {
    if (!_bound) return;
    _bound = false;
    document.removeEventListener('keydown', _onKey);
  }

  function _onKey(e) {
    if (!_root || !_root.classList.contains('fg-open')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  }

  function _renderStrip() {
    const strip = document.getElementById('fg-strip');
    strip.innerHTML = '';
    _fotos.forEach((f, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fg-thumb' + (i === _index ? ' is-active' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', i === _index ? 'true' : 'false');
      btn.innerHTML = `<img src="${f.src}" alt="">`;
      btn.addEventListener('click', () => show(i));
      strip.appendChild(btn);
    });

    const active = strip.querySelector('.is-active');
    if (active) {
      active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  function show(i) {
    if (!_fotos.length) {
      document.getElementById('fg-img').style.opacity = '0';
      document.getElementById('fg-empty').style.display = 'flex';
      document.getElementById('fg-counter').textContent = '0 / 0';
      document.getElementById('fg-caption').textContent = '';
      document.getElementById('fg-prev').disabled = true;
      document.getElementById('fg-next').disabled = true;
      document.getElementById('fg-strip').innerHTML = '';
      return;
    }

    _index = ((i % _fotos.length) + _fotos.length) % _fotos.length;
    const foto = _fotos[_index];
    const img = document.getElementById('fg-img');
    const loader = document.getElementById('fg-loader');
    const empty = document.getElementById('fg-empty');

    empty.style.display = 'none';
    loader.classList.add('is-on');
    img.classList.remove('is-in');

    const next = new Image();
    next.onload = () => {
      img.src = foto.src;
      img.alt = foto.name || (`Foto ${_index + 1}`);
      requestAnimationFrame(() => {
        img.classList.add('is-in');
        loader.classList.remove('is-on');
      });
    };
    next.onerror = () => {
      loader.classList.remove('is-on');
      img.classList.add('is-in');
    };
    next.src = foto.src;

    document.getElementById('fg-counter').textContent = `${_index + 1} / ${_fotos.length}`;
    document.getElementById('fg-caption').textContent = foto.name || '';
    document.getElementById('fg-prev').disabled = _fotos.length < 2;
    document.getElementById('fg-next').disabled = _fotos.length < 2;
    _renderStrip();
  }

  function go(dir) {
    if (_fotos.length < 2) return;
    show(_index + dir);
  }

  function open(opts) {
    _ensureDOM();
    const o = opts || {};
    _title = o.title || 'Galería';
    _fotos = Array.isArray(o.fotos) ? o.fotos.filter(f => f && f.src) : [];
    _index = Math.max(0, Math.min(o.startIndex || 0, Math.max(0, _fotos.length - 1)));

    document.getElementById('fg-title').textContent = _title;
    _root.classList.add('fg-open');
    _root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('fg-lock');
    _bindKeys();
    show(_index);
  }

  function close() {
    if (!_root) return;
    _root.classList.remove('fg-open');
    _root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('fg-lock');
    _unbindKeys();
  }

  window.FerrariGallery = { open, close, go, show };

  console.log('[Ferrari/Gallery] ✓ Módulo inicializado');

})();
