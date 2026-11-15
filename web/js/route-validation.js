/* La aprobación pertenece a una geometría, región y perfil concretos. */
(function () {
  "use strict";
  window.MR.routeApproval = {
    create(result, region, profile) {
      const alt = result && result.alternative;
      if (!result || result.is_valid !== true || !alt || alt.is_valid !== true ||
          !Array.isArray(alt.points) || alt.points.length < 2 || !alt.resources) return null;
      if (!Array.isArray(result.stop_adjustments) || result.stop_adjustments.length < 2 ||
          !result.stop_adjustments.every(s => s && Number.isFinite(s.distance_m) && s.distance_m >= 0)) return null;
      return { points: alt.points, resources: alt.resources, adjustments: result.stop_adjustments, region, profile };
    },
    matches(approval, points, region, profile) {
      return !!approval && approval.points === points && approval.region === region && approval.profile === profile;
    }
  };
})();
