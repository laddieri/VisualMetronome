import { state } from './state.js';

// ── 3D Conductor: cartoon maestro ────────────────────────────────────────────
// A stylized, friendly cartoon conductor rendered with Three.js on a podium
// under a warm spotlight. Simple dot eyes and brows (no realistic features —
// the earlier realistic attempt was uncanny), a balding crown with a wild
// white side-mane, black tails with a white shirt front and white bow tie.
//
// The body is built from smooth lathed profiles rather than primitives: a
// sculpted coat with the shirt front and satin lapels painted onto its own
// surface, capsule limbs that share a round joint at every bend, hips the
// legs grow out of, and curved coat tails — no flat caps, gaps or floating
// panels, whatever angle the camera orbits to.
//
// The realism budget goes into motion, not the face:
//   • the right hand traces true conducting beat patterns (down/left/right/up
//     figures per meter). Each beat is a bounce: vertically a ballistic arc
//     in time, so the hand snaps off the ictus, floats weightless at the top
//     of the rebound and falls accelerating into the next beat; sideways it
//     curves through the rebound point toward where the next beat lands.
//     The elbow leads, lifting and winging out as the hand rises;
//   • the left hand rests low against the stomach, below the conducting
//     plane so it never obscures the baton, with only a breathing float and
//     a slight downbeat acknowledgment;
//   • a real-time baton spring (tip lags the stroke, whips past at each
//     ictus and settles), slow body sway, brow raises on the
//     downbeat, breathing, blinking and idle micro-motion. Body motion is
//     deliberately not beat-synced — the beat lives in the baton alone.
//
// The camera orbits the podium: drag the canvas (mouse or touch) to change
// the viewing angle within clamped bounds; double-click resets the view.
//
// Selfie mode: the 📷 button (camera module, cameraTarget 'conductor') maps
// the user's photo onto a curved face plate hugging the head; the cartoon
// features hide underneath and return when the selfie is cleared.
// ─────────────────────────────────────────────────────────────────────────────

// Pattern amplitude scales with tempo: bigger, calmer strokes at slow tempos,
// tighter ones when fast — like a real conductor.
function tempoScale(bpm) {
  const s = 1.15 - (bpm - 60) * 0.0032;
  return Math.max(0.65, Math.min(1.15, s));
}

// Height at time t ∈ [0, 1] of a parabola in time that starts at y0, peaks
// at `apex` and ends at y1 — a ball tossed from one ictus to the next under
// constant gravity. Requires apex ≥ max(y0, y1).
function ballisticArc(y0, apex, y1, t) {
  const A = apex - y0;
  const d = y1 - y0;
  // Solve for the bulge h in y0 + (d + 4h)t − 4h·t² so its maximum is apex.
  const h = (2 * A - d + 2 * Math.sqrt(Math.max(0, A * (A - d)))) / 4;
  return y0 + (d + 4 * h) * t - 4 * h * t * t;
}

// ── Orbit camera constants ────────────────────────────────────────────────────
// The camera rides a sphere around the maestro; the user can drag to orbit.
// Angles are clamped so every reachable view stays a good shot: never behind
// him, never under the floor, never bird's-eye.
const CAM_TARGET = { x: 0, y: 1.0, z: 0 };
const CAM_RADIUS = 4.2;
const CAM_DEF_AZIMUTH = -0.15;  // default: slightly toward his baton side
const CAM_DEF_ELEVATION = 0.17; // slightly above eye line
const CAM_AZIMUTH_MAX = 1.2;    // ±69° around the front
const CAM_ELEVATION_MIN = -0.05;
const CAM_ELEVATION_MAX = 0.6;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Height range the coat texture is painted across (torso hem → collar).
const TORSO_UV_Y = [0.73, 1.46];

class Conductor3D {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.container = null;
    // Arm rigs keyed anatomically ('R' = his right, the baton arm, at world
    // −x since he faces the audience). Each rig carries its own `side` so the
    // side→bone mapping exists in exactly one place.
    this.arms = {};
    this.meshes = {};
    this.clock = new THREE.Clock();
    this.initialized = false;
    this.animationFrameId = null;

    // Smoothed motion state. He faces the audience, so his right (baton)
    // hand is at world/screen -x and his left at +x.
    this.smoothR = new THREE.Vector3(-0.14, 0.95, 0.2); // right-hand (baton) target
    this.smoothL = new THREE.Vector3(0.15, 0.96, 0.18); // left-hand target
    this.playBlend = 0;         // 0 at rest → 1 conducting (eased in/out)
    this.currentSway = 0;
    this.currentYaw = 0;
    this.breathPhase = Math.random() * Math.PI * 2;

    // Beat bookkeeping
    this.prevBeatIndex = -1;
    this.measureCount = 0;
    this.ictusPulse = 0;       // 1 at each beat, decays — drives the spotlight breathe only
    this.downbeatPulse = 0;    // same but only on beat 1 — drives brows/left hand

    // Blinking
    this.blinkTimer = 1.5 + Math.random() * 2;
    this.blinkState = 0; // 0 open, >0 = seconds of blink remaining

    // Baton spring-damper (gives the tip mass/inertia)
    this.prevHandPos = null;
    this.batonLagX = 0;
    this.batonLagY = 0;
    this.batonLagVelX = 0;
    this.batonLagVelY = 0;

    // Orbit camera: drag targets + damped actual angles
    this.camAzimuth = CAM_DEF_AZIMUTH;
    this.camElevation = CAM_DEF_ELEVATION;
    this.camAzimuthTarget = CAM_DEF_AZIMUTH;
    this.camElevationTarget = CAM_DEF_ELEVATION;
  }

  // ── Initialization ──────────────────────────────────────────────────────

  init() {
    if (this.initialized) return;

    this.container = document.createElement('div');
    this.container.id = 'conductor3d-container';
    this.container.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:1;display:flex;' +
      'align-items:center;justify-content:center;';

    this.scene = new THREE.Scene();
    this.scene.background = null; // transparent — page/theme background shows through

    // Musician's-eye view by default — slightly toward his baton side and
    // above. The user can drag the canvas to orbit (see _initCameraControls);
    // the position is derived from the orbit angles every frame.
    this.camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 100);
    this._applyCameraOrbit();

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (this.renderer.outputEncoding !== undefined && THREE.sRGBEncoding !== undefined) {
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    if (THREE.ACESFilmicToneMapping !== undefined) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
    }
    this.renderer.domElement.style.borderRadius = '12px';
    this.container.appendChild(this.renderer.domElement);

    this._setupLights();
    this._buildStage();
    this._buildBody();
    this._initCameraControls();

    this.initialized = true;
  }

  // ── Orbit camera ──────────────────────────────────────────────────────────
  // Drag the canvas to orbit around the maestro (mouse or touch); double-click
  // (or double-tap) snaps back to the default angle. The overlay container
  // keeps pointer-events:none, so only the canvas itself captures input.

  _initCameraControls() {
    const el = this.renderer.domElement;
    el.style.pointerEvents = 'auto';
    // One-finger vertical swipes still scroll the page on touch screens;
    // horizontal drags (and mouse drags) orbit.
    el.style.touchAction = 'pan-y';
    el.style.cursor = 'grab';

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      // OrbitControls convention: the scene follows the pointer — dragging
      // right swings the camera left around him, dragging down raises it.
      this.camAzimuthTarget = clamp(
        this.camAzimuthTarget - dx * 0.006, -CAM_AZIMUTH_MAX, CAM_AZIMUTH_MAX);
      this.camElevationTarget = clamp(
        this.camElevationTarget + dy * 0.004, CAM_ELEVATION_MIN, CAM_ELEVATION_MAX);
    });
    const endDrag = () => { dragging = false; el.style.cursor = 'grab'; };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    el.addEventListener('dblclick', () => {
      this.camAzimuthTarget = CAM_DEF_AZIMUTH;
      this.camElevationTarget = CAM_DEF_ELEVATION;
    });
  }

  _applyCameraOrbit(dt) {
    // Damped follow gives the drag (and the reset) a physical glide.
    const k = dt === undefined ? 1 : 1 - Math.exp(-dt / 0.12);
    this.camAzimuth += (this.camAzimuthTarget - this.camAzimuth) * k;
    this.camElevation += (this.camElevationTarget - this.camElevation) * k;

    const az = this.camAzimuth;
    const el = this.camElevation;
    this.camera.position.set(
      CAM_TARGET.x + CAM_RADIUS * Math.sin(az) * Math.cos(el),
      CAM_TARGET.y + CAM_RADIUS * Math.sin(el),
      CAM_TARGET.z + CAM_RADIUS * Math.cos(az) * Math.cos(el)
    );
    this.camera.lookAt(CAM_TARGET.x, CAM_TARGET.y, CAM_TARGET.z);
  }

  // Material colors are authored as sRGB hex; convert to linear so the sRGB
  // output encoding doesn't wash everything out (the old washed-out grey look).
  _mat(hex, opts = {}) {
    const m = new THREE.MeshStandardMaterial({
      roughness: opts.roughness !== undefined ? opts.roughness : 0.85,
      metalness: opts.metalness !== undefined ? opts.metalness : 0.0,
      ...opts
    });
    m.color = new THREE.Color(hex);
    if (m.color.convertSRGBToLinear) m.color.convertSRGBToLinear();
    return m;
  }

  // ── Geometry helpers ─────────────────────────────────────────────────────
  // Everything organic is built from lathed profiles, so parts meet in round
  // joints instead of the flat cylinder caps and gaps of the old model.

  // Smooth lathe: the control points (radius, height; bottom → top) are run
  // through a spline first so the silhouette has no facet kinks. The seam
  // sits at the back (phiStart = π), which puts u = 0.5 at the front. With
  // `uvY` = [yBottom, yTop], v is remapped to true height so a texture can
  // be painted in body coordinates.
  _latheSmooth(ctrl, segments, uvY) {
    const curve = new THREE.SplineCurve(ctrl.map(([r, y]) => new THREE.Vector2(r, y)));
    const pts = curve.getPoints(ctrl.length * 6).map(p => new THREE.Vector2(Math.max(0, p.x), p.y));
    const geo = new THREE.LatheGeometry(pts, segments, Math.PI, Math.PI * 2);
    if (uvY) {
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        uv.setY(i, (pos.getY(i) - uvY[0]) / (uvY[1] - uvY[0]));
      }
    }
    geo.userData.latheRings = pts.length;
    geo.userData.latheSegments = segments;
    return geo;
  }

  // After reshaping a lathe's vertices, recompute normals and weld the seam
  // (its first and last columns are duplicates) so no crease line shows.
  _relightLathe(geo) {
    geo.computeVertexNormals();
    const n = geo.attributes.normal;
    const rings = geo.userData.latheRings;
    const last = geo.userData.latheSegments * rings;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let j = 0; j < rings; j++) {
      a.fromBufferAttribute(n, j);
      b.fromBufferAttribute(n, last + j);
      a.add(b).normalize();
      n.setXYZ(j, a.x, a.y, a.z);
      n.setXYZ(last + j, a.x, a.y, a.z);
    }
    n.needsUpdate = true;
  }

  // Tapered capsule hanging from its pivot: a sphere of rTop centered on the
  // origin, narrowing to a sphere of rBot centered at y = −len. Limbs built
  // from these share a sphere at every joint, so bends never open a gap.
  _capsuleGeo(rTop, rBot, len, segments = 20) {
    const pts = [];
    const K = 8;
    for (let k = 0; k <= K; k++) {
      const a = -Math.PI / 2 + (k / K) * (Math.PI / 2);
      pts.push(new THREE.Vector2(rBot * Math.cos(a), -len + rBot * Math.sin(a)));
    }
    for (let k = 1; k <= K; k++) {
      const a = (k / K) * (Math.PI / 2);
      pts.push(new THREE.Vector2(rTop * Math.cos(a), rTop * Math.sin(a)));
    }
    return new THREE.LatheGeometry(pts, segments);
  }

  // Sculpt the round torso lathe into a tailored figure: broad squared
  // shoulders reaching the arm sockets, a round belly, and a chest that is
  // shallower front-to-back than it is wide.
  _shapeTorso(geo) {
    const pos = geo.attributes.position;
    const smooth = (a, b, v) => {
      const t = clamp((v - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    };
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const up = smooth(1.02, 1.34, y);
      const fx = 1.18 + up * 0.32;
      const fz = 0.96 - up * 0.14;
      let z = pos.getZ(i) * fz;
      // Belly pushes forward a little, the back stays straight.
      if (z > 0) z *= 1 + 0.08 * Math.exp(-(((y - 0.95) / 0.14) ** 2));
      pos.setX(i, pos.getX(i) * fx);
      pos.setZ(i, z);
    }
    pos.needsUpdate = true;
    this._relightLathe(geo);
  }

  // Coat surface texture, painted in torso coordinates (u = angle around the
  // body with the front at 0.5, v = height across TORSO_UV_Y): white shirt
  // front with studs, satin peak lapels, and the coat's front buttons.
  _coatTexture() {
    const W = 1024, H = 1024;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    // θ = angle from the front (+ = his left), y = height in body units.
    const X = th => W * (0.5 + th / (Math.PI * 2));
    const Y = y => H * (1 - (y - TORSO_UV_Y[0]) / (TORSO_UV_Y[1] - TORSO_UV_Y[0]));
    const poly = (pts, fill) => {
      ctx.beginPath();
      pts.forEach(([th, y], i) => (i ? ctx.lineTo(X(th), Y(y)) : ctx.moveTo(X(th), Y(y))));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };

    ctx.fillStyle = '#1b1c22';
    ctx.fillRect(0, 0, W, H);

    // Shirt front: a V from the collar down to the waist.
    const shirt = [[-1.6, 1.5], [-0.62, 1.40], [-0.34, 1.27], [0, 1.0],
      [0.34, 1.27], [0.62, 1.40], [1.6, 1.5]];
    poly(shirt, '#f4f2ec');
    // Soft shading down the shirt's middle so it isn't a flat white decal.
    const g = ctx.createLinearGradient(0, Y(1.46), 0, Y(1.0));
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(120,110,95,0.18)');
    poly(shirt, g);

    // Satin peak lapels following the shirt edge.
    const satin = '#2c2e37';
    for (const s of [-1, 1]) {
      poly([
        [s * 1.6, 1.5], [s * 0.62, 1.40], [s * 0.34, 1.27], [s * 0.02, 1.0],
        [s * 0.16, 0.99], [s * 0.46, 1.17], [s * 0.86, 1.30],  // peak
        [s * 0.70, 1.335], [s * 0.98, 1.40], [s * 2.2, 1.5]    // notch, collar
      ], satin);
    }

    // Shirt studs.
    ctx.fillStyle = '#2a2a30';
    for (const y of [1.30, 1.20, 1.10]) {
      ctx.beginPath();
      ctx.arc(X(0), Y(y), 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Coat buttons below the lapels.
    for (const s of [-1, 1]) {
      for (const y of [0.96, 0.88]) {
        ctx.beginPath();
        ctx.arc(X(s * 0.3), Y(y), 8, 0, Math.PI * 2);
        ctx.fillStyle = '#0c0c10';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(X(s * 0.3) - 2, Y(y) - 2, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#4a4b55';
        ctx.fill();
      }
    }

    const tex = new THREE.CanvasTexture(c);
    if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
    if (this.renderer) tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  // One coat tail (side ±1): a curved panel wrapping the back of the legs,
  // from the waist seam down to the backs of the knees. It tapers toward the
  // center vent as it falls and swings slightly out at the bottom.
  // `yOff` shifts it into the tails pivot group's local space.
  _tailGeo(side, yOff) {
    const NU = 10, NV = 16;
    const pos = [];
    const idx = [];
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      const y = 0.95 - v * 0.55;
      const r = 0.206 + v * 0.02;
      const aIn = 0.05;
      const aOut = 1.3 - 0.8 * Math.pow(v, 0.8);
      for (let i = 0; i <= NU; i++) {
        const a = aIn + (aOut - aIn) * (i / NU);
        // Round off the bottom outer corner.
        const lift = v > 0.8 ? Math.pow((v - 0.8) / 0.2, 2) * (i / NU) * 0.05 : 0;
        pos.push(
          side * Math.sin(a) * r * 1.18,
          y + lift + yOff,
          -Math.cos(a) * r * 0.95 - v * v * 0.015
        );
      }
    }
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        const a = j * (NU + 1) + i, b = a + NU + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  // ── Lighting: warm stage spotlight + soft studio wrap ────────────────────

  _setupLights() {
    const hemi = new THREE.HemisphereLight(0xcdd8ea, 0x35302a, 0.55);
    this.scene.add(hemi);

    // Spotlight from high front — the "stage" light; pulses gently on beats.
    const spot = new THREE.SpotLight(0xffe2b8, 1.0);
    spot.position.set(-0.8, 4.5, 2.6);
    spot.angle = 0.4;
    spot.penumbra = 0.7;
    spot.decay = 0;
    spot.target.position.set(0, 1.0, 0);
    this.scene.add(spot);
    this.scene.add(spot.target);
    this.spot = spot;

    const key = new THREE.DirectionalLight(0xfff2df, 0.7);
    key.position.set(2.2, 3.5, 3.5);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xa9c2ff, 0.3);
    fill.position.set(-2.8, 1.6, 2.2);
    this.scene.add(fill);

    // Rim from behind-right so the white hair and shoulders catch an edge.
    const rim = new THREE.DirectionalLight(0xfff6e6, 0.55);
    rim.position.set(1.6, 2.6, -2.6);
    this.scene.add(rim);
  }

  // ── Stage: floor pool of light, podium, music stand ──────────────────────

  _radialTexture(inner, outer, stops) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, inner, 128, 128, outer);
    for (const [off, color] of stops) g.addColorStop(off, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  _buildStage() {
    // Warm spotlight pool on the floor, fading to transparent so it blends
    // into whatever theme background is behind the canvas.
    const poolTex = this._radialTexture(10, 128, [
      [0, 'rgba(255, 214, 150, 0.55)'],
      [0.45, 'rgba(255, 200, 130, 0.28)'],
      [1, 'rgba(255, 190, 120, 0)']
    ]);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 4.4),
      new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = -0.14;
    this.scene.add(pool);

    // Soft contact shadow under the podium.
    const shadowTex = this._radialTexture(10, 128, [
      [0, 'rgba(20, 16, 12, 0.38)'],
      [0.7, 'rgba(20, 16, 12, 0.14)'],
      [1, 'rgba(20, 16, 12, 0)']
    ]);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 1.7),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.135;
    this.scene.add(shadow);

    // Podium — a low wooden cylinder the maestro stands on. Top at y = 0.
    const podiumSide = this._mat(0x453222, { roughness: 0.8 });
    const podiumTop = this._mat(0x5c422c, { roughness: 0.7 });
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.56, 0.13, 40), podiumSide);
    podium.position.y = -0.065;
    this.scene.add(podium);
    const podiumCap = new THREE.Mesh(new THREE.CylinderGeometry(0.53, 0.52, 0.02, 40), podiumTop);
    podiumCap.position.y = 0.005;
    this.scene.add(podiumCap);

    // Music stand between maestro and audience: pole + tilted desk + score.
    const standGroup = new THREE.Group();
    standGroup.position.set(0.2, 0, 0.72);
    standGroup.rotation.y = Math.PI; // score faces the maestro, back to audience
    this.scene.add(standGroup);
    const standMat = this._mat(0x33363c, { roughness: 0.5, metalness: 0.55 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.72, 10), standMat);
    pole.position.y = 0.24; // base sits on the floor (y −0.12), not the podium
    standGroup.add(pole);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.02, 16), standMat);
    base.position.y = -0.11;
    standGroup.add(base);
    const desk = new THREE.Group();
    desk.position.set(0, 0.62, 0);
    desk.rotation.x = -0.98; // tilted back toward the maestro
    standGroup.add(desk);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.32, 0.014), standMat);
    desk.add(board);
    const paperMat = this._mat(0xf4f1e7, { roughness: 0.85 });
    for (const sx of [-1, 1]) {
      const page = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.26), paperMat);
      page.position.set(sx * 0.105, 0.01, 0.011);
      page.rotation.z = sx * -0.02;
      desk.add(page);
    }
  }

  // ── Build the maestro ────────────────────────────────────────────────────

  _buildBody() {
    const COAT   = 0x17181d; // black tails
    const WHITE  = 0xf7f6f1; // shirt, gloves, bow tie
    const SKIN   = 0xf2c096;
    const HAIR   = 0xece9e3; // wild white mane
    const EYE    = 0x2e241c;

    const bodyGroup = new THREE.Group();
    this.bodyGroup = bodyGroup;
    this.scene.add(bodyGroup);

    // Everything from the waist up lives in its own group so breathing and
    // the beat "give" can move the torso WITHOUT moving the feet — bouncing
    // the whole model made the shoes slide through the podium on every beat.
    const upperBody = new THREE.Group();
    this.upperBody = upperBody;
    bodyGroup.add(upperBody);

    const coatMat = this._mat(COAT, { roughness: 0.88 });
    const whiteMat = this._mat(WHITE, { roughness: 0.55 });
    const skinMat = this._mat(SKIN, { roughness: 0.65 });
    const hairMat = this._mat(HAIR, { roughness: 0.95 });
    this._skinMat = skinMat;
    this._whiteMat = whiteMat;
    this._coatMat = coatMat;

    // ── Legs, hips + shoes ──
    // Trousers are one continuous piece: a rounded hip block the legs grow
    // out of, so there is no gap or hard edge where the coat hem ends. These
    // stay in bodyGroup (planted); the coat hem overlaps the hips so the
    // torso's slow sway never opens a seam.
    const trouserMat = this._mat(0x1f2027, { roughness: 0.8 });
    const hipsGeo = this._latheSmooth([
      [0.0, 0.67], [0.08, 0.675], [0.125, 0.70], [0.145, 0.745],
      [0.152, 0.8], [0.15, 0.86], [0.0, 0.88]
    ], 28);
    hipsGeo.scale(1.12, 1, 0.82);
    bodyGroup.add(new THREE.Mesh(hipsGeo, trouserMat));
    const shoeMat = this._mat(0x0e0e12, { roughness: 0.3 });
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(this._capsuleGeo(0.072, 0.056, 0.66), trouserMat);
      leg.position.set(s * 0.086, 0.75, 0);
      bodyGroup.add(leg);
      const shoeGeo = new THREE.SphereGeometry(0.064, 18, 12);
      shoeGeo.scale(1.0, 0.62, 1.75);
      const shoe = new THREE.Mesh(shoeGeo, shoeMat);
      shoe.position.set(s * 0.09, 0.04, 0.045);
      bodyGroup.add(shoe);
    }

    // ── Torso — one smooth sculpted coat from hem to collar ──
    // The shirt front, satin lapels and studs are painted onto the coat's own
    // surface (see _coatTexture), so they follow every curve of the chest
    // instead of floating as separate flat pieces. Each ring is then
    // reshaped: square-ish shoulders that reach the arm sockets, a deep
    // rounded belly, and a chest flattened front-to-back.
    const torsoGeo = this._latheSmooth([
      [0.0, 0.742], [0.12, 0.744], [0.17, 0.75], [0.182, 0.775],
      [0.194, 0.9], [0.197, 1.02], [0.188, 1.17], [0.176, 1.29],
      [0.148, 1.375], [0.094, 1.435], [0.062, 1.46]
    ], 40, TORSO_UV_Y);
    this._shapeTorso(torsoGeo);
    const torso = new THREE.Mesh(torsoGeo, this._mat(0xffffff, {
      roughness: 0.8,
      map: this._coatTexture()
    }));
    upperBody.add(torso);

    // Shoulder caps: round the coat over each arm socket so the sleeve grows
    // out of the body (the arm's own top is a sphere on the same pivot).
    for (const s of [-1, 1]) {
      const capGeo = new THREE.SphereGeometry(0.07, 20, 16);
      capGeo.scale(1.0, 0.78, 1.0);
      const cap = new THREE.Mesh(capGeo, coatMat);
      cap.position.set(s * 0.218, 1.328, 0.022);
      upperBody.add(cap);
    }

    // White wing collar around the neck.
    const collarGeo = new THREE.CylinderGeometry(0.066, 0.072, 0.05, 20, 1, true);
    const collar = new THREE.Mesh(collarGeo, this._mat(0xf7f6f1, { roughness: 0.55, side: THREE.DoubleSide }));
    collar.position.set(0, 1.465, 0.012);
    upperBody.add(collar);

    // White bow tie (white tie goes with tails) — two rounded wings + a knot.
    const tieGroup = new THREE.Group();
    tieGroup.position.set(0, 1.435, 0.085);
    tieGroup.rotation.x = -0.25;
    upperBody.add(tieGroup);
    for (const s of [-1, 1]) {
      const wingGeo = new THREE.SphereGeometry(0.029, 14, 10);
      wingGeo.scale(1.25, 0.85, 0.5);
      const wing = new THREE.Mesh(wingGeo, whiteMat);
      wing.position.x = s * 0.034;
      wing.rotation.z = s * 0.25;
      tieGroup.add(wing);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), whiteMat);
    knot.scale.set(1, 1, 0.75);
    knot.position.z = 0.004;
    tieGroup.add(knot);

    // Coat tails: two curved panels wrapping the back of the legs, hung from
    // the waist on a pivot so they can swing. They taper toward the vent and
    // follow the coat's curvature instead of being flat cutouts.
    const tailsGroup = new THREE.Group();
    tailsGroup.position.set(0, 0.92, 0);
    upperBody.add(tailsGroup);
    this.meshes.tails = tailsGroup;
    const tailMat = this._mat(COAT, { roughness: 0.85, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      tailsGroup.add(new THREE.Mesh(this._tailGeo(s, -0.92), tailMat));
    }

    // ── Neck + head ──
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.064, 0.12, 16), skinMat);
    neck.position.set(0, 1.49, 0.012);
    upperBody.add(neck);

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.6, 0.02);
    upperBody.add(headGroup);
    this.meshes.headGroup = headGroup;

    const headGeo = new THREE.SphereGeometry(0.165, 32, 26);
    headGeo.scale(0.92, 1.06, 0.94);
    headGroup.add(new THREE.Mesh(headGeo, skinMat));

    // Ears (mostly under the mane)
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), skinMat);
      ear.position.set(s * 0.148, -0.015, 0.005);
      ear.scale.set(0.55, 0.85, 0.65);
      headGroup.add(ear);
    }

    // Cartoon features are collected so selfie mode can swap them for the
    // user's photo (and back) without rebuilding the head.
    this.meshes.faceFeatures = [];

    // Nose — friendly round bulb.
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 12), this._mat(0xeba97e, { roughness: 0.6 }));
    nose.position.set(0, -0.02, 0.152);
    headGroup.add(nose);
    this.meshes.faceFeatures.push(nose);

    // Dot eyes (scaled to blink) + expressive silver brows.
    const eyeMat = this._mat(EYE, { roughness: 0.35 });
    this.meshes.eyes = [];
    this.meshes.brows = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 10), eyeMat);
      eye.position.set(s * 0.058, 0.028, 0.138);
      headGroup.add(eye);
      this.meshes.eyes.push(eye);
      this.meshes.faceFeatures.push(eye);

      const browGeo = new THREE.SphereGeometry(0.026, 10, 8);
      browGeo.scale(1, 0.32, 0.45); // stretched sphere → rounded bushy brow
      const brow = new THREE.Mesh(browGeo, this._mat(0xdcd8d1, { roughness: 0.9 }));
      brow.rotation.z = s * 0.18;
      brow.position.set(s * 0.06, 0.082, 0.142);
      headGroup.add(brow);
      this.meshes.brows.push({ mesh: brow, baseY: 0.082, baseTilt: s * 0.18, side: s });
      this.meshes.faceFeatures.push(brow);
    }

    // Gentle smile — thin torus arc.
    const smileGeo = new THREE.TorusGeometry(0.036, 0.006, 8, 20, Math.PI * 0.75);
    const smile = new THREE.Mesh(smileGeo, this._mat(0x9c5a48, { roughness: 0.6 }));
    smile.position.set(0, -0.062, 0.132);
    smile.rotation.z = Math.PI + Math.PI * 0.125; // arc opens upward
    smile.rotation.x = -0.25;
    headGroup.add(smile);
    this.meshes.faceFeatures.push(smile);

    // Selfie face plate — a curved cap hugging the front of the head, hidden
    // until the user captures a selfie (📷 button). The photo is applied with
    // a feathered circular mask so it blends into the skin, and the hair
    // still frames it. Slightly larger radius than the head so it sits proud.
    const plateGeo = new THREE.SphereGeometry(
      0.169, 48, 48,
      Math.PI / 2 - 0.85, 1.7,   // phi: ±49° around the front (+z)
      Math.PI / 2 - 0.85, 1.7    // theta: ±49° around the equator
    );
    plateGeo.scale(0.92, 1.06, 0.94); // match the head's egg shape
    const plateMat = new THREE.MeshStandardMaterial({
      roughness: 0.85,
      transparent: true
    });
    const facePlate = new THREE.Mesh(plateGeo, plateMat);
    facePlate.visible = false;
    headGroup.add(facePlate);
    this.meshes.facePlate = facePlate;

    // Wild white mane: balding on top, big puffs at the sides and back —
    // instantly reads "maestro" with zero uncanny valley.
    const tufts = [
      // [x, y, z, r, sx, sy, sz]
      [-0.155, 0.035, -0.02, 0.085, 1.25, 1.0, 1.15],
      [ 0.155, 0.035, -0.02, 0.085, 1.25, 1.0, 1.15],
      [-0.20, 0.09, -0.05, 0.055, 1.3, 0.9, 1.0],
      [ 0.20, 0.09, -0.05, 0.055, 1.3, 0.9, 1.0],
      [-0.185, -0.03, -0.06, 0.05, 1.2, 0.9, 1.1],
      [ 0.185, -0.03, -0.06, 0.05, 1.2, 0.9, 1.1],
      [ 0, 0.02, -0.145, 0.105, 1.25, 1.05, 0.85],
      [-0.09, 0.10, -0.115, 0.075, 1.1, 0.9, 1.0],
      [ 0.09, 0.10, -0.115, 0.075, 1.1, 0.9, 1.0],
      [ 0, 0.145, -0.09, 0.065, 1.15, 0.75, 1.0]
    ];
    for (const [x, y, z, r, sx, sy, sz] of tufts) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), hairMat);
      tuft.position.set(x, y, z);
      tuft.scale.set(sx, sy, sz);
      headGroup.add(tuft);
    }

    // ── Baton (parented to the right hand when the arm is built) ──
    const batonGroup = new THREE.Group();
    const shaftGeo = new THREE.CylinderGeometry(0.006, 0.0075, 0.38, 8);
    shaftGeo.rotateX(Math.PI / 2);           // shaft along +Z (out of the fist)
    shaftGeo.translate(0, 0, 0.19);
    const shaft = new THREE.Mesh(shaftGeo, this._mat(0xf3eede, { roughness: 0.35 }));
    batonGroup.add(shaft);
    const bulbGeo = new THREE.SphereGeometry(0.017, 10, 8);
    bulbGeo.scale(1, 1, 1.5);
    const bulb = new THREE.Mesh(bulbGeo, this._mat(0xb98d5f, { roughness: 0.75 })); // cork grip
    batonGroup.add(bulb);
    this.meshes.baton = batonGroup;

    // ── Arms (side −1 = his right hand, at screen-left — carries the baton) ──
    this._buildArm(upperBody, 1);
    this._buildArm(upperBody, -1);
  }

  _buildArm(parent, side) {
    const shoulderGroup = new THREE.Group();
    shoulderGroup.position.set(side * 0.235, 1.335, 0.03);
    parent.add(shoulderGroup);

    const upperArmGroup = new THREE.Group();
    shoulderGroup.add(upperArmGroup);

    // Upper arm and forearm are capsules sharing a 0.05 sphere at the elbow,
    // and the upper arm's top sphere sits on the shoulder pivot inside the
    // shoulder cap — so the sleeve stays one continuous tube at any bend.
    upperArmGroup.add(new THREE.Mesh(this._capsuleGeo(0.057, 0.05, 0.30), this._coatMat));

    const elbowGroup = new THREE.Group();
    elbowGroup.position.set(0, -0.30, 0);
    upperArmGroup.add(elbowGroup);

    // Forearm: rounded at the elbow, tapering to an open-looking sleeve end
    // with the white shirt cuff showing below it.
    const sleevePts = [[0.0, -0.236], [0.036, -0.238], [0.045, -0.232], [0.046, -0.215]];
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * (Math.PI / 2);
      sleevePts.push([0.05 * Math.cos(a), 0.05 * Math.sin(a)]);
    }
    const sleeveGeo = new THREE.LatheGeometry(sleevePts.map(([r, y]) => new THREE.Vector2(r, y)), 20);
    elbowGroup.add(new THREE.Mesh(sleeveGeo, this._coatMat));

    const cuff = new THREE.Mesh(this._capsuleGeo(0.037, 0.035, 0.03, 18), this._whiteMat);
    cuff.position.y = -0.232;
    cuff.scale.y = 0.9;
    elbowGroup.add(cuff);

    const wristGroup = new THREE.Group();
    wristGroup.position.set(0, -0.28, 0);
    elbowGroup.add(wristGroup);

    // White glove — pops against the black coat so the motion reads from
    // across a room. A rounded palm with a hint of knuckles plus a thumb.
    const palmGeo = new THREE.SphereGeometry(0.04, 18, 14);
    palmGeo.scale(0.95, 1.15, 0.72);
    const palm = new THREE.Mesh(palmGeo, this._whiteMat);
    palm.position.y = -0.028;
    wristGroup.add(palm);
    const knucklesGeo = new THREE.SphereGeometry(0.033, 16, 12);
    knucklesGeo.scale(1.05, 0.8, 0.85);
    const knuckles = new THREE.Mesh(knucklesGeo, this._whiteMat);
    knuckles.position.set(0, -0.058, 0.008);
    wristGroup.add(knuckles);
    const thumb = new THREE.Mesh(this._capsuleGeo(0.015, 0.013, 0.03, 12), this._whiteMat);
    thumb.position.set(side * -0.03, -0.012, 0.014);
    thumb.rotation.set(-0.5, 0, side * 0.6);
    wristGroup.add(thumb);

    if (side === -1 && this.meshes.baton) {
      wristGroup.add(this.meshes.baton);
      this.meshes.baton.position.set(0, -0.045, 0.03);
    }

    // Keys are anatomical: he faces the audience, so his Right arm is side −1.
    // The rig records its own side — every consumer reads it from here instead
    // of re-deriving it (a duplicated side→key ternary once cross-wired the
    // arms so the left hand performed the baton motion).
    const key = side === -1 ? 'R' : 'L';
    this.arms[key] = {
      side,
      shoulder: shoulderGroup,
      upperArm: upperArmGroup,
      elbow: elbowGroup,
      wrist: wristGroup
    };
  }

  // ── Conducting patterns ───────────────────────────────────────────────────
  // Right-hand beat figures. Each beat: ictus (where the beat lands) and
  // rebound (the control point the hand floats through after the beat).
  // The tables are authored in the conductor's OWN frame (+x = his left,
  // labels "left"/"right" are his); P() mirrors x into world space, where
  // his right (baton) hand lives at −x. So beat 2 of 4/4 crosses toward his
  // left, which the audience sees as screen-right — true right-handed form.

  get3DPattern() {
    const n = state.beatsPerMeasure;
    // z − 0.06: the conducting plane sits close to the chest so the arm's
    // reach budget goes into stroke width/height instead of forward extension.
    // z − 0.12 pulls the conducting plane close to the chest: targets near
    // full arm extension leave the elbow no bend and it collapses inward.
    const P = (ix, iy, iz, rx, ry, rz) => ({ ictus: [-ix, iy, iz - 0.12], rebound: [-rx, ry, rz - 0.12] });
    const patterns = {
      1: [P(0.12, 0.90, 0.42,   0.12, 1.50, 0.32)],
      2: [
        P(0.10, 0.90, 0.42,   0.22, 1.12, 0.38),  // down → rebound up-right
        P(0.16, 1.10, 0.40,   0.06, 1.50, 0.30)   // up   → BIG prep rebound
      ],
      3: [
        P(0.08, 0.88, 0.42,   0.24, 1.10, 0.38),  // down  → rebound up-right
        P(0.36, 0.98, 0.40,   0.30, 1.20, 0.36),  // right → rebound up
        P(0.18, 1.12, 0.40,   0.08, 1.52, 0.30)   // up    → BIG prep rebound
      ],
      4: [
        P(0.10, 0.88, 0.42,  -0.06, 1.10, 0.38),  // down  → rebound up-left
        P(-0.14, 0.95, 0.40,  0.04, 1.14, 0.36),  // left  → rebound up-center
        P(0.36, 0.98, 0.40,   0.30, 1.18, 0.36),  // right → rebound up
        P(0.16, 1.10, 0.40,   0.08, 1.52, 0.30)   // up    → BIG prep rebound
      ],
      5: [
        P(0.10, 0.88, 0.42,  -0.08, 1.10, 0.38),
        P(-0.14, 0.95, 0.40,  0.02, 1.12, 0.36),
        P(0.12, 0.94, 0.41,   0.24, 1.14, 0.37),
        P(0.34, 0.98, 0.40,   0.28, 1.18, 0.36),
        P(0.16, 1.10, 0.40,   0.08, 1.52, 0.30)
      ],
      6: [
        P(0.10, 0.88, 0.42,  -0.02, 1.06, 0.39),  // German six
        P(-0.10, 0.92, 0.41, -0.10, 1.08, 0.38),
        P(-0.16, 0.98, 0.40,  0.04, 1.14, 0.37),
        P(0.34, 0.98, 0.40,   0.30, 1.14, 0.37),
        P(0.28, 1.02, 0.40,   0.22, 1.16, 0.36),
        P(0.15, 1.10, 0.40,   0.06, 1.52, 0.30)
      ]
    };
    if (patterns[n]) return patterns[n];

    // 7+ beats: down on 1, alternate inner-left/outer-right, up on the last.
    const pts = [P(0.10, 0.88, 0.42, -0.06, 1.08, 0.38)];
    for (let i = 1; i < n - 1; i++) {
      const x = (i % 2 === 1) ? -0.13 : 0.30;
      pts.push(P(x, 0.95, 0.40, x * 0.7, 1.13, 0.37));
    }
    pts.push(P(0.16, 1.10, 0.40, 0.08, 1.52, 0.30));
    return pts;
  }

  // ── Current beat state from the transport clock ──────────────────────────

  _getConductingState() {
    const pattern = this.get3DPattern();
    const n = pattern.length;
    const playing = typeof Tone !== 'undefined'
      && Tone.Transport.state === 'started'
      && state.lastBeatTime > 0;

    if (!playing) {
      return { playing: false, pos: null, fromIdx: 0, t: 0, measureProgress: 0 };
    }

    // Same clock math as stage.getAnimationProgress(): secondsPerBeat is set
    // atomically with lastBeatTime on each beat, so it stays correct through
    // tempo ramps and two-measure patterns.
    const beatDuration = state.secondsPerBeat || (60 / (Tone.Transport.bpm.value || 96));
    const timeSinceLastBeat = Tone.now() - state.lastBeatTime - (state.bluetoothDelay / 1000);

    let progress, effectiveAnimBeat;
    if (timeSinceLastBeat < 0) {
      progress = (timeSinceLastBeat + beatDuration) / beatDuration;
      if (progress < 0) progress = 0;
      effectiveAnimBeat = state.animBeat - 1;
    } else {
      progress = Math.min(timeSinceLastBeat / beatDuration, 1);
      effectiveAnimBeat = state.animBeat;
    }

    const lastFired = (effectiveAnimBeat - 1 + state.beatsPerMeasure) % state.beatsPerMeasure;
    const fromIdx = lastFired % n;
    const toIdx = (fromIdx + 1) % n;

    // Each beat is a bounce. Vertically the hand follows a ballistic arc
    // in time (a parabola): it leaves the ictus at full speed, decelerates
    // to a weightless float at the top of the rebound, and falls
    // accelerating into the next ictus, where the direction reverses
    // instantly — the "click" that makes a beat readable. Sideways and in
    // depth it travels along a quadratic Bézier through the rebound point,
    // so the stroke curves toward where the next beat lands.
    const t = progress;

    // Pattern points are scaled around a pivot so strokes shrink at fast
    // tempos and open up at slow ones, then shifted toward the right
    // shoulder so strokes stay beside the body, not across it.
    const scale = tempoScale(state.cachedBPM || 96);
    const pivot = [-0.12, 1.08, 0.28];
    const OFFSET = [-0.08, 0.06, 0];
    // Horizontal strokes get an extra boost so left/right beats read clearly;
    // vertical amplitude is trimmed so the lowest ictus keeps elbow bend.
    const AXIS = [1.15, 0.95, 1.0];
    const sp = (v, i) => pivot[i] + (v - pivot[i]) * scale * AXIS[i] + OFFSET[i];
    const p0 = pattern[fromIdx].ictus.map(sp);
    const p1 = pattern[fromIdx].rebound.map(sp);
    const p2 = pattern[toIdx].ictus.map(sp);
    const mt = 1 - t;
    const bez = i => mt * mt * p0[i] + 2 * mt * t * p1[i] + t * t * p2[i];

    // Rebound apex: the height the pattern's rebound point implies, but
    // always a clear bounce above the higher ictus — when the next beat
    // lands higher than this one (3 → 4 in 4/4) a shallow apex made the hand
    // drift up and stall into the beat with no click at all.
    const minBounce = 0.05 * scale;
    const apex = Math.max(0.25 * p0[1] + 0.5 * p1[1] + 0.25 * p2[1],
      Math.max(p0[1], p2[1]) + minBounce);
    const y = ballisticArc(p0[1], apex, p2[1], t);

    const pos = [bez(0), y, bez(2)];

    return {
      playing: true,
      pos,
      fromIdx,
      n,
      t,
      progress,
      measureProgress: (fromIdx + progress) / n
    };
  }

  // ── 2-bone arm IK ─────────────────────────────────────────────────────────
  // Solved entirely in bodyGroup-LOCAL space, where the shoulder pivot is a
  // fixed point. (Solving in world space while the body sways/breathes made
  // every solve slightly wrong in a pose-dependent way — the source of a long
  // series of elbow oddities.) Hand targets are given in world space, so the
  // hands stay pinned to the beat pattern while the body moves underneath.

  _poseArm(key, targetWorld, beatT) {
    const rig = this.arms[key];
    if (!rig) return;
    const side = rig.side;

    const upperLen = 0.30;  // must match elbow group offset in _buildArm
    const lowerLen = 0.28;  // must match wrist group offset in _buildArm
    const shoulder = new THREE.Vector3(side * 0.235, 1.335, 0.03);

    // World → upperBody-local (its matrixWorld is refreshed in _applyPose
    // right after the body transform is set, before the arms are posed).
    // The arms are children of upperBody, so breathing/beat-give of the torso
    // is compensated automatically and the hands stay pinned to the pattern.
    const toTarget = this.upperBody.worldToLocal(targetWorld.clone()).sub(shoulder);

    // Keep the target inside 94% of full extension: a near-straight arm has
    // no bend left, and the elbow visually collapses against the torso. The
    // pattern is tuned to stay inside this, so the clamp is a safety net.
    // How high the hand is relative to its usual beat height, and how far it
    // has crossed toward the body's midline — both lift the elbow (below).
    const lift = clamp((toTarget.y + 0.4) / 0.5, 0, 1);
    const cross = clamp((-toTarget.x * side - 0.1) / 0.25, 0, 1);

    let dist = toTarget.length();
    const maxReach = (upperLen + lowerLen) * 0.94;
    dist = Math.max(0.15, Math.min(maxReach, dist));
    const u = toTarget.normalize();

    const proj = (upperLen * upperLen - lowerLen * lowerLen + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, upperLen * upperLen - proj * proj));

    // Elbow hint: out to the side, below and slightly behind the shoulder —
    // the "holding a beach ball" carriage. A fixed hint made the elbow a
    // hinge pinned in place, with the forearm doing all the work; real
    // conductors lead with the upper arm, so the elbow floats up and out as
    // the hand rises and swings out further as it crosses the body.
    const pole = new THREE.Vector3(
      side * (0.55 + 0.12 * lift + 0.1 * cross),
      -0.33 + 0.24 * lift + 0.08 * cross,
      -0.22 + 0.06 * lift
    ).normalize();
    const v = pole.sub(u.clone().multiplyScalar(pole.dot(u)));
    if (v.lengthSq() < 1e-6) v.set(side, 0, 0);
    v.normalize();

    // Elbow and wrist positions relative to the shoulder, in body-local space.
    const elbowRel = u.clone().multiplyScalar(proj).add(v.multiplyScalar(h));
    const wristRel = u.clone().multiplyScalar(dist);

    // Bones hang along local −Y; shoulder/elbow groups live in unrotated
    // parents within bodyGroup, so these local-space quaternions are exact.
    const DOWN = new THREE.Vector3(0, -1, 0);
    const upperDir = elbowRel.clone().normalize();
    rig.upperArm.quaternion.setFromUnitVectors(DOWN, upperDir);

    const foreDir = wristRel.sub(elbowRel).normalize();
    const foreDirLocal = foreDir.applyQuaternion(rig.upperArm.quaternion.clone().invert());
    rig.elbow.quaternion.setFromUnitVectors(DOWN, foreDirLocal);

    if (key === 'R') {
      // Baton wrist: flick that peaks mid-rebound, settles into the next ictus.
      rig.wrist.rotation.set(-0.15 + Math.sin(beatT * Math.PI) * 0.18, 0, 0);
    } else {
      rig.wrist.rotation.set(-0.35, side * -0.2, 0); // palm angled in, held calm
    }
  }

  // Baton inertia: the tip lags the hand through fast strokes and whips
  // past it when the hand reverses at an ictus, then settles with a small
  // wobble. The baton is aimed in WORLD space (near-horizontal, wherever
  // the arm is) — a real conductor's wrist keeps the stick pointed at the
  // orchestra even as the arm sweeps.
  //
  // The lag is a damped spring integrated in real time (fixed substeps), so
  // it behaves the same at any frame rate; the old per-frame spring was
  // stiffer or looser with the frame rate and jittered on uneven frames.
  _updateBatonDrag(pos, dt, playing) {
    if (!this.meshes.baton) return;
    if (!this.prevHandPos) {
      this.prevHandPos = pos.clone();
      this.handVel = new THREE.Vector3();
    }
    if (dt > 0) {
      const vel = new THREE.Vector3().subVectors(pos, this.prevHandPos).divideScalar(dt);
      this.handVel.lerp(vel, 1 - Math.exp(-dt / 0.025));
    }
    this.prevHandPos.copy(pos);

    // Radians of lag per m/s of hand speed: vertical strokes pitch the tip,
    // horizontal strokes yaw it.
    const GAIN = 0.06;
    const targetX = clamp(this.handVel.y * GAIN, -0.45, 0.45);
    const targetY = clamp(-this.handVel.x * GAIN, -0.45, 0.45);
    const W0 = 15, ZETA = 0.45; // natural frequency (rad/s), damping ratio
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.batonLagVelX += (W0 * W0 * (targetX - this.batonLagX) - 2 * ZETA * W0 * this.batonLagVelX) * h;
      this.batonLagVelY += (W0 * W0 * (targetY - this.batonLagY) - 2 * ZETA * W0 * this.batonLagVelY) * h;
      this.batonLagX += this.batonLagVelX * h;
      this.batonLagY += this.batonLagVelY * h;
    }
    this.batonLagX = clamp(this.batonLagX, -0.6, 0.6);
    this.batonLagY = clamp(this.batonLagY, -0.6, 0.6);

    // Base attitude: while conducting the stick rides just above horizontal,
    // an extension of the forearm; at rest it relaxes tip-down. Yawed INWARD
    // (tip toward the left hand, +x) like a real grip — which also keeps it
    // off the camera axis so it doesn't foreshorten to a dot.
    const basePitch = playing ? -0.32 : 0.5;
    this.batonPitch = this.batonPitch === undefined ? basePitch : this.batonPitch;
    this.batonPitch += (basePitch - this.batonPitch) * Math.min(1, dt * 4);

    const wrist = this.arms.R && this.arms.R.wrist;
    if (!wrist) return;
    wrist.updateWorldMatrix(true, false);
    const wq = new THREE.Quaternion();
    wrist.getWorldQuaternion(wq);
    const desired = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.batonPitch + this.batonLagX, 0.55 + this.batonLagY, 0)
    );
    this.meshes.baton.quaternion.copy(wq.invert().multiply(desired));
  }

  // ── Per-frame pose ────────────────────────────────────────────────────────

  _applyPose(cs, dt) {
    const t = this.clock.elapsedTime;

    // Beat/downbeat pulses (decay ~6/s) — set on beat transitions.
    if (cs.playing && cs.fromIdx !== this.prevBeatIndex) {
      if (this.prevBeatIndex !== -1) {
        this.ictusPulse = 1;
        if (cs.fromIdx === 0) { this.downbeatPulse = 1; this.measureCount++; }
      }
      this.prevBeatIndex = cs.fromIdx;
    }
    if (!cs.playing) this.prevBeatIndex = -1;
    this.ictusPulse = Math.max(0, this.ictusPulse - dt * 5);
    this.downbeatPulse = Math.max(0, this.downbeatPulse - dt * 3);

    // ── Right-hand (baton, at −x) target ──
    const restR = new THREE.Vector3(-0.17, 0.92, 0.24);
    const targetR = cs.playing
      ? new THREE.Vector3(cs.pos[0], cs.pos[1], cs.pos[2])
      : restR;

    // ── Left-hand (at +x) target: parked low against the stomach ──
    // It stays well below the conducting plane so it never blocks the baton
    // (chest-height gestures kept drifting into the beat pattern's lane).
    // Only a breathing float and a barely-there downbeat acknowledgment.
    const targetL = new THREE.Vector3(0.13, 0.95, 0.24);
    if (cs.playing) {
      targetL.y += Math.sin(this.breathPhase * 2) * 0.008;
      let lift = 0;
      if (cs.fromIdx === cs.n - 1) lift = cs.progress;       // rising into 1
      else if (cs.fromIdx === 0) lift = 1 - cs.progress;     // settling after 1
      targetL.y += lift * 0.025;
    } else {
      targetL.set(0.16, 0.9, 0.2); // resting at the side
    }

    // Start/stop: ease between the rest pose and the pattern over ~0.4 s
    // instead of snapping. While conducting the hand follows the pattern
    // almost exactly (a 12 ms filter only hides meter-change pops) — a
    // heavier filter made every ictus land visibly after the click.
    const blendTarget = cs.playing ? 1 : 0;
    this.playBlend += Math.sign(blendTarget - this.playBlend) * Math.min(Math.abs(blendTarget - this.playBlend), dt / 0.4);
    const b = this.playBlend * this.playBlend * (3 - 2 * this.playBlend);
    const blendedR = restR.clone().lerp(targetR, cs.playing ? b : 0);
    const k = 1 - Math.exp(-dt / (cs.playing ? 0.012 : 0.09));
    this.smoothR.lerp(blendedR, k);
    this.smoothL.lerp(targetL, 1 - Math.exp(-dt / 0.08));

    // ── Body language ── (baton hand's neutral x is −0.2)
    const handX = this.smoothR.x;
    const swayTarget = cs.playing ? -(handX + 0.2) * 0.10 : 0;
    const yawTarget = cs.playing ? -(handX + 0.2) * 0.14 : 0;
    this.currentSway += (swayTarget - this.currentSway) * Math.min(1, dt * 4);
    this.currentYaw += (yawTarget - this.currentYaw) * Math.min(1, dt * 4);

    this.breathPhase += dt * (cs.playing ? 1.3 : 0.9);
    const breath = Math.sin(this.breathPhase) * 0.006;
    const idleYaw = Math.sin(t * 0.31) * 0.03 + Math.sin(t * 0.83 + 1.3) * 0.01;
    const idlePitch = Math.sin(t * 0.47) * 0.015;

    // All body language lives on upperBody: sway/yaw lean the torso from the
    // hips and breathing raises it, while the legs and shoes stay perfectly
    // planted. Body motion is deliberately NOT beat-synced — a per-beat dip
    // and head-nod pulse read as a distracting bounce; the beat lives in the
    // baton, and the body just carries slow weight and breath.
    this.upperBody.rotation.z = this.currentSway;
    this.upperBody.rotation.y = this.currentYaw + (cs.playing ? 0 : idleYaw * 0.6);
    this.upperBody.position.y = breath;

    // Head: leads the baton slightly, wanders when idle.
    const head = this.meshes.headGroup;
    head.rotation.x = cs.playing ? -0.04 : idlePitch;
    head.rotation.y = (cs.playing ? (handX + 0.2) * 0.3 : idleYaw);
    head.rotation.z = -this.currentSway * 0.5;

    // Brows: pop on the downbeat.
    const browLift = this.downbeatPulse * 0.016;
    for (const b of this.meshes.brows) {
      b.mesh.position.y = b.baseY + browLift;
      b.mesh.rotation.z = b.baseTilt + b.side * this.downbeatPulse * 0.12;
    }

    // Blinking.
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkState = 0.12;
      this.blinkTimer = 2.2 + Math.random() * 2.8;
    }
    if (this.blinkState > 0) this.blinkState -= dt;
    const eyeScaleY = this.blinkState > 0 ? 0.12 : 1;
    for (const e of this.meshes.eyes) e.scale.y += (eyeScaleY - e.scale.y) * Math.min(1, dt * 40);

    // Coat tails swing gently against the sway and the dip.
    if (this.meshes.tails) {
      this.meshes.tails.rotation.z = -this.currentSway * 0.8;
      this.meshes.tails.rotation.x = 0.05;
    }

    // Spotlight breathes with the beat.
    if (this.spot) this.spot.intensity = 1.0 + this.ictusPulse * 0.22;

    // ── Arms ──
    // Body transform is final at this point — refresh the world matrix so the
    // arm solver's world→local conversion sees the pose being rendered.
    this.upperBody.updateWorldMatrix(true, false);
    this._poseArm('R', this.smoothR, cs.playing ? cs.t : 0); // his right = baton
    this._poseArm('L', this.smoothL, 0);
    this._updateBatonDrag(this.smoothR, dt, cs.playing);
  }

  // ── Selfie face ───────────────────────────────────────────────────────────
  // Watches state.conductorSelfieImageDataURL (set by the camera module when
  // the 📷 button captures with cameraTarget 'conductor'). When it changes,
  // the photo is masked to a feathered circle and applied to the face plate;
  // the cartoon features hide underneath. Clearing the URL restores them.

  _syncSelfie() {
    const src = state.conductorSelfieImageDataURL || null;
    if (src === this._selfieSrc) return;
    this._selfieSrc = src;

    const plate = this.meshes.facePlate;
    if (!plate) return;

    if (!src) {
      plate.visible = false;
      for (const f of this.meshes.faceFeatures) f.visible = true;
      if (plate.material.map) { plate.material.map.dispose(); plate.material.map = null; }
      plate.material.needsUpdate = true;
      return;
    }

    const img = new Image();
    img.onload = () => {
      if (this._selfieSrc !== src) return; // a newer selfie replaced this one
      // Feathered circular mask: opaque face, soft edge fading into the skin.
      const size = 512;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size); // capture is already square
      ctx.globalCompositeOperation = 'destination-in';
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.8, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);

      const tex = new THREE.CanvasTexture(c);
      if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
      if (plate.material.map) plate.material.map.dispose();
      plate.material.map = tex;
      plate.material.needsUpdate = true;
      plate.visible = true;
      for (const f of this.meshes.faceFeatures) f.visible = false;
    };
    img.src = src;
  }

  // ── Frame loop ────────────────────────────────────────────────────────────

  update() {
    if (!this.initialized) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this._ensureParent();
    this._updateSize();
    this._syncSelfie();
    this._applyCameraOrbit(dt);
    this._applyPose(this._getConductingState(), dt);
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (!this.initialized) this.init();
    if (this.animationFrameId) return;
    if (this.container) this.container.style.display = '';
    requestAnimationFrame(() => { this._ensureParent(); this._updateSize(); this._loop(); });
  }

  _loop() {
    this.animationFrameId = requestAnimationFrame(() => this._loop());
    this.update();
  }

  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.container) this.container.style.display = 'none';
  }

  // Keep the overlay inside whichever wrapper currently hosts the live canvas
  // (the normal stage, or the fullscreen overlay), reparenting on transitions.
  _ensureParent() {
    if (!this.container) return;
    const wrapper = state.isFullscreen
      ? document.querySelector('.fullscreen-canvas-wrapper')
      : document.querySelector('.canvas-wrapper');
    if (wrapper && this.container.parentNode !== wrapper) {
      if (getComputedStyle(wrapper).position === 'static') wrapper.style.position = 'relative';
      wrapper.appendChild(this.container);
    }
  }

  _updateSize() {
    if (!this.renderer || !this.container) return;
    let w = this.container.clientWidth;
    let h = this.container.clientHeight;
    if (w <= 0 || h <= 0) { w = 640; h = 480; }
    const cur = this.renderer.getSize(new THREE.Vector2());
    if (Math.abs(cur.x - w) < 1 && Math.abs(cur.y - h) < 1) return; // no change
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  resize() { this._ensureParent(); this._updateSize(); }
}

// ── Singleton + lifecycle (called from view-sync / sketch) ────────────────────

let instance = null;

export function start3DConductor() {
  if (typeof THREE === 'undefined') {
    console.warn('3D Conductor: three.js not loaded.');
    return;
  }
  if (!instance) instance = new Conductor3D();
  instance.start();
  // Handle for dev tooling / automated pose verification.
  if (typeof window !== 'undefined') window.__vmConductor3D = instance;
}

export function stop3DConductor() {
  if (instance) instance.stop();
}

export function resize3DConductor() {
  if (instance && instance.initialized && instance.animationFrameId) instance.resize();
}
