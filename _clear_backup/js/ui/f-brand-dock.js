/**
 * f-brand-dock.js — Dock superior de marca
 * Tipografías lujosas + skins minimalistas + modo sólido móvil (sin blur GPU).
 */

'use strict';

(function () {

  const CACHE_KEY = 'ferrari360_brand';
  const CONTACT_DEFAULTS = {
    whatsapp: '',
    formEmail: '',
    formEnabled: true,
    platformCta: 'Consigue tu 360° aquí',
    platformWhatsapp: '',
    platformWeb: 'https://www.australdrone.cl',
    platformLogo: 'https://raw.githubusercontent.com/iLyCoNs/austral-drones/refs/heads/main/logobanner.png',
    platformName: 'Austral Drone'
  };

  const DEFAULTS = {
    version: 2,
    projectName: '',
    logoPath: null,
    logoId: null,
    logos: [],
    font: 'cormorant',
    dockStyle: 'crystal',
    mobileSolid: true,
    hideLoteFill: false,
    loteFillOnHoverOnly: false,
    loteHoverColor: 'neon-green',
    contact: { ...CONTACT_DEFAULTS },
    updatedAt: null
  };

  const FONTS = {
    cormorant:  { family: "'Cormorant Garamond', Georgia, serif", weight: '600', tracking: '0.08em' },
    cinzel:     { family: "'Cinzel', Georgia, serif", weight: '500', tracking: '0.14em' },
    montserrat: { family: "'Montserrat', system-ui, sans-serif", weight: '600', tracking: '0.08em' },
    josefin:    { family: "'Josefin Sans', system-ui, sans-serif", weight: '500', tracking: '0.1em' },
    playfair:   { family: "'Playfair Display', Georgia, serif", weight: '600', tracking: '0.04em' },
    outfit:     { family: "'Outfit', system-ui, sans-serif", weight: '500', tracking: '0.05em' }
  };

  const STYLES = ['crystal', 'obsidian', 'ivory', 'graphite', 'champagne', 'obsidian-gold', 'bordeaux', 'platinum'];

  let _brand = { ...DEFAULTS };
  let _mq = null;

  function _owner() {
    return localStorage.getItem('ferrari_github_owner') || 'iLyCoNs';
  }
  function _repo() {
    return localStorage.getItem('ferrari_github_repo') || 'alercepatagon360';
  }
  function _branch() {
    return localStorage.getItem('ferrari_github_branch') || 'main';
  }
  function _token() {
    return localStorage.getItem('ferrari_github_token');
  }

  function _els() {
    return {
      dock: document.getElementById('kpk-brand-dock'),
      glass: document.querySelector('#kpk-brand-dock .kpk-brand-dock__glass'),
      name: document.getElementById('kpk-brand-name'),
      logo: document.getElementById('kpk-brand-logo'),
      logoWrap: document.getElementById('kpk-brand-logo-wrap'),
      title: document.querySelector('title')
    };
  }

  function _activeLogoPath(brand) {
    if (!brand) return null;
    if (brand.logoDataUrl) return null; // handled separately
    if (brand.logoId && Array.isArray(brand.logos)) {
      const hit = brand.logos.find(l => l.id === brand.logoId);
      if (hit && hit.path) return hit.path;
    }
    return brand.logoPath || null;
  }

  function _logoUrl(brand) {
    if (!brand) return null;
    if (brand.logoDataUrl) return brand.logoDataUrl;
    const path = _activeLogoPath(brand);
    if (!path) return null;
    const bust = brand.updatedAt ? `?v=${encodeURIComponent(String(brand.updatedAt))}` : '';
    if (/^https?:\/\//i.test(path)) return path + bust;
    return path + bust;
  }

  function _normalize(brand) {
    const b = Object.assign({}, DEFAULTS, brand || {});
    if (!FONTS[b.font]) b.font = 'cormorant';
    // Migrar estilos legacy
    const legacy = {
      'glass-pill': 'crystal',
      'glass-bar': 'crystal',
      'solid-light': 'ivory',
      'night-glass': 'obsidian',
      'gold-line': 'champagne'
    };
    if (legacy[b.dockStyle]) b.dockStyle = legacy[b.dockStyle];
    if (STYLES.indexOf(b.dockStyle) === -1) b.dockStyle = 'crystal';
    if (!Array.isArray(b.logos)) b.logos = [];
    if (b.mobileSolid == null) b.mobileSolid = true;
    if (b.hideLoteFill == null) b.hideLoteFill = false;
    if (b.loteFillOnHoverOnly == null) b.loteFillOnHoverOnly = false;
    if (b.loteHoverColor == null) b.loteHoverColor = 'neon-green';
    b.contact = Object.assign({}, CONTACT_DEFAULTS, (brand && brand.contact) || b.contact || {});
    // Sync logoPath from gallery
    if (b.logoId && b.logos.length) {
      const hit = b.logos.find(l => l.id === b.logoId);
      if (hit) b.logoPath = hit.path;
    } else if (b.logoPath && !b.logoId && b.logos.length === 0) {
      // Legacy single logo → virtual gallery entry
      b.logoId = 'legacy';
      b.logos = [{ id: 'legacy', path: b.logoPath, name: 'Logo principal', ext: 'png', createdAt: b.updatedAt || Date.now() }];
    }
    return b;
  }

  function _applyMobileSolid(dock) {
    if (!dock) return;
    const wantSolid = !!_brand.mobileSolid;
    const isNarrow = window.matchMedia('(max-width: 768px)').matches;
    const reduceTx = window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
    dock.classList.toggle('is-mobile-solid', wantSolid && (isNarrow || reduceTx));
  }

  function apply(brand) {
    _brand = _normalize(brand);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(_brand));
    } catch (e) { /* quota */ }

    // Sincronizar voz del admin → copiloto (salvo override manual del usuario en el chat)
    try {
      if (_brand.voiceMode && localStorage.getItem('kpk_voice_user_override') !== '1') {
        localStorage.setItem('kpk_voice_mode', _brand.voiceMode);
      }
      // Propagar key ElevenLabs del brand si existe
      if (_brand.aiKeys && _brand.aiKeys.elevenlabs) {
        localStorage.setItem('ferrari_ai_key_elevenlabs', _brand.aiKeys.elevenlabs);
      }
    } catch (e) { /* quota */ }

    const { dock, glass, name, logo, logoWrap, title } = _els();
    if (!dock) return;

    const projectName = String(_brand.projectName || '').trim();
    const src = _logoUrl(_brand);
    const hasName = projectName.length > 0;
    const hasLogo = !!src;
    const fontMeta = FONTS[_brand.font] || FONTS.cormorant;

    STYLES.forEach(s => dock.classList.remove('dock-style-' + s));
    // legacy clean
    ['glass-pill', 'glass-bar', 'solid-light', 'night-glass', 'gold-line'].forEach(s => {
      dock.classList.remove('dock-style-' + s);
    });
    dock.classList.add('dock-style-' + _brand.dockStyle);
    dock.dataset.font = _brand.font;
    dock.dataset.style = _brand.dockStyle;
    _applyMobileSolid(dock);

    if (name) {
      name.style.fontFamily = fontMeta.family;
      name.style.fontWeight = fontMeta.weight;
      name.style.letterSpacing = fontMeta.tracking;
    }
    if (glass) {
      glass.style.setProperty('--brand-font', fontMeta.family);
      glass.style.setProperty('--brand-tracking', fontMeta.tracking);
      glass.style.setProperty('--brand-weight', fontMeta.weight);
    }

    if (!hasName && !hasLogo) {
      dock.classList.remove('is-visible');
      dock.setAttribute('aria-hidden', 'true');
      return;
    }

    if (name) {
      name.textContent = hasName ? projectName : '';
      name.hidden = !hasName;
    }

    if (logo && logoWrap) {
      if (hasLogo) {
        logo.onload = () => { logoWrap.classList.add('is-loaded'); };
        logo.onerror = () => {
          logoWrap.hidden = true;
          logoWrap.classList.remove('is-on', 'is-loaded');
          dock.classList.remove('has-logo');
        };
        logo.src = src;
        logo.alt = hasName ? projectName : 'Logo del proyecto';
        logoWrap.hidden = false;
        logoWrap.classList.add('is-on');
      } else {
        logo.removeAttribute('src');
        logo.alt = '';
        logoWrap.hidden = true;
        logoWrap.classList.remove('is-on', 'is-loaded');
      }
    }

    dock.classList.toggle('has-logo', hasLogo);
    dock.classList.toggle('has-name', hasName);
    dock.classList.add('is-visible');
    dock.setAttribute('aria-hidden', 'false');

    if (title && hasName) {
      title.textContent = `${projectName} — Tour 360°`;
    }

    const wantHideFill = !!_brand.hideLoteFill;
    document.body.classList.toggle('kpk-hide-lote-fill', wantHideFill);

    const wantHoverOnly = !!_brand.loteFillOnHoverOnly;
    document.body.classList.toggle('kpk-lote-fill-hover-only', wantHoverOnly);

    const HOVER_COLORS = {
      'neon-green':  'rgba(57, 255, 20, 0.35)',
      'neon-blue':   'rgba(0, 229, 255, 0.35)',
      'neon-pink':   'rgba(255, 0, 127, 0.35)',
      'neon-orange': 'rgba(255, 145, 0, 0.35)',
      'glass-white': 'rgba(255, 255, 255, 0.22)'
    };
    const hoverColorId = _brand.loteHoverColor || 'neon-green';
    const resolvedColor = HOVER_COLORS[hoverColorId] || HOVER_COLORS['neon-green'];
    if (wantHoverOnly) {
      document.body.style.setProperty('--kpk-lote-hover-fill', resolvedColor);
    } else {
      document.body.style.removeProperty('--kpk-lote-hover-fill');
    }
  }

  function _fromCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : null;
    } catch (e) {
      return null;
    }
  }

  async function _fetchBrand() {
    const OWNER = _owner();
    const REPO = _repo();
    const BRANCH = _branch();
    const PATH = 'data/brand.json';
    const token = _token();

    if (token) {
      const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?t=${Date.now()}`;
      const r = await fetch(url, {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json'
        }
      });
      if (r.status === 404) return { ...DEFAULTS };
      if (!r.ok) throw new Error('No se pudo cargar brand.json');
      const meta = await r.json();
      return JSON.parse(decodeURIComponent(escape(atob(meta.content.replace(/\n/g, '')))));
    }

    try {
      const local = await fetch(`${PATH}?t=${Date.now()}`, { cache: 'no-store' });
      if (local.ok) return await local.json();
    } catch (e) { /* seguir */ }

    const rawUrl = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${PATH}?t=${Date.now()}`;
    const r = await fetch(rawUrl);
    if (r.status === 404) return { ...DEFAULTS };
    if (!r.ok) throw new Error('brand.json no disponible');
    return await r.json();
  }

  async function load() {
    const cached = _fromCache();
    if (cached) apply(cached);

    try {
      const remote = await _fetchBrand();
      if (remote && typeof remote === 'object') apply(remote);
    } catch (e) {
      console.log('[Ferrari/BrandDock] Remoto no disponible:', e.message);
      if (!cached) apply(DEFAULTS);
    }

    if (!_mq) {
      _mq = window.matchMedia('(max-width: 768px)');
      const onChange = () => {
        const { dock } = _els();
        _applyMobileSolid(dock);
      };
      if (_mq.addEventListener) _mq.addEventListener('change', onChange);
      else if (_mq.addListener) _mq.addListener(onChange);
    }
  }

  function getBrand() {
    return Object.assign({}, _brand);
  }

  function getContact() {
    return Object.assign({}, CONTACT_DEFAULTS, (_brand && _brand.contact) || {});
  }

  /** Solo dígitos para wa.me / api.whatsapp.com */
  function whatsappDigits(raw) {
    return String(raw || '').replace(/\D/g, '');
  }

  function whatsappUrl(phone, text) {
    const digits = whatsappDigits(phone);
    if (!digits) return null;
    const base = `https://api.whatsapp.com/send?phone=${digits}`;
    return text ? `${base}&text=${encodeURIComponent(text)}` : base;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }

  window.FerrariBrandDock = {
    load, apply, getBrand, getContact, whatsappDigits, whatsappUrl,
    FONTS, STYLES, CONTACT_DEFAULTS
  };

  console.log('[Ferrari/BrandDock] ✓ Módulo cargado');

})();
