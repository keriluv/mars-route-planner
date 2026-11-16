const test = require('node:test');
const assert = require('node:assert/strict');

if (!global.window) {
  global.window = { MARS_DATA: { layers: { grid: 1, dem: { min: 0, max: 1, b64: 'AA==' } } } };
}
require('../web/js/core.js');
const MR = window.MR;

test('consumable thresholds: oxygen drops below 35% and 25% boundary', () => {
  let state = {
    oxygen_pct: 36.0,
    battery_pct: 80.0,
    eva_time_min: 120.0,
    radiation_dose_msv: 0.05,
    water_liters: 0.5,
    o2_used_g: 416.0
  };

  // Caminar 10 min a paso moderado
  state = MR.consumeEvaResources(state, 10, 0.02, 3.0);
  assert.ok(state.oxygen_pct <= 35.0, `oxygen_pct debería estar <= 35%, actual: ${state.oxygen_pct}`);

  // Simular avance hasta entrar en reserva de retorno (<= 25%)
  state = MR.consumeEvaResources(state, 50, 0.03, 3.2);
  assert.ok(state.oxygen_pct <= 25.0, `oxygen_pct debería entrar en reserva crítica <= 25%, actual: ${state.oxygen_pct}`);
  assert.ok(state.o2_used_g > 487.5, "consumo de O2 supera el 75% del tanque de 650g");
});

test('physiological thresholds: hydration consumption exceeds 1.0 L after extended walk', () => {
  let state = {
    oxygen_pct: 100.0,
    battery_pct: 100.0,
    eva_time_min: 0.0,
    radiation_dose_msv: 0.0,
    water_liters: 0.0,
    calories_kcal: 0
  };

  // Caminar 4 horas a 250 W (~0.25 L/h de sudoración según Pandolf adaptado)
  for (let i = 0; i < 4; i++) {
    state = MR.consumeEvaResources(state, 60, 0.05, 3.5);
  }

  assert.ok(state.water_liters >= 1.0, `Agua transpirada debería alcanzar >= 1.0 L, actual: ${state.water_liters}`);
  assert.ok(state.calories_kcal > 500, "Gasto calórico acumulado significativo");
  assert.ok(state.heart_rate_bpm > 75, "Ritmo cardíaco reactivo a la carga de trabajo");
});

test('battery PLSS consumption tracks linear decline toward 25%', () => {
  let state = {
    oxygen_pct: 100.0,
    battery_pct: 30.0,
    eva_time_min: 300.0,
    radiation_dose_msv: 0.125
  };

  // 30 min a 12% por hora = 6% de caída -> 24%
  state = MR.consumeEvaResources(state, 30, 0.0, 3.0);
  assert.ok(state.battery_pct <= 25.0, `Batería debería ser <= 25%, actual: ${state.battery_pct}`);
});
