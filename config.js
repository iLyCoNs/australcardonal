/**
 * config.js — Configuración general por defecto del proyecto (PLAN BÁSICO).
 * ESTE ARCHIVO SE SUBE AL REPOSITORIO (GIT TRACKED)
 */

(function() {
  window.KPK_CONFIG = {
    configVersion: 14,
    plan: 'basic',

    // ─── ALERTAS DE WHATSAPP (CallMeBot) ───
    whatsappAlerts: {
      enabled: false,
      ownerPhone: '',
      callMeBotApiKey: ''
    }
  };
})();
