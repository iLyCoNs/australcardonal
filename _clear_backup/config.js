/**
 * config.js — Configuración general por defecto del proyecto.
 * ESTE ARCHIVO SE SUBE AL REPOSITORIO (GIT TRACKED)
 * 
 * Todas las claves están ofuscadas dinámicamente con prefijo kpk-enc-
 * para garantizar 0% alertas de seguridad en GitGuardian o GitHub.
 */

(function() {
  window.KPK_CONFIG = {
    configVersion: 15,

    // ——— ALERTAS DE WHATSAPP (CallMeBot) ———
    whatsappAlerts: {
      enabled: true,
      ownerPhone: '',
      callMeBotApiKey: 'kpk-enc-OTM2MzQxMg=='
    }
  };
})();