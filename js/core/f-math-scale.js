/**
 * f-math-scale.js — Motor matemático para escala real en panoramas 360
 * 
 * Permite proyectar coordenadas esféricas (pitch/yaw) sobre un plano de
 * suelo virtual definido por la altitud del dron, posibilitando cálculos
 * de área en metros cuadrados y proyecciones métricas.
 */

'use strict';

(function() {

  /**
   * Proyecta un punto esférico (pitch, yaw) sobre el plano del suelo a -altitude.
   * @param {number} pitch grados (-90 a 90)
   * @param {number} yaw grados (-180 a 180)
   * @param {number} altitude metros (ej: 120)
   * @returns {{x: number, z: number}} coordenadas X,Z en metros
   */
  function pitchYawToGround(pitch, yaw, altitude) {
    // Evitar proyección por encima o muy cerca del horizonte (tiende a infinito)
    if (pitch >= -1) pitch = -1;

    const p_rad = pitch * Math.PI / 180;
    const y_rad = yaw * Math.PI / 180;

    const vx = Math.cos(p_rad) * Math.sin(y_rad);
    const vy = Math.sin(p_rad);
    const vz = Math.cos(p_rad) * Math.cos(y_rad);

    // Escalamos el vector para que alcance la coordenada Y = -altitude
    const t = -altitude / vy;

    return {
      x: vx * t,
      z: vz * t
    };
  }

  /**
   * Convierte un punto en el suelo cartesiano (metros) de vuelta a esférico.
   * @param {number} x metros
   * @param {number} z metros
   * @param {number} altitude metros
   * @returns {{pitch: number, yaw: number}}
   */
  function groundToPitchYaw(x, z, altitude) {
    const y = -altitude;
    const dist = Math.sqrt(x*x + y*y + z*z);
    
    const vx = x / dist;
    const vy = y / dist;
    const vz = z / dist;

    const pitch = Math.asin(Math.max(-1, Math.min(1, vy))) * 180 / Math.PI;
    const yaw = Math.atan2(vx, vz) * 180 / Math.PI;

    return { pitch, yaw };
  }

  /**
   * Calcula el área real de un polígono 3D sobre el suelo asumiendo altitud.
   * @param {Array<{pitch:number, yaw:number}|[number,number]>} puntos 
   * @param {number} altitude 
   * @returns {number} Área en metros cuadrados
   */
  function calculateGroundArea(puntos, altitude) {
    if (puntos.length < 3) return 0;
    
    const pts = puntos.map(p => {
      const pitch = Array.isArray(p) ? p[0] : p.pitch;
      const yaw   = Array.isArray(p) ? p[1] : p.yaw;
      return pitchYawToGround(pitch, yaw, altitude);
    });
    
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += (pts[i].x * pts[j].z) - (pts[j].x * pts[i].z);
    }
    
    return Math.abs(area) / 2;
  }

  /**
   * Centroide geométrico de un lote (polígono cerrado) en pitch/yaw.
   *
   * Proyecta al plano del suelo → centroide shoelace → vuelve a esférico.
   * Así el Smart Pin queda en el centro visual real del lote, no en el
   * promedio angular de vértices (que falla en lotes irregulares / nadir).
   *
   * @param {Array<[number,number]|{pitch:number,yaw:number}>} puntos
   * @param {number} [altitude=120]
   * @returns {{pitch:number, yaw:number}|null}
   */
  function computeLoteCentroid(puntos, altitude) {
    if (!puntos || puntos.length < 3) return null;

    const alt = (typeof altitude === 'number' && altitude > 0) ? altitude : 120;

    const ground = [];
    for (let i = 0; i < puntos.length; i++) {
      const p = puntos[i];
      const pitch = Array.isArray(p) ? p[0] : p.pitch;
      const yaw   = Array.isArray(p) ? p[1] : p.yaw;
      if (typeof pitch !== 'number' || typeof yaw !== 'number') continue;
      ground.push(pitchYawToGround(pitch, yaw, alt));
    }

    if (ground.length < 3) return null;

    // Centroide de polígono 2D (shoelace)
    let area2 = 0; // 2 * signed area
    let cx = 0;
    let cz = 0;

    for (let i = 0; i < ground.length; i++) {
      const j = (i + 1) % ground.length;
      const cross = ground[i].x * ground[j].z - ground[j].x * ground[i].z;
      area2 += cross;
      cx += (ground[i].x + ground[j].x) * cross;
      cz += (ground[i].z + ground[j].z) * cross;
    }

    if (Math.abs(area2) > 1e-8) {
      // Cx = Σ((xi+xi+1)*cross) / (6A) y A = area2/2 → divisor = 3*area2
      cx /= (3 * area2);
      cz /= (3 * area2);
      return groundToPitchYaw(cx, cz, alt);
    }

    // Degenerado (colineal): promedio de vectores unitarios en esfera
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < puntos.length; i++) {
      const p = puntos[i];
      const pitch = (Array.isArray(p) ? p[0] : p.pitch) * Math.PI / 180;
      const yaw   = (Array.isArray(p) ? p[1] : p.yaw)   * Math.PI / 180;
      sx += Math.cos(pitch) * Math.sin(yaw);
      sy += Math.sin(pitch);
      sz += Math.cos(pitch) * Math.cos(yaw);
    }
    const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (len < 1e-12) return null;

    sx /= len; sy /= len; sz /= len;
    return {
      pitch: Math.asin(Math.max(-1, Math.min(1, sy))) * 180 / Math.PI,
      yaw:   Math.atan2(sx, sz) * 180 / Math.PI
    };
  }

  window.FerrariMathScale = {
    pitchYawToGround,
    groundToPitchYaw,
    calculateGroundArea,
    computeLoteCentroid
  };

  console.log('[Ferrari/MathScale] ✓ Módulo inicializado');

})();
