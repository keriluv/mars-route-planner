const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("view and region transitions preserve 2D map scale and 3D terrain consistency", () => {
  // Mock DOM
  const listeners = {};
  const elements = {};
  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      style: {},
      children: [],
      classList: {
        add: () => {},
        remove: () => {},
        toggle: () => {},
        contains: () => false
      },
      setAttribute: (k, v) => { el[k] = v; },
      getAttribute: (k) => el[k],
      addEventListener: (evt, fn) => {
        listeners[evt] = listeners[evt] || [];
        listeners[evt].push(fn);
      },
      removeEventListener: () => {},
      appendChild: (c) => { el.children.push(c); return c; },
      querySelectorAll: () => [],
      querySelector: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
      getContext: () => ({
        clearRect: () => {},
        drawImage: () => {},
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        putImageData: () => {}
      }),
      clientWidth: 1200,
      clientHeight: 800
    };
    return el;
  }

  const ids = ["map", "world", "markers", "vector", "basemap", "overlay", "contours", "map3d", "mapGlobe"];
  ids.forEach(id => {
    elements[id] = createElement("div");
  });
  elements.basemap = createElement("img");
  elements.basemap.complete = true;
  elements.overlay = createElement("canvas");
  elements.contours = createElement("canvas");

  const ctx = {
    window: {
      innerWidth: 1280,
      innerHeight: 800,
      devicePixelRatio: 1,
      addEventListener: () => {},
      removeEventListener: () => {},
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {}
    },
    document: {
      getElementById: (id) => elements[id] || createElement("div"),
      createElement,
      createElementNS: (ns, tag) => createElement(tag),
      addEventListener: () => {},
      querySelectorAll: () => [],
      querySelector: () => null,
      body: createElement("body")
    },
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    console
  };
  ctx.window.document = ctx.document;
  ctx.window.atob = ctx.atob;
  ctx.cancelAnimationFrame = ctx.window.cancelAnimationFrame;
  ctx.requestAnimationFrame = ctx.window.requestAnimationFrame;
  vm.createContext(ctx);

  vm.runInContext(fs.readFileSync(path.join(__dirname, "../web/data/mars_data.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../web/data/jezero_data.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../web/data/minerals_data.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../web/vendor/three.min.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../web/js/core.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../web/js/map2d.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../web/js/scene3d.js"), "utf8"), ctx);

  const MR = ctx.window.MR;
  MR.Map.init();

  // 1. Initial 2D map scale is valid
  assert.ok(elements.world.style.transform.includes("scale("), "World should have scale");
  const scaleMatch1 = elements.world.style.transform.match(/scale\(([0-9.]+)\)/);
  assert.ok(scaleMatch1 && parseFloat(scaleMatch1[1]) > 0.5, "Scale should be > 0.5");

  // 2. Hide 2D map (simulating Planeta 3D or Relieve 3D)
  elements.map.hidden = true;
  elements.map.clientWidth = 0;
  elements.map.clientHeight = 0;

  // 3. Switch to Jezero while map is hidden
  MR.setRegion("jezero");
  assert.equal(MR.currentRegion, "jezero");
  assert.equal(MR.bbox[0], 77.05);
  assert.equal(MR.bbox[1], 18.05);
  assert.equal(MR.bbox[2], 77.68);
  assert.equal(MR.bbox[3], 18.63);

  // Calling MR.Map.setRegion while hidden MUST NOT collapse scale to 0
  MR.Map.setRegion("jezero");
  const scaleMatch2 = elements.world.style.transform.match(/scale\(([0-9.]+)\)/);
  assert.ok(scaleMatch2 && parseFloat(scaleMatch2[1]) > 0.1, "Scale must not be 0 when hidden");

  // Calling MR.Map.fit while hidden MUST NOT collapse scale to 0
  MR.Map.fit(false);
  const scaleMatch3 = elements.world.style.transform.match(/scale\(([0-9.]+)\)/);
  assert.ok(scaleMatch3 && parseFloat(scaleMatch3[1]) > 0.1, "M.fit while hidden must not zero scale");

  // 4. Return to 2D view: map becomes visible with client dimensions
  elements.map.hidden = false;
  elements.map.clientWidth = 1200;
  elements.map.clientHeight = 800;
  MR.Map.fit(false);

  const scaleMatch4 = elements.world.style.transform.match(/scale\(([0-9.]+)\)/);
  assert.ok(scaleMatch4 && parseFloat(scaleMatch4[1]) > 0.5, "Restored scale must be > 0.5");

  // 5. Check coordinates projection for Jezero
  const jezStart = [77.4508, 18.4447];
  const [wx, wy] = MR.toWorld(jezStart[0], jezStart[1]);
  assert.ok(wx >= 0 && wx <= 1200, `Jezero wx ${wx} must be within 1200`);
  assert.ok(wy >= 0 && wy <= 1200, `Jezero wy ${wy} must be within 1200`);

  // 6. Check Scene3D rebuild for Jezero
  assert.equal(typeof MR.Scene3D.rebuild, "function");
  assert.equal(typeof MR.Scene3D.setMineralsVisible, "function");
  assert.equal(typeof MR.Scene3D.setLayerVisible, "function");
});
