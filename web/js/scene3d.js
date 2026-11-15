/* =========================================================
   scene3d.js — relieve 3D con Three.js (DEM MOLA/HRSC)
   El terreno se construye en el navegador a partir de la grilla de alturas.
   Versión original Three.js con soporte de minerales científicos e inspección interactiva.
   ========================================================= */
(function () {
  "use strict";
  const MR = window.MR;
  const S3 = (MR.Scene3D = { ready: false });
  let renderer, scene, camera, controls, terrain, routeMesh, doneMesh, secMeshes = [], astro, beacon, pins = [], host;
  let exag = 2.5, follow = true, running = false;
  let raycaster, mouse;
  const SIZE = 100;                       // el terreno mide 100 × 100 unidades (≈ 53 km)
  const KM_PER_UNIT = 53.2 / SIZE;

  function getDemInfo() {
    if (MR.currentRegion === "jezero" && MR.F.jezero_dem && window.JEZERO_DATA && window.JEZERO_DATA.dem) {
      return { Z: MR.F.jezero_dem, min: window.JEZERO_DATA.dem.min };
    }
    return { Z: MR.F.dem, min: MR.D.layers.dem.min };
  }

  function heightAt(lon, lat) {
    const z = MR.sample("dem", lon, lat);
    const info = getDemInfo();
    return ((z - info.min) / 1000 / KM_PER_UNIT) * exag;
  }

  function toXYZ(lon, lat, lift = 0.25) {
    const [wx, wy] = MR.toWorld(lon, lat);
    return new THREE.Vector3((wx / 1200 - 0.5) * SIZE, heightAt(lon, lat) + lift, (wy / 1200 - 0.5) * SIZE);
  }

  S3.init = function () {
    if (S3.ready || !window.THREE) return !!window.THREE;
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    host = document.getElementById("map3d");
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x2a160d, 110, 260);
    scene.background = new THREE.Color(0x1d100a);
    camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.1, 1000);
    camera.position.set(-30, 55, 75);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 6;
    controls.maxDistance = 200;
    controls.addEventListener("start", () => {
      if (follow) {
        follow = false;
        const f = document.getElementById("follow3d");
        if (f) f.checked = false;
      }
    });
    scene.add(new THREE.HemisphereLight(0xfff2e6, 0x6a3a22, 1.05));
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const sun = new THREE.DirectionalLight(0xfff1e0, 0.85);
    sun.position.set(-60, 80, -40);
    scene.add(sun);

    buildTerrain();
    setupInteraction();
    window.addEventListener("resize", resize);
    S3.ready = true;
    return true;
  };

  function buildTerrain() {
    if (terrain) {
      scene.remove(terrain);
      if (terrain.geometry) terrain.geometry.dispose();
      if (terrain.material) terrain.material.dispose();
    }
    const G = MR.G, geo = new THREE.PlaneGeometry(SIZE, SIZE, G - 1, G - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const info = getDemInfo();
    const Z = info.Z, lo = info.min;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, ((Z[i] - lo) / 1000 / KM_PER_UNIT) * exag);
    }
    geo.computeVertexNormals();

    const baseImg = document.getElementById("basemap");
    const tex = new THREE.Texture(S3.textureCanvas || baseImg);
    tex.needsUpdate = true;
    tex.anisotropy = 4;
    if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;

    terrain = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ map: tex, emissive: 0x777777, emissiveMap: tex })
    );
    scene.add(terrain);
  }

  // Compone mapa base + capa de análisis en una textura
  S3.setTexture = function (baseImg, overlayCanvas, opacity) {
    const c = document.createElement("canvas");
    c.width = c.height = 1200;
    const ctx = c.getContext("2d");
    try {
      ctx.drawImage(baseImg, 0, 0, 1200, 1200);
    } catch (e) {
      /* imagen aún no cargada */
    }
    if (overlayCanvas) {
      ctx.globalAlpha = opacity;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(overlayCanvas, 0, 0, 1200, 1200);
    }
    S3.textureCanvas = c;
    if (terrain) {
      const tx = new THREE.Texture(c);
      tx.needsUpdate = true;
      if (THREE.sRGBEncoding) tx.encoding = THREE.sRGBEncoding;
      terrain.material.map = tx;
      terrain.material.emissiveMap = tx;
      terrain.material.needsUpdate = true;
    }
  };

  function tube(pts, color, radius, opacity = 1) {
    if (!pts || pts.length < 2) return null;
    const step = Math.max(1, Math.floor(pts.length / 500));
    const v = [];
    for (let i = 0; i < pts.length; i += step) v.push(toXYZ(pts[i][0], pts[i][1], 0.35));
    v.push(toXYZ(pts[pts.length - 1][0], pts[pts.length - 1][1], 0.35));
    const curve = new THREE.CatmullRomCurve3(v);
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.min(1500, v.length * 3), radius, 6, false),
      new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity })
    );
    scene.add(mesh);
    return mesh;
  }

  function dispose(m) {
    if (m) {
      scene.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    }
  }

  function makeAstronaut() {
    const group = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.8 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x0b3550, metalness: 0.35, roughness: 0.25 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.58, 1.15, 12), suit);
    body.position.y = 1.18; group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), suit);
    head.position.y = 2.05; group.add(head);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.29, 16, 10), visor);
    glass.position.set(0, 2.06, 0.27); group.add(glass);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.75, 0.34), trim);
    pack.position.set(0, 1.28, -0.48); group.add(pack);
    [-1, 1].forEach(side => {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.85, 8), suit);
      arm.position.set(side * 0.62, 1.22, 0); arm.rotation.z = side * -0.18; group.add(arm);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.8, 8), suit);
      leg.position.set(side * 0.22, 0.37, 0); group.add(leg);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.48), trim);
      boot.position.set(side * 0.22, 0.06, 0.08); group.add(boot);
    });
    group.userData.body = body;
    return group;
  }

  let last = {};
  S3.update = function (st) {
    if (!S3.ready) return;
    last = st || {};
    dispose(routeMesh);
    routeMesh = tube(last.route, 0x4d8dff, 0.22);
    secMeshes.forEach(dispose);
    secMeshes = (last.secondary || []).map(p => tube(p, 0xa68bff, 0.18));
    S3.updatePins(last.pins || []);
    S3.updatePos(last);
  };

  S3.updatePos = function (st) {
    if (!S3.ready) return;
    dispose(doneMesh);
    if (st.route && st.km > 0.05) {
      const i = MR.nearestKm(st.route, st.km);
      doneMesh = tube(st.route.slice(0, Math.max(2, i + 1)), 0x46c882, 0.3);
    }
    if (!astro) {
      astro = makeAstronaut();
      beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
      scene.add(astro);
      scene.add(beacon);
    }
    if (st.pos) {
      const p = toXYZ(st.pos[0], st.pos[1], 0.8);
      astro.position.copy(p);
      beacon.position.set(p.x, p.y + 3, p.z);
      astro.userData.body.material.color.set(st.color || "#1E64DC");
      astro.visible = beacon.visible = true;
      if (follow) {
        controls.target.lerp(p, 0.25);
      }
    } else {
      astro.visible = beacon.visible = false;
    }
  };

  S3.updatePins = function (list) {
    pins.forEach(p => scene.remove(p));
    pins = [];
    const col = {
      meta: 0xfc3d21,
      base: 0x1e64dc,
      refugio: 0x10b981,
      mineral: 0x2f7fb8,
      espectral: 0x2f7fb8,
      ciencia: 0xb5651d,
      referencia: 0xc0c8d4,
      hallazgo: 0x46c882,
      secundaria: 0xa68bff,
      propuesta: 0xa68bff
    };

    list.forEach(m => {
      const g = new THREE.Group();
      const base = toXYZ(m.lon, m.lat, 0);
      const isMin = m.type === "mineral" || m.isMineral;
      const c = isMin ? (m.mineral && m.mineral.category === "Carbonatos / Olivino" ? 0x00d26a : 0x2f7fb8) : (col[m.type] || 0xffffff);

      const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 3, 6),
        new THREE.MeshBasicMaterial({ color: c })
      );
      stick.position.set(base.x, base.y + 1.5, base.z);

      let head;
      if (isMin) {
        head = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.75),
          new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.4 })
        );
        head.position.set(base.x, base.y + 3.4, base.z);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.4, 0.9, 16),
          new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(base.x, base.y + 0.1, base.z);
        g.add(ring);
        g.userData = { isMineral: true, mineral: m.mineral || m, onClick: m.onClick, label: m.label };
      } else {
        head = new THREE.Mesh(
          m.type === "meta"
            ? new THREE.ConeGeometry(0.7, 1.4, 4)
            : m.type === "refugio"
            ? new THREE.CylinderGeometry(0.5, 0.6, 1.0, 6)
            : new THREE.OctahedronGeometry(0.55),
          new THREE.MeshBasicMaterial({ color: c })
        );
        head.position.set(base.x, base.y + 3.3, base.z);
        g.userData = { isMineral: false, target: m, onClick: m.onClick, label: m.label };
      }

      g.add(stick);
      g.add(head);
      scene.add(g);
      pins.push(g);
    });
  };

  function setupInteraction() {
    if (!renderer || !renderer.domElement) return;
    const dom = renderer.domElement;

    dom.addEventListener("click", e => {
      const rect = dom.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      const hitList = [];
      pins.forEach(g => {
        g.traverse(child => {
          if (child.isMesh) {
            child._parentGroup = g;
            hitList.push(child);
          }
        });
      });

      const intersects = raycaster.intersectObjects(hitList, false);
      if (intersects.length > 0) {
        const pGroup = intersects[0].object._parentGroup;
        if (pGroup && pGroup.userData) {
          if (pGroup.userData.onClick) {
            pGroup.userData.onClick();
          } else if (pGroup.userData.isMineral && window.openMineralModal) {
            window.openMineralModal(pGroup.userData.mineral);
          }
        }
      }
    });

    dom.addEventListener("pointermove", e => {
      const rect = dom.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      const hitList = [];
      pins.forEach(g => {
        g.traverse(child => {
          if (child.isMesh) hitList.push(child);
        });
      });

      const intersects = raycaster.intersectObjects(hitList, false);
      dom.style.cursor = intersects.length > 0 ? "pointer" : "default";
    });
  }

  S3.rebuild = function () {
    if (!S3.ready) return;
    buildTerrain();
    S3.update(last);
  };

  S3.setExag = function (v) {
    exag = v;
    if (!S3.ready) return;
    buildTerrain();
    S3.update(last);
  };

  S3.setFollow = v => (follow = v);

  S3.start = function () {
    if (!S3.ready) return;
    running = true;
    resize();
    const loop = (now) => {
      if (!running) return;
      controls.update();

      // Rotación suave de cristales minerales
      const tSec = now * 0.002;
      pins.forEach(p => {
        if (p.userData && p.userData.isMineral && p.children[1]) {
          p.children[1].rotation.y = tSec;
        }
      });

      if (window.MR && window.MR.UI && window.MR.UI.repositionPointUI) {
        window.MR.UI.repositionPointUI();
      }

      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };

  S3.stop = () => (running = false);

  function resize() {
    if (!renderer || !host.clientWidth) return;
    renderer.setSize(host.clientWidth, host.clientHeight);
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
  }

  S3.focus = function (lon, lat) {
    if (!S3.ready) return;
    const p = toXYZ(lon, lat, 0);
    controls.target.copy(p);
    camera.position.set(p.x - 26, p.y + 34, p.z + 40);
  };

  S3.project = function (lon, lat) {
    if (!camera || !renderer) return [0, 0];
    const p = toXYZ(lon, lat, 0.5);
    p.project(camera);
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    return [(p.x * 0.5 + 0.5) * w, (-(p.y * 0.5) + 0.5) * h];
  };
})();
