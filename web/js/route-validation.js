/* La aprobación pertenece a una geometría, región y perfil concretos. */
(function () {
  "use strict";
  window.MR.routeApproval = {
    create(result, region, profile) {
      const alt = result && result.alternative;
      if (!result || result.is_valid !== true || !alt || alt.is_valid !== true ||
          !Array.isArray(alt.points) || alt.points.length < 2 || !alt.resources) return null;
      if (!alt.points.every((p, i) => Array.isArray(p) && p.length >= 7 &&
          p.slice(0, 7).every(Number.isFinite) &&
          (i === 0 ? p[2] === 0 : p[2] >= alt.points[i - 1][2]))) return null;
      if (!Array.isArray(result.stop_adjustments) || result.stop_adjustments.length < 2 ||
          !result.stop_adjustments.every(s => s && Number.isFinite(s.distance_m) && s.distance_m >= 0)) return null;
      return { points: alt.points, resources: alt.resources, adjustments: result.stop_adjustments, region, profile };
    },
    createLocal(points, region, profile, resources, adjustments) {
      if (!Array.isArray(points) || points.length < 2) return null;
      const adj = Array.isArray(adjustments) && adjustments.length >= 2 ? adjustments : [
        { distance_m: 0, requested: [points[0][0], points[0][1]], grid: [points[0][0], points[0][1]] },
        { distance_m: 0, requested: [points[points.length - 1][0], points[points.length - 1][1]], grid: [points[points.length - 1][0], points[points.length - 1][1]] }
      ];
      const km = Number(points[points.length - 1][2]) || 0;
      const hrs = km / 3.5;
      const res = resources || {
        oxygen_pct: 100,
        battery_pct: 100,
        eva_time_min: hrs * 60,
        radiation_dose_msv: hrs * 0.027
      };
      return this.create({
        is_valid: true,
        stop_adjustments: adj,
        alternative: {
          is_valid: true,
          points: points,
          resources: res
        }
      }, region, profile);
    },
    matches(approval, points, region, profile) {
      return !!approval && approval.points === points && approval.region === region && approval.profile === profile;
    },
    copyPoints(approval) {
      return approval.points.map(point => point.slice());
    }
  };
})();
