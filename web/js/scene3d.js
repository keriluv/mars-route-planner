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
  let exag = 6.0, follow = true, running = false;
  let raycaster, mouse;
  const SIZE = 100;                       // el terreno mide 100 × 100 unidades
  let layerVisible = true;
  let mineralsVisible = true;

  function getKmPerUnit() {
    const bbox = (MR.activeRegion && MR.activeRegion.bbox) || MR.bbox || (MR.D && MR.D.bbox);
    if (!bbox) return 53.2 / SIZE;
    const midLat = (bbox[1] + bbox[3]) / 2;
    const kmWidth = MR.distKm ? MR.distKm([bbox[0], midLat], [bbox[2], midLat]) : 53.2;
    return Math.max(0.1, kmWidth / SIZE);
  }

  function getDemInfo() {
    if (MR.currentRegion === "jezero" && MR.F.jezero_dem && window.JEZERO_DATA && window.JEZERO_DATA.dem) {
      return { Z: MR.F.jezero_dem, min: window.JEZERO_DATA.dem.min };
    }
    return { Z: MR.F.dem, min: MR.D.layers.dem.min };
  }

  function heightAt(lon, lat) {
    const z = MR.sample("dem", lon, lat);
    const info = getDemInfo();
    const kpu = getKmPerUnit();
    return ((z - info.min) / 1000 / kpu) * exag;
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
    const kpu = getKmPerUnit();
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, ((Z[i] - lo) / 1000 / kpu) * exag);
    }
    geo.computeVertexNormals();

    const baseImg = document.getElementById("basemap");
    if (!S3.textureCanvas || S3.builtRegion !== MR.currentRegion) {
      S3.setTexture(baseImg, null, 1);
    }
    const tex = new THREE.Texture(S3.textureCanvas || baseImg);
    tex.needsUpdate = true;
    tex.anisotropy = 4;
    if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;

    terrain = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ map: tex, emissive: 0x777777, emissiveMap: tex })
    );
    scene.add(terrain);
    S3.builtRegion = MR.currentRegion;
  }

  // Compone mapa base + capa de análisis en una textura
  S3.setTexture = function (baseImg, overlayCanvas, opacity) {
    const c = document.createElement("canvas");
    c.width = c.height = 1200;
    const ctx = c.getContext("2d");
    const isReady = baseImg && (baseImg.complete || baseImg.naturalWidth > 0);
    if (isReady) {
      try {
        ctx.drawImage(baseImg, 0, 0, 1200, 1200);
      } catch (e) {
        /* imagen no disponible aún */
      }
    } else if (baseImg) {
      baseImg.addEventListener("load", function onImgLd() {
        baseImg.removeEventListener("load", onImgLd);
        S3.setTexture(baseImg, overlayCanvas, opacity);
      });
    }
    if (overlayCanvas) {
      ctx.globalAlpha = opacity;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(overlayCanvas, 0, 0, 1200, 1200);
    }
    S3.textureCanvas = c;
    if (terrain && isReady) {
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
      astro = new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.5, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65 }));
      scene.add(astro);
      scene.add(beacon);
    }
    if (st.pos) {
      const p = toXYZ(st.pos[0], st.pos[1], 0.85);
      astro.position.copy(p);
      beacon.position.set(p.x, p.y + 2.25, p.z);
      astro.material.color.set(st.color || "#1E64DC");
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

      const stickH = 3.6;
      const stickR = 0.11;
      const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(stickR, stickR, stickH, 8),
        new THREE.MeshBasicMaterial({ color: c })
      );
      stick.position.set(base.x, base.y + stickH / 2, base.z);

      let head;
      const headY = base.y + stickH + 0.9;
      if (isMin) {
        head = new THREE.Mesh(
          new THREE.OctahedronGeometry(1.2),
          new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.65 })
        );
        head.position.set(base.x, headY, base.z);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.5, 1.3, 16),
          new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(base.x, base.y + 0.1, base.z);
        g.add(ring);
        g.userData = { isMineral: true, mineral: m.mineral || m, onClick: m.onClick, label: m.label };
      } else {
        head = new THREE.Mesh(
          m.type === "meta"
            ? new THREE.ConeGeometry(1.2, 2.2, 6)
            : m.type === "refugio"
            ? new THREE.CylinderGeometry(0.9, 1.0, 1.5, 6)
            : new THREE.OctahedronGeometry(1.0),
          new THREE.MeshBasicMaterial({ color: c })
        );
        head.position.set(base.x, headY, base.z);
        g.userData = { isMineral: false, target: m, onClick: m.onClick, label: m.label };
      }

      g.add(stick);
      g.add(head);
      g._head = head;
      if (isMin) g.visible = mineralsVisible;
      scene.add(g);
      pins.push(g);
    });
  };

  S3.setLayerVisible = function (v) {
    layerVisible = !!v;
    const ov = layerVisible ? document.getElementById("overlay") : null;
    S3.setTexture(document.getElementById("basemap"), ov, 0.7);
  };

  S3.setMineralsVisible = function (v) {
    mineralsVisible = !!v;
    pins.forEach(p => {
      if (p.userData && p.userData.isMineral) {
        p.visible = mineralsVisible;
      }
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
        if (p._head && p.userData && p.userData.isMineral) {
          p._head.rotation.y = tSec;
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
