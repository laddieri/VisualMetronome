// ── 3D Conductor ─────────────────────────────────────────────────────────────
// A realistic procedural humanoid conductor rendered with Three.js.
// Upper-body framing (waist up) in formal concert attire (black tuxedo).
// Enhanced 3D conducting patterns with depth, body sway, and head nods.
// ─────────────────────────────────────────────────────────────────────────────

class Conductor3D {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.container = null;
    this.bones = {};       // Named references to skeleton bones
    this.meshes = {};      // Named references to body part meshes
    this.clock = new THREE.Clock();
    this.initialized = false;
    this.animationFrameId = null;

    // Breathing animation
    this.breathPhase = 0;

    // Sway / nod state
    this.currentSway = 0;
    this.currentNod = 0;

    // Blinking — randomized natural intervals
    this.blinkTimer = 0;
    this.nextBlinkIn = 1.5 + Math.random() * 3;
    this.blinkProgress = -1; // -1 = not blinking; 0..1 = closing→opening

    // Idle micro-motion phase (keeps head/eyes alive between beats)
    this.idlePhase = Math.random() * 100;

    // Baton drag state — spring-damper on baton's local tilt driven by hand velocity.
    // Gives the tip the mass/inertia of a real baton: it lags during acceleration
    // and wobbles slightly at the ictus when the hand stops.
    this.prevHandPos = null;
    this.batonLagX = 0;
    this.batonLagZ = 0;
    this.batonLagVelX = 0;
    this.batonLagVelZ = 0;
  }

  // ── Initialization ───────────────────────────────────────────────────────

  init(parentSelector) {
    if (this.initialized) return;

    const wrapper = document.querySelector(parentSelector || '.canvas-wrapper');
    if (!wrapper) return;

    // Create container div overlaying the p5 canvas
    this.container = document.createElement('div');
    this.container.id = 'conductor3d-container';
    this.container.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;display:flex;align-items:center;justify-content:center;';
    wrapper.appendChild(this.container);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = null; // transparent — let p5 bg show through

    // Camera — upper-body framing
    this.camera = new THREE.PerspectiveCamera(32, 4 / 3, 0.1, 100);
    this.camera.position.set(0, 1.45, 3.2);
    this.camera.lookAt(0, 1.25, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (this.renderer.outputEncoding !== undefined) {
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // Size the renderer to match the p5 canvas
    this._updateSize();
    this.renderer.domElement.style.borderRadius = '12px';
    this.container.appendChild(this.renderer.domElement);

    // Lighting
    this._setupLights();

    // Build humanoid
    this._buildBody();

    this.initialized = true;
  }

  // ── Lights ─────────────────────────────────────────────────────────────

  _setupLights() {
    // Warm key light from upper-left (concert hall feel)
    const key = new THREE.DirectionalLight(0xfff4e0, 1.6);
    key.position.set(-3, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.001;
    this.scene.add(key);

    // Cool fill from right
    const fill = new THREE.DirectionalLight(0xc0d8ff, 0.5);
    fill.position.set(3, 3, 2);
    this.scene.add(fill);

    // Rim light from behind
    const rim = new THREE.DirectionalLight(0xffffff, 0.7);
    rim.position.set(0, 3, -4);
    this.scene.add(rim);

    // Soft ambient
    const amb = new THREE.AmbientLight(0x404060, 0.4);
    this.scene.add(amb);

    // Subtle hemisphere
    const hemi = new THREE.HemisphereLight(0x8090b0, 0x303020, 0.3);
    this.scene.add(hemi);
  }

  // ── Materials ──────────────────────────────────────────────────────────

  _mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness !== undefined ? opts.roughness : 0.7,
      metalness: opts.metalness !== undefined ? opts.metalness : 0.0,
      ...opts
    });
  }

  // ── Build body ─────────────────────────────────────────────────────────

  _buildBody() {
    const skin = 0xf5cba7;    // warm skin
    const hair = 0x2c1a0e;    // dark brown hair
    const tuxBody = 0x111111; // near-black tuxedo
    const shirt = 0xf8f8ff;   // white shirt
    const lapel = 0x0a0a0a;   // satin lapel
    const bowtie = 0x111111;  // black bow tie

    const bodyGroup = new THREE.Group();
    this.bodyGroup = bodyGroup;
    this.scene.add(bodyGroup);

    // One shared skin material so every skin part (head, neck, nose, ears,
    // eyelids, hands, fingers) shades identically under the scene lights.
    // Previously each mesh made its own MeshStandardMaterial with a different
    // roughness, which made the face look patchwork under the directional key
    // light.
    const skinMat = this._mat(skin, { roughness: 0.62 });
    this._skinMat = skinMat;

    // ── Torso ─────────────────────────────────────────────────────────
    // Substantially wider and deeper — gives the conductor a real adult
    // build instead of a broomstick under his tux.
    const jacketMat = this._mat(tuxBody, { roughness: 0.85 });
    const torsoGeo = new THREE.BoxGeometry(0.48, 0.58, 0.28, 3, 3, 3);
    const torsoMesh = new THREE.Mesh(torsoGeo, jacketMat);
    torsoMesh.position.set(0, 1.04, 0);
    torsoMesh.castShadow = true;
    bodyGroup.add(torsoMesh);
    this.meshes.torso = torsoMesh;

    // Jacket yoke — a wider, rounded block across the top of the torso that
    // carries the shoulder line out to the arm pivots. This replaces the
    // free-floating spherical shoulder pads with something that reads as
    // "jacket shoulders" and eliminates the ball-on-a-stick silhouette.
    const yokeGeo = new THREE.BoxGeometry(0.56, 0.14, 0.30, 2, 2, 2);
    const yokeMesh = new THREE.Mesh(yokeGeo, jacketMat);
    yokeMesh.position.set(0, 1.29, 0);
    yokeMesh.castShadow = true;
    bodyGroup.add(yokeMesh);

    // Softened shoulder caps — flatter, wider ovoids tucked on top of the
    // yoke edge so the arm sockets look round without balling out.
    for (const s of [-1, 1]) {
      const capGeo = new THREE.SphereGeometry(0.06, 16, 12);
      capGeo.scale(1.3, 0.7, 1.1);
      const cap = new THREE.Mesh(capGeo, jacketMat);
      cap.position.set(s * 0.24, 1.33, 0.01);
      cap.castShadow = true;
      bodyGroup.add(cap);
    }

    // Shirt front — a proper V-shaped white panel that fills the opening
    // between the lapels. Built from a 2D Shape so the top narrows into the
    // collar and the bottom is wider at the cummerbund line.
    const shirtMat = this._mat(shirt, { roughness: 0.5, side: THREE.DoubleSide });
    const shirtShape = new THREE.Shape();
    shirtShape.moveTo(-0.015, 0.18);   // top-left (meets at the bow tie)
    shirtShape.lineTo(0.015, 0.18);    // top-right
    shirtShape.lineTo(0.10, -0.20);    // bottom-right (cummerbund width)
    shirtShape.lineTo(-0.10, -0.20);   // bottom-left
    shirtShape.closePath();
    const shirtGeo = new THREE.ShapeGeometry(shirtShape);
    const shirtMesh = new THREE.Mesh(shirtGeo, shirtMat);
    shirtMesh.position.set(0, 1.12, 0.142);
    bodyGroup.add(shirtMesh);

    // Lapels — triangular satin panels meeting at the bow-tie knot and
    // fanning outward to the shoulders. Also built from Shapes so they read
    // as the classic peaked-tux lapel rather than two floating rectangles.
    const lapelMat = this._mat(lapel, { roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const lp = new THREE.Shape();
      // Pointing inward to the knot, out to the shoulder, down to the V
      lp.moveTo(s * 0.017, 0.18);    // top-inner (beside bow tie)
      lp.lineTo(s * 0.19, 0.15);     // top-outer (shoulder seam)
      lp.lineTo(s * 0.16, -0.02);    // mid-outer (notch/peak)
      lp.lineTo(s * 0.02, -0.08);    // bottom-inner (V point)
      lp.closePath();
      const lapelGeo = new THREE.ShapeGeometry(lp);
      const lMesh = new THREE.Mesh(lapelGeo, lapelMat);
      // Lapels render in front of the shirt so the V reads as the shirt
      // peeking between them, not the other way round.
      lMesh.position.set(0, 1.12, 0.1432);
      bodyGroup.add(lMesh);
    }

    // Bow tie — larger, proportioned for the wider chest
    const btGeo = new THREE.SphereGeometry(0.028, 10, 8);
    btGeo.scale(1.9, 0.75, 0.55);
    const btMesh = new THREE.Mesh(btGeo, this._mat(bowtie, { roughness: 0.4 }));
    btMesh.position.set(0, 1.30, 0.145);
    bodyGroup.add(btMesh);

    // Collar points — small white wings flanking the bow tie
    const collarMat = this._mat(shirt, { roughness: 0.4, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const collarGeo = new THREE.PlaneGeometry(0.045, 0.04);
      const cMesh = new THREE.Mesh(collarGeo, collarMat);
      cMesh.position.set(s * 0.04, 1.322, 0.1445);
      cMesh.rotation.z = s * -0.4;
      bodyGroup.add(cMesh);
    }

    // ── Neck ──────────────────────────────────────────────────────────
    // Thicker, taller neck so it isn't a pencil under the head
    const neckGeo = new THREE.CylinderGeometry(0.07, 0.085, 0.10, 14);
    const neckMesh = new THREE.Mesh(neckGeo, skinMat);
    neckMesh.position.set(0, 1.37, 0);
    bodyGroup.add(neckMesh);
    this.meshes.neck = neckMesh;

    // ── Head ──────────────────────────────────────────────────────────
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.52, 0);
    bodyGroup.add(headGroup);
    this.meshes.headGroup = headGroup;

    // Skull
    const headGeo = new THREE.SphereGeometry(0.13, 24, 20);
    headGeo.scale(1, 1.12, 1.05);
    const headMesh = new THREE.Mesh(headGeo, skinMat);
    headMesh.castShadow = true;
    headGroup.add(headMesh);

    // Hair (back / top cap)
    const hairGeo = new THREE.SphereGeometry(0.135, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
    hairGeo.scale(1.02, 1.12, 1.08);
    const hairMesh = new THREE.Mesh(hairGeo, this._mat(hair, { roughness: 0.9 }));
    hairMesh.position.set(0, 0.01, -0.005);
    headGroup.add(hairMesh);

    // Side hair / sideburns — rounded, following the skull curvature
    const hairMatSide = this._mat(hair, { roughness: 0.9 });
    for (const side of [-1, 1]) {
      const sideGeo = new THREE.SphereGeometry(0.05, 14, 12);
      sideGeo.scale(0.35, 1.0, 0.95);
      const sMesh = new THREE.Mesh(sideGeo, hairMatSide);
      sMesh.position.set(side * 0.123, -0.01, 0.005);
      headGroup.add(sMesh);
    }

    // Eyes — slightly warmer whites, larger iris, smaller pupil, catch-light
    // highlight to break the dead-stare effect. Eyelids sit above each eye
    // and scale down during blinks.
    const eyeWhiteGeo = new THREE.SphereGeometry(0.018, 14, 10);
    const eyeIrisGeo = new THREE.SphereGeometry(0.010, 12, 10);
    const eyePupilGeo = new THREE.SphereGeometry(0.0042, 10, 8);
    const eyeHighlightGeo = new THREE.SphereGeometry(0.0025, 8, 6);
    const eyeWhiteMat = this._mat(0xf4f0e8, { roughness: 0.25 });
    const eyeIrisMat = this._mat(0x5a7f6a, { roughness: 0.35 });
    const eyePupilMat = this._mat(0x120a08, { roughness: 0.15 });
    const eyeHighlightMat = this._mat(0xffffff, { roughness: 0.05, emissive: 0xffffff, emissiveIntensity: 0.4 });

    this.meshes.eyes = [];
    this.meshes.eyelids = [];
    for (const side of [-1, 1]) {
      const eyeGroup = new THREE.Group();
      eyeGroup.position.set(side * 0.045, 0.02, 0.115);
      headGroup.add(eyeGroup);

      const eW = new THREE.Mesh(eyeWhiteGeo, eyeWhiteMat);
      eyeGroup.add(eW);
      const eI = new THREE.Mesh(eyeIrisGeo, eyeIrisMat);
      eI.position.set(0, -0.002, 0.015);
      eyeGroup.add(eI);
      const eP = new THREE.Mesh(eyePupilGeo, eyePupilMat);
      eP.position.set(0, -0.002, 0.02);
      eyeGroup.add(eP);
      const eH = new THREE.Mesh(eyeHighlightGeo, eyeHighlightMat);
      eH.position.set(-side * 0.003, 0.002, 0.021);
      eyeGroup.add(eH);
      this.meshes.eyes.push(eyeGroup);

      // Upper eyelid — bottom-facing hemisphere that hangs from the top of
      // the eye socket. Open: flat sliver (scale.y small). Closed: scaled
      // down far enough to cover the whole eyeball.
      const lidGeo = new THREE.SphereGeometry(0.022, 16, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
      const lid = new THREE.Mesh(lidGeo, skinMat);
      lid.position.set(side * 0.045, 0.039, 0.115);
      lid.scale.set(1, 0.1, 1);
      headGroup.add(lid);
      this.meshes.eyelids.push(lid);
    }

    // Eyebrows
    for (const side of [-1, 1]) {
      const browGeo = new THREE.BoxGeometry(0.04, 0.008, 0.015);
      const brow = new THREE.Mesh(browGeo, this._mat(hair, { roughness: 0.9 }));
      brow.position.set(side * 0.045, 0.048, 0.115);
      brow.rotation.z = side * -0.12;
      headGroup.add(brow);
    }

    // Nose — rounded bridge + bulbous tip (no sharp cone)
    const noseBridgeGeo = new THREE.SphereGeometry(0.013, 12, 10);
    noseBridgeGeo.scale(0.7, 1.9, 0.9);
    const noseBridge = new THREE.Mesh(noseBridgeGeo, skinMat);
    noseBridge.position.set(0, 0.002, 0.128);
    headGroup.add(noseBridge);

    const noseTipGeo = new THREE.SphereGeometry(0.014, 12, 10);
    noseTipGeo.scale(1, 0.8, 0.95);
    const noseTip = new THREE.Mesh(noseTipGeo, skinMat);
    noseTip.position.set(0, -0.022, 0.134);
    headGroup.add(noseTip);

    // Nostrils — tiny dark ovals so the nose reads as a nose
    const nostrilMat = this._mat(0x2a1810, { roughness: 0.9 });
    for (const side of [-1, 1]) {
      const nGeo = new THREE.SphereGeometry(0.004, 8, 6);
      nGeo.scale(1, 0.5, 0.5);
      const n = new THREE.Mesh(nGeo, nostrilMat);
      n.position.set(side * 0.007, -0.028, 0.142);
      headGroup.add(n);
    }

    // Mouth — upper lip arch + fuller lower lip, shaped into a soft smile.
    // The torus arc (0→π) bulges +Y by default; we rotate so the bulge points
    // down (corners of the mouth lift slightly → relaxed smile, not a frown).
    const lipMat = this._mat(0xb86a5f, { roughness: 0.45 });
    const upperLipGeo = new THREE.TorusGeometry(0.022, 0.0055, 8, 18, Math.PI);
    const upperLip = new THREE.Mesh(upperLipGeo, lipMat);
    upperLip.position.set(0, -0.048, 0.118);
    upperLip.rotation.x = Math.PI;
    // Tilt corners up a touch by flattening the arc vertically
    upperLip.scale.set(1, 0.75, 1);
    headGroup.add(upperLip);

    // Lower lip — a soft pad below, slightly fuller
    const lowerLipGeo = new THREE.SphereGeometry(0.014, 14, 10);
    lowerLipGeo.scale(1.7, 0.55, 0.45);
    const lowerLip = new THREE.Mesh(lowerLipGeo, lipMat);
    lowerLip.position.set(0, -0.058, 0.116);
    headGroup.add(lowerLip);

    // Ears
    for (const side of [-1, 1]) {
      const earGeo = new THREE.SphereGeometry(0.022, 8, 8);
      earGeo.scale(0.5, 1, 0.8);
      const ear = new THREE.Mesh(earGeo, skinMat);
      ear.position.set(side * 0.13, -0.01, 0.01);
      headGroup.add(ear);
    }

    // ── Baton (created BEFORE arms so it can be attached) ────────────
    // Built so the grip sits at the local origin and the shaft extends down
    // along -Y. Once attached to the wrist (whose local -Y points along the
    // fingers), the shaft naturally continues out past the hand.
    const batonGroup = new THREE.Group();
    // Shaft — extends in -Y from the grip
    const shaftGeo = new THREE.CylinderGeometry(0.005, 0.004, 0.38, 8);
    const shaft = new THREE.Mesh(shaftGeo, this._mat(0xf5f0e8, { roughness: 0.3 }));
    shaft.position.y = -0.19;
    batonGroup.add(shaft);
    // Cork grip — at the local origin (where the hand grips it)
    const gripGeo = new THREE.SphereGeometry(0.018, 10, 8);
    gripGeo.scale(1, 1.3, 1);
    const grip = new THREE.Mesh(gripGeo, this._mat(0xd4a76a, { roughness: 0.8 }));
    grip.position.y = 0;
    batonGroup.add(grip);
    this.meshes.baton = batonGroup;

    // ── Shoulders & Arms (after baton so it can be attached) ─────────
    this._buildArm(bodyGroup, 1, skin, tuxBody);  // right (baton)
    this._buildArm(bodyGroup, -1, skin, tuxBody);  // left
  }

  _buildArm(parent, side, skinColor, jacketColor) {
    // side: 1 = right (baton hand), -1 = left
    // Shoulder pivot sits just outside the torso edge and under the rounded
    // shoulder cap, so the arm can hang straight down without clipping into
    // the jacket.
    const shoulderX = side * 0.28;

    const shoulderGroup = new THREE.Group();
    shoulderGroup.position.set(shoulderX, 1.31, 0.08);
    parent.add(shoulderGroup);

    // Upper arm group (rotates at shoulder)
    const upperArmGroup = new THREE.Group();
    shoulderGroup.add(upperArmGroup);

    // Upper arm (jacket sleeve) — a bit thicker to match the broader frame
    const uaGeo = new THREE.CylinderGeometry(0.045, 0.038, 0.28, 12);
    const ua = new THREE.Mesh(uaGeo, this._mat(jacketColor, { roughness: 0.85 }));
    ua.position.y = -0.14;
    ua.castShadow = true;
    upperArmGroup.add(ua);

    // Elbow joint group
    const elbowGroup = new THREE.Group();
    elbowGroup.position.set(0, -0.28, 0);
    upperArmGroup.add(elbowGroup);

    // Forearm (jacket sleeve) — bumped to match the thicker upper arm
    const faGeo = new THREE.CylinderGeometry(0.036, 0.031, 0.26, 12);
    const fa = new THREE.Mesh(faGeo, this._mat(jacketColor, { roughness: 0.85 }));
    fa.position.y = -0.13;
    fa.castShadow = true;
    elbowGroup.add(fa);

    // Shirt cuff
    const cuffGeo = new THREE.CylinderGeometry(0.034, 0.036, 0.025, 12);
    const cuff = new THREE.Mesh(cuffGeo, this._mat(0xf0f0f0, { roughness: 0.4 }));
    cuff.position.y = -0.25;
    elbowGroup.add(cuff);

    // Wrist group
    const wristGroup = new THREE.Group();
    wristGroup.position.set(0, -0.27, 0);
    elbowGroup.add(wristGroup);

    // Hand
    const handGeo = new THREE.SphereGeometry(0.028, 10, 8);
    handGeo.scale(0.9, 1.2, 0.7);
    const hand = new THREE.Mesh(handGeo, this._skinMat);
    hand.position.y = -0.02;
    wristGroup.add(hand);

    // Fingers (simplified — 4 short cylinders)
    for (let f = 0; f < 4; f++) {
      const fGeo = new THREE.CylinderGeometry(0.006, 0.005, 0.035, 6);
      const finger = new THREE.Mesh(fGeo, this._skinMat);
      const spread = (f - 1.5) * 0.014;
      finger.position.set(spread, -0.05, 0.005);
      finger.rotation.x = 0.2;
      wristGroup.add(finger);
    }
    // Thumb
    const thumbGeo = new THREE.CylinderGeometry(0.007, 0.006, 0.03, 6);
    const thumb = new THREE.Mesh(thumbGeo, this._skinMat);
    thumb.position.set(side * 0.02, -0.03, 0.015);
    thumb.rotation.z = side * 0.6;
    thumb.rotation.x = 0.3;
    wristGroup.add(thumb);

    // Attach baton to right hand. Position grip inside the fist and tilt
    // the shaft slightly forward so it doesn't lie flat along the forearm.
    if (side === 1 && this.meshes.baton) {
      wristGroup.add(this.meshes.baton);
      this.meshes.baton.position.set(0, -0.04, 0.01);
      this.meshes.baton.rotation.x = 0.25;
    }

    // Store bone references
    const sideKey = side === 1 ? 'R' : 'L';
    this.bones['shoulder' + sideKey] = shoulderGroup;
    this.bones['upperArm' + sideKey] = upperArmGroup;
    this.bones['elbow' + sideKey] = elbowGroup;
    this.bones['wrist' + sideKey] = wristGroup;
  }

  // ── Enhanced 3D conducting patterns ────────────────────────────────────
  // Each beat: { pos: [x, y, z], rebound: [x, y, z], sway, nod }
  // pos = ictus (beat landing), rebound = peak after beat
  // sway = torso lean angle, nod = head tilt angle

  get3DPattern() {
    const n = beatsPerMeasure;

    const patterns = {
      // Standard conducting patterns: x = left/right, y = up/down, z = forward/back
      // Beat ictus points should be spread on a horizontal plane
      1: [
        { pos: [0, -0.35, 0.15], rebound: [0, -0.05, 0.08], sway: 0, nod: 0.08 }
      ],
      2: [
        // 1: down-center, 2: up-center
        { pos: [0, -0.35, 0.15], rebound: [0.08, -0.15, 0.1], sway: 0.02, nod: 0.08 },
        { pos: [0.1, -0.15, 0.1], rebound: [0, 0.05, 0.05], sway: -0.02, nod: -0.04 }
      ],
      3: [
        // 1: down-center, 2: out-right, 3: up-center
        { pos: [0, -0.35, 0.15], rebound: [0.15, -0.2, 0.1], sway: 0.03, nod: 0.1 },
        { pos: [0.30, -0.30, 0.12], rebound: [0.18, -0.15, 0.08], sway: 0.05, nod: 0.02 },
        { pos: [0.05, -0.12, 0.08], rebound: [0, 0.05, 0.05], sway: -0.03, nod: -0.06 }
      ],
      4: [
        // 1: down-center, 2: in-left, 3: out-right, 4: up-center
        { pos: [0, -0.35, 0.18], rebound: [-0.12, -0.2, 0.1], sway: -0.02, nod: 0.1 },
        { pos: [-0.22, -0.30, 0.14], rebound: [0.05, -0.18, 0.1], sway: -0.04, nod: 0.03 },
        { pos: [0.30, -0.28, 0.12], rebound: [0.18, -0.12, 0.06], sway: 0.04, nod: 0.02 },
        { pos: [0.05, -0.10, 0.08], rebound: [0, 0.05, 0.05], sway: -0.02, nod: -0.07 }
      ],
      5: [
        // 1: down, 2: in-left, 3: center, 4: out-right, 5: up
        { pos: [0, -0.35, 0.18], rebound: [-0.12, -0.2, 0.1], sway: -0.02, nod: 0.1 },
        { pos: [-0.22, -0.30, 0.14], rebound: [0, -0.18, 0.1], sway: -0.04, nod: 0.03 },
        { pos: [0.05, -0.30, 0.14], rebound: [0.15, -0.18, 0.08], sway: 0.0, nod: 0.04 },
        { pos: [0.30, -0.26, 0.12], rebound: [0.18, -0.10, 0.06], sway: 0.05, nod: 0.02 },
        { pos: [0.05, -0.10, 0.08], rebound: [0, 0.05, 0.05], sway: -0.02, nod: -0.07 }
      ],
      6: [
        // 1: down, 2: in-left-low, 3: in-left-high, 4: out-right-low, 5: out-right-high, 6: up
        { pos: [0, -0.35, 0.18], rebound: [-0.10, -0.22, 0.1], sway: -0.02, nod: 0.1 },
        { pos: [-0.20, -0.32, 0.14], rebound: [-0.15, -0.20, 0.1], sway: -0.03, nod: 0.04 },
        { pos: [-0.12, -0.26, 0.12], rebound: [0.10, -0.18, 0.08], sway: -0.01, nod: 0.03 },
        { pos: [0.25, -0.30, 0.14], rebound: [0.20, -0.18, 0.08], sway: 0.04, nod: 0.03 },
        { pos: [0.20, -0.24, 0.12], rebound: [0.12, -0.10, 0.06], sway: 0.03, nod: 0.02 },
        { pos: [0.05, -0.10, 0.08], rebound: [0, 0.05, 0.05], sway: -0.02, nod: -0.07 }
      ]
    };

    if (patterns[n]) return patterns[n];

    // Fallback for 7+ beats — alternate left and right with horizontal spread
    const pts = [{ pos: [0, -0.35, 0.18], rebound: [-0.12, -0.2, 0.1], sway: -0.02, nod: 0.1 }];
    for (let i = 1; i < n - 1; i++) {
      const isLeft = i % 2 === 1;
      const x = isLeft ? -0.18 : 0.25;
      const y = -0.30;
      pts.push({
        pos: [x, y, 0.14],
        rebound: [x * 0.6, y + 0.1, 0.08],
        sway: x * 0.15,
        nod: 0.03
      });
    }
    pts.push({ pos: [0.05, -0.10, 0.08], rebound: [0, 0.05, 0.05], sway: -0.02, nod: -0.07 });
    return pts;
  }

  // ── Get current conducting position ────────────────────────────────────

  _getConductingState() {
    const pattern = this.get3DPattern();
    const n = pattern.length;

    // Resting position when stopped
    if (typeof Tone === 'undefined' || Tone.Transport.state !== 'started' || lastBeatTime <= 0) {
      const last = pattern[n - 1];
      return {
        pos: [
          (last.pos[0] + last.rebound[0]) / 2,
          (last.pos[1] + last.rebound[1]) / 2,
          (last.pos[2] + last.rebound[2]) / 2
        ],
        sway: 0,
        nod: 0
      };
    }

    const beatDuration = 60 / (cachedBPM || Tone.Transport.bpm.value);
    const timeSinceLastBeat = Tone.now() - lastBeatTime - (bluetoothDelay / 1000);

    var progress, effectiveAnimBeat;
    if (timeSinceLastBeat < 0) {
      progress = (timeSinceLastBeat + beatDuration) / beatDuration;
      if (progress < 0) progress = 0;
      effectiveAnimBeat = animBeat - 1;
    } else {
      progress = Math.min(timeSinceLastBeat / beatDuration, 1);
      effectiveAnimBeat = animBeat;
    }

    const lastFiredBeatIndex = (effectiveAnimBeat - 1 + beatsPerMeasure) % beatsPerMeasure;
    const fromIdx = lastFiredBeatIndex % n;
    const toIdx = (fromIdx + 1) % n;

    const p0 = pattern[fromIdx].pos;
    const p1 = pattern[fromIdx].rebound;
    const p2 = pattern[toIdx].pos;

    // Ease-in: stronger for preparatory beat
    const easePower = fromIdx === n - 1 ? 2.4 : 1.7;
    const t = Math.pow(progress, easePower);
    const mt = 1 - t;

    const pos = [
      mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
      mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
      mt * mt * p0[2] + 2 * mt * t * p1[2] + t * t * p2[2]
    ];

    // Interpolate sway/nod
    const sway = pattern[fromIdx].sway * (1 - t) + pattern[toIdx].sway * t;
    const nod = pattern[fromIdx].nod * (1 - t) + pattern[toIdx].nod * t;

    return { pos, sway, nod };
  }

  // ── Inverse kinematics for arm ─────────────────────────────────────────
  // 2-bone IK using a pole vector. Solves for the elbow position geometrically,
  // then the caller points each bone with a quaternion. This avoids the
  // rotation-order problems that happen when combining Euler yaw + pitch.

  _solveArmIK(side, targetX, targetY, targetZ) {
    const upperLen = 0.28;
    const lowerLen = 0.27;
    // Must match _buildArm's shoulderGroup.position so the IK math and the
    // rendered bones share an origin.
    const shoulderPos = new THREE.Vector3(side * 0.28, 1.31, 0.08);
    const targetPos = new THREE.Vector3(targetX, targetY, targetZ);

    const toTarget = new THREE.Vector3().subVectors(targetPos, shoulderPos);
    let dist = toTarget.length();
    const maxReach = upperLen + lowerLen - 0.01;
    const minReach = 0.08;
    if (dist > maxReach) {
      toTarget.multiplyScalar(maxReach / dist);
      dist = maxReach;
      targetPos.copy(shoulderPos).add(toTarget);
    } else if (dist < minReach) {
      toTarget.multiplyScalar(minReach / Math.max(dist, 1e-6));
      dist = minReach;
      targetPos.copy(shoulderPos).add(toTarget);
    }

    // Distance from shoulder to the foot of the elbow perpendicular on the
    // shoulder→target line, plus elbow height above that line.
    const proj = (upperLen * upperLen - lowerLen * lowerLen + dist * dist) / (2 * dist);
    const h2 = upperLen * upperLen - proj * proj;
    const h = h2 > 0 ? Math.sqrt(h2) : 0;

    const u = toTarget.clone().normalize();

    // Pole: where the elbow points. For a conductor the elbow naturally hangs
    // outward and slightly back.
    const pole = new THREE.Vector3(side, -0.4, -0.8).normalize();
    const v = pole.clone().sub(u.clone().multiplyScalar(pole.dot(u)));
    if (v.lengthSq() < 1e-6) {
      v.set(side, 0, 0).sub(u.clone().multiplyScalar(u.x * side));
    }
    v.normalize();

    const elbowPos = shoulderPos.clone()
      .add(u.multiplyScalar(proj))
      .add(v.multiplyScalar(h));

    return { shoulderPos, elbowPos, targetPos };
  }

  // ── Apply pose to skeleton ─────────────────────────────────────────────

  _applyPose(state) {
    const pos = state.pos;
    const sway = state.sway;
    const nod = state.nod;

    // Smooth sway & nod for natural motion
    this.currentSway += (sway - this.currentSway) * 0.08;
    this.currentNod += (nod - this.currentNod) * 0.1;

    // Breathing
    this.breathPhase += 0.015;
    const breath = Math.sin(this.breathPhase) * 0.003;

    // Idle micro-motion — keeps the head from feeling frozen between beats.
    // Layered sinusoids at irrational-ish frequencies avoid a visible loop.
    const t = this.clock.elapsedTime;
    const idleYaw   = Math.sin(t * 0.31) * 0.018 + Math.sin(t * 0.83 + 1.3) * 0.006;
    const idlePitch = Math.sin(t * 0.47) * 0.010 + Math.sin(t * 1.17 + 0.6) * 0.004;
    const idleRoll  = Math.sin(t * 0.23 + 2.1) * 0.006;

    // Apply torso sway (plus a touch of idle roll so the shoulders breathe)
    if (this.bodyGroup) {
      this.bodyGroup.rotation.z = this.currentSway + idleRoll * 0.4;
      this.bodyGroup.position.y = breath;
    }

    // Head nod + idle drift
    if (this.meshes.headGroup) {
      this.meshes.headGroup.rotation.x = this.currentNod + idlePitch;
      this.meshes.headGroup.rotation.y = -this.currentSway * 0.5 + idleYaw;
      this.meshes.headGroup.rotation.z = idleRoll;
    }

    // Blinking + subtle eye saccades
    this._updateBlink();
    this._updateGaze(t);

    // Right arm (baton hand) — follows conducting pattern. Offsets track
    // the shoulder pivot so each hand still hangs under its own shoulder
    // when pos = (0, *, 0).
    this._poseArm(1, pos[0] + 0.28, pos[1] + 1.31, pos[2] + 0.08);

    // Left arm — mirrored across the body so both hands move at the same height.
    this._poseArm(-1, -pos[0] - 0.28, pos[1] + 1.31, pos[2] + 0.08);

    // Baton drag — tip trails the hand during acceleration, overshoots at the ictus.
    this._updateBatonDrag(pos);
  }

  _updateBlink() {
    if (!this.meshes.eyelids) return;
    const step = this.frameDelta || 0.016;

    if (this.blinkProgress < 0) {
      this.blinkTimer += step;
      if (this.blinkTimer >= this.nextBlinkIn) {
        this.blinkProgress = 0;
        this.blinkTimer = 0;
        // Occasional quick double-blink feels more natural
        this.nextBlinkIn = (Math.random() < 0.15 ? 0.22 : 2.5 + Math.random() * 3.5);
      }
    } else {
      // Full blink cycle ~0.18s (closing then opening)
      this.blinkProgress += step / 0.18;
      let closed;
      if (this.blinkProgress < 0.5) {
        closed = this.blinkProgress * 2;
      } else if (this.blinkProgress < 1) {
        closed = 1 - (this.blinkProgress - 0.5) * 2;
      } else {
        closed = 0;
        this.blinkProgress = -1;
      }
      // Open scale.y ≈ 0.1 (thin sliver above the eye); closed ≈ 1.7
      // (hemisphere fully hangs down over the eyeball).
      const s = 0.1 + 1.6 * closed;
      for (const lid of this.meshes.eyelids) {
        lid.scale.y = s;
      }
    }
  }

  _updateGaze(t) {
    if (!this.meshes.eyes) return;
    // Slow random-ish drift for each axis + occasional tiny saccades.
    const gazeX = Math.sin(t * 0.27 + 0.9) * 0.003 + Math.sin(t * 1.9) * 0.0015;
    const gazeY = Math.sin(t * 0.41 + 2.3) * 0.002;
    for (const eye of this.meshes.eyes) {
      eye.rotation.y = gazeX * 6;
      eye.rotation.x = gazeY * 6;
    }
  }

  _updateBatonDrag(pos) {
    if (!this.meshes.baton) return;

    if (!this.prevHandPos) {
      this.prevHandPos = [pos[0], pos[1], pos[2]];
    }
    const velX = pos[0] - this.prevHandPos[0];
    const velZ = pos[2] - this.prevHandPos[2];
    this.prevHandPos[0] = pos[0];
    this.prevHandPos[1] = pos[1];
    this.prevHandPos[2] = pos[2];

    // Drag opposite to motion. Shaft = local -Y (tip is below the grip), so
    // the sign of each rotation is flipped vs. a +Y shaft: hand moves +X →
    // tip should trail toward -X, which requires a negative rotation about Z
    // (a +Z rotation would send -Y toward +X). Same logic in the X axis.
    const dragScale = 14;
    const targetLagZ = -velX * dragScale;
    const targetLagX = velZ * dragScale;

    // Spring-damper: stiffness pulls toward target; damping bleeds off velocity.
    // Underdamped so the tip wobbles briefly when the hand stops sharply.
    const stiffness = 0.18;
    const damping = 0.62;
    this.batonLagVelX = (this.batonLagVelX + (targetLagX - this.batonLagX) * stiffness) * damping;
    this.batonLagVelZ = (this.batonLagVelZ + (targetLagZ - this.batonLagZ) * stiffness) * damping;
    this.batonLagX += this.batonLagVelX;
    this.batonLagZ += this.batonLagVelZ;

    // Wrist-flick: baton tip arcs to its highest point at the "and" of each
    // beat (halfway between ictuses). Increasing rotation.x tilts the -Y tip
    // toward the viewer and upward, matching the wrist-snap conductors use to
    // subdivide the beat visually.
    const beatProg = (typeof getAnimationProgress === 'function') ? getAnimationProgress() : 0;
    const wristFlick = Math.sin(beatProg * Math.PI) * 0.45;

    this.meshes.baton.rotation.x = 0.25 + this.batonLagX + wristFlick;
    this.meshes.baton.rotation.z = this.batonLagZ;
  }

  _poseArm(side, tx, ty, tz) {
    const sideKey = side === 1 ? 'R' : 'L';
    const upperArm = this.bones['upperArm' + sideKey];
    const elbow = this.bones['elbow' + sideKey];
    const wrist = this.bones['wrist' + sideKey];
    if (!upperArm || !elbow) return;

    const { shoulderPos, elbowPos, targetPos } = this._solveArmIK(side, tx, ty, tz);

    const DOWN = new THREE.Vector3(0, -1, 0);

    // Upper arm: rotate default direction (straight down) toward the elbow.
    const upperDir = new THREE.Vector3().subVectors(elbowPos, shoulderPos).normalize();
    upperArm.quaternion.setFromUnitVectors(DOWN, upperDir);

    // Forearm: rotate default (down, in parent's local frame) toward the hand.
    // Express the world-space forearm direction in the upper arm's local space.
    const forearmDirWorld = new THREE.Vector3().subVectors(targetPos, elbowPos).normalize();
    const inverseUpper = upperArm.quaternion.clone().invert();
    const forearmDirLocal = forearmDirWorld.applyQuaternion(inverseUpper);
    elbow.quaternion.setFromUnitVectors(DOWN, forearmDirLocal);

    // Wrist: a small, natural flex. For the baton hand (right, side=1) the
    // wrist cocks back as the tip rises to the "and" so the motion reads as
    // driven by the wrist rather than the whole arm.
    if (wrist) {
      if (side === 1) {
        const beatProg = (typeof getAnimationProgress === 'function') ? getAnimationProgress() : 0;
        const wristCock = Math.sin(beatProg * Math.PI) * 0.15;
        wrist.rotation.set(-0.1 + wristCock, 0, 0);
      } else {
        wrist.rotation.set(-0.1, 0, 0);
      }
    }
  }

  // ── Update & render ────────────────────────────────────────────────────

  update() {
    if (!this.initialized) return;

    // Advance the clock once per frame so elapsedTime is valid for idle motion
    // and blink timing. Cap delta to avoid large jumps when the tab was hidden.
    this.frameDelta = Math.min(0.05, this.clock.getDelta());

    var state = this._getConductingState();
    this._applyPose(state);
    this.renderer.render(this.scene, this.camera);
  }

  // Start the render loop
  start() {
    if (!this.initialized) return;
    if (this.animationFrameId) return; // already running
    this.container.style.display = '';
    // Defer size update to next frame so container has layout dimensions
    requestAnimationFrame(() => {
      this._updateSize();
      this._loop();
    });
  }

  _loop() {
    this.animationFrameId = requestAnimationFrame(() => this._loop());
    this.update();
  }

  // Stop the render loop
  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.container) {
      this.container.style.display = 'none';
    }
  }

  // ── Resize handling ────────────────────────────────────────────────────

  _updateSize() {
    if (!this.renderer) return;
    // Match the p5 canvas size
    var p5Canvas = document.querySelector('.canvas-wrapper canvas');
    var w, h;
    if (p5Canvas) {
      w = p5Canvas.clientWidth;
      h = p5Canvas.clientHeight;
    } else {
      w = this.container ? this.container.clientWidth : 640;
      h = this.container ? this.container.clientHeight : 480;
    }
    if (w <= 0 || h <= 0) { w = 640; h = 480; }
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  resize() {
    this._updateSize();
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  dispose() {
    this.stop();
    if (this.renderer) {
      this.renderer.dispose();
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.initialized = false;
  }
}

// Global instance
var conductor3dInstance = null;
