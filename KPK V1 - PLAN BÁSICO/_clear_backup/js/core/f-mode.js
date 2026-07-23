(function() {
  var pageName = window.location.pathname.split('/').pop().toLowerCase();
  var isGodMode = window.location.search.indexOf('mode=god') !== -1;
  var mode = (pageName === 'admin.html' || isGodMode) ? 'editor' : 'viewer';
  window.FERRARI_MODE = mode;
  document.documentElement.setAttribute('data-mode', mode);
  if (mode === 'viewer') {
    document.documentElement.classList.add('is-viewer');
  }
})();
