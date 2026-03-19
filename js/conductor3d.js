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
    this.targetSway = 0;
    this.targetNod = 0;
  }

  // ── Initialization ───────────────────────────────────────────────────────

  init(parentSelector) {
    if (this.initialized) return;

    // Create container div overlaying the p5 canvas
    this.container = document.createElement('div');
    this.container.id = 'conductor3d-container';
    this.container.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;';
    const wrapper = document.querySelector(parentSelector || '.canvas-wrapper');
    wrapper.style.position = 'relative';
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this._updateSize();
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

    // ── Torso ─────────────────────────────────────────────────────────
    // Jacket body
    const torsoGeo = this._roundedBox(0.42, 0.55, 0.24, 0.04);
    const torsoMesh = new THREE.Mesh(torsoGeo, this._mat(tuxBody, { roughness: 0.85 }));
    torsoMesh.position.set(0, 1.05, 0);
    torsoMesh.castShadow = true;
    bodyGroup.add(torsoMesh);
    this.meshes.torso = torsoMesh;

    // Shirt front (visible V)
    const shirtGeo = new THREE.PlaneGeometry(0.12, 0.28);
    const shirtMesh = new THREE.Mesh(shirtGeo, this._mat(shirt, { roughness: 0.5 }));
    shirtMesh.position.set(0, 1.12, 0.122);
    bodyGroup.add(shirtMesh);

    // Lapels
    const lapelMat = this._mat(lapel, { roughness: 0.3, metalness: 0.1 });
    for (const side of [-1, 1]) {
      const lapelGeo = new THREE.PlaneGeometry(0.06, 0.22);
      const lMesh = new THREE.Mesh(lapelGeo, lapelMat);
      lMesh.position.set(side * 0.065, 1.14, 0.123);
      lMesh.rotation.y = side * 0.15;
      bodyGroup.add(lMesh);
    }

    // Bow tie
    const btGeo = new THREE.SphereGeometry(0.022, 8, 6);
    btGeo.scale(1.8, 0.7, 0.5);
    const btMesh = new THREE.Mesh(btGeo, this._mat(bowtie, { roughness: 0.4 }));
    btMesh.position.set(0, 1.29, 0.125);
    bodyGroup.add(btMesh);

    // Collar points
    for (const side of [-1, 1]) {
      const collarGeo = new THREE.PlaneGeometry(0.04, 0.035);
      const cMesh = new THREE.Mesh(collarGeo, this._mat(shirt, { roughness: 0.4 }));
      cMesh.position.set(side * 0.035, 1.305, 0.124);
      cMesh.rotation.z = side * -0.4;
      bodyGroup.add(cMesh);
    }

    // ── Neck ──────────────────────────────────────────────────────────
    const neckGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.08, 12);
    const neckMesh = new THREE.Mesh(neckGeo, this._mat(skin));
    neckMesh.position.set(0, 1.36, 0);
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
    const headMesh = new THREE.Mesh(headGeo, this._mat(skin, { roughness: 0.6 }));
    headMesh.castShadow = true;
    headGroup.add(headMesh);

    // Hair (back / top cap)
    const hairGeo = new THREE.SphereGeometry(0.135, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
    hairGeo.scale(1.02, 1.12, 1.08);
    const hairMesh = new THREE.Mesh(hairGeo, this._mat(hair, { roughness: 0.9 }));
    hairMesh.position.set(0, 0.01, -0.005);
    headGroup.add(hairMesh);

    // Side hair / sideburns
    for (const side of [-1, 1]) {
      const sideGeo = new THREE.BoxGeometry(0.025, 0.08, 0.1);
      const sMesh = new THREE.Mesh(sideGeo, this._mat(hair, { roughness: 0.9 }));
      sMesh.position.set(side * 0.125, -0.02, 0.02);
      headGroup.add(sMesh);
    }

    // Eyes
    const eyeWhiteGeo = new THREE.SphereGeometry(0.018, 12, 8);
    const eyeIrisGeo = new THREE.SphereGeometry(0.009, 10, 8);
    const eyePupilGeo = new THREE.SphereGeometry(0.005, 8, 6);
    const eyeWhiteMat = this._mat(0xffffff, { roughness: 0.2 });
    const eyeIrisMat = this._mat(0x3a6b4f, { roughness: 0.3 });
    const eyePupilMat = this._mat(0x0a0a0a, { roughness: 0.1 });
    for (const side of [-1, 1]) {
      const eW = new THREE.Mesh(eyeWhiteGeo, eyeWhiteMat);
      eW.position.set(side * 0.045, 0.02, 0.115);
      headGroup.add(eW);
      const eI = new THREE.Mesh(eyeIrisGeo, eyeIrisMat);
      eI.position.set(side * 0.045, 0.018, 0.13);
      headGroup.add(eI);
      const eP = new THREE.Mesh(eyePupilGeo, eyePupilMat);
      eP.position.set(side * 0.045, 0.018, 0.135);
      headGroup.add(eP);
    }

    // Eyebrows
    for (const side of [-1, 1]) {
      const browGeo = new THREE.BoxGeometry(0.04, 0.008, 0.015);
      const brow = new THREE.Mesh(browGeo, this._mat(hair, { roughness: 0.9 }));
      brow.position.set(side * 0.045, 0.048, 0.115);
      brow.rotation.z = side * -0.12;
      headGroup.add(brow);
    }

    // Nose
    const noseGeo = new THREE.ConeGeometry(0.012, 0.035, 8);
    const nose = new THREE.Mesh(noseGeo, this._mat(skin, { roughness: 0.6 }));
    nose.position.set(0, -0.005, 0.13);
    nose.rotation.x = -0.3;
    headGroup.add(nose);

    // Lips
    const lipGeo = new THREE.TorusGeometry(0.018, 0.005, 6, 12, Math.PI);
    const lip = new THREE.Mesh(lipGeo, this._mat(0xc67b6f, { roughness: 0.5 }));
    lip.position.set(0, -0.04, 0.115);
    lip.rotation.x = Math.PI;
    headGroup.add(lip);

    // Ears
    for (const side of [-1, 1]) {
      const earGeo = new THREE.SphereGeometry(0.022, 8, 8);
      earGeo.scale(0.5, 1, 0.8);
      const ear = new THREE.Mesh(earGeo, this._mat(skin, { roughness: 0.7 }));
      ear.position.set(side * 0.13, -0.01, 0.01);
      headGroup.add(ear);
    }

    // ── Shoulders & Arms ─────────────────────────────────────────────
    this._buildArm(bodyGroup, 1, skin, tuxBody);  // right
    this._buildArm(bodyGroup, -1, skin, tuxBody);  // left

    // ── Baton (in right hand) ────────────────────────────────────────
    const batonGroup = new THREE.Group();
    // Shaft
    const shaftGeo = new THREE.CylinderGeometry(0.005, 0.004, 0.38, 8);
    const shaft = new THREE.Mesh(shaftGeo, this._mat(0xf5f0e8, { roughness: 0.3 }));
    shaft.position.y = 0.19;
    batonGroup.add(shaft);
    // Cork grip
    const gripGeo = new THREE.SphereGeometry(0.018, 10, 8);
    gripGeo.scale(1, 1.3, 1);
    const grip = new THREE.Mesh(gripGeo, this._mat(0xd4a76a, { roughness: 0.8 }));
    grip.position.y = -0.01;
    batonGroup.add(grip);
    this.meshes.baton = batonGroup;
    // Will be attached to right hand in _buildArm
  }

  _buildArm(parent, side, skinColor, jacketColor) {
    // side: 1 = right (baton hand), -1 = left
    const shoulderX = side * 0.25;

    // Shoulder joint group
    const shoulderGroup = new THREE.Group();
    shoulderGroup.position.set(shoulderX, 1.28, 0);
    parent.add(shoulderGroup);

    // Shoulder pad
    const padGeo = new THREE.SphereGeometry(0.055, 12, 10);
    padGeo.scale(1, 0.8, 0.9);
    const pad = new THREE.Mesh(padGeo, this._mat(jacketColor, { roughness: 0.85 }));
    shoulderGroup.add(pad);

    // Upper arm group (rotates at shoulder)
    const upperArmGroup = new THREE.Group();
    shoulderGroup.add(upperArmGroup);

    // Upper arm (jacket sleeve)
    const uaGeo = new THREE.CylinderGeometry(0.042, 0.038, 0.28, 10);
    const ua = new THREE.Mesh(uaGeo, this._mat(jacketColor, { roughness: 0.85 }));
    ua.position.y = -0.14;
    ua.castShadow = true;
    upperArmGroup.add(ua);

    // Elbow joint group
    const elbowGroup = new THREE.Group();
    elbowGroup.position.set(0, -0.28, 0);
    upperArmGroup.add(elbowGroup);

    // Forearm (jacket sleeve)
    const faGeo = new THREE.CylinderGeometry(0.036, 0.032, 0.26, 10);
    const fa = new THREE.Mesh(faGeo, this._mat(jacketColor, { roughness: 0.85 }));
    fa.position.y = -0.13;
    fa.castShadow = true;
    elbowGroup.add(fa);

    // Shirt cuff
    const cuffGeo = new THREE.CylinderGeometry(0.034, 0.035, 0.025, 10);
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
    const hand = new THREE.Mesh(handGeo, this._mat(skinColor, { roughness: 0.6 }));
    hand.position.y = -0.02;
    wristGroup.add(hand);

    // Fingers (simplified — 4 short cylinders)
    for (let f = 0; f < 4; f++) {
      const fGeo = new THREE.CylinderGeometry(0.006, 0.005, 0.035, 6);
      const finger = new THREE.Mesh(fGeo, this._mat(skinColor, { roughness: 0.6 }));
      const spread = (f - 1.5) * 0.014;
      finger.position.set(spread, -0.05, 0.005);
      finger.rotation.x = 0.2;
      wristGroup.add(finger);
    }
    // Thumb
    const thumbGeo = new THREE.CylinderGeometry(0.007, 0.006, 0.03, 6);
    const thumb = new THREE.Mesh(thumbGeo, this._mat(skinColor, { roughness: 0.6 }));
    thumb.position.set(side * 0.02, -0.03, 0.015);
    thumb.rotation.z = side * 0.6;
    thumb.rotation.x = 0.3;
    wristGroup.add(thumb);

    // Attach baton to right hand
    if (side === 1) {
      wristGroup.add(this.meshes.baton);
      this.meshes.baton.rotation.x = -0.2;
    }

    // Store bone references
    const sideKey = side === 1 ? 'R' : 'L';
    this.bones['shoulder' + sideKey] = shoulderGroup;
    this.bones['upperArm' + sideKey] = upperArmGroup;
    this.bones['elbow' + sideKey] = elbowGroup;
    this.bones['wrist' + sideKey] = wristGroup;
  }

  // ── Rounded box helper ─────────────────────────────────────────────────

  _roundedBox(w, h, d, r) {
    const shape = new THREE.Shape();
    const hw = w / 2 - r;
    const hh = h / 2 - r;
    shape.moveTo(-hw, -h / 2);
    shape.lineTo(hw, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -hh);
    shape.lineTo(w / 2, hh);
    shape.quadraticCurveTo(w / 2, h / 2, hw, h / 2);
    shape.lineTo(-hw, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, hh);
    shape.lineTo(-w / 2, -hh);
    shape.quadraticCurveTo(-w / 2, -h / 2, -hw, -h / 2);

    const extrudeSettings = { depth: d, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 3 };
    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geo.translate(0, 0, -d / 2);
    return geo;
  }

  // ── Enhanced 3D conducting patterns ────────────────────────────────────
  // Each beat: { pos: [x, y, z], rebound: [x, y, z], sway, nod }
  // pos = ictus (beat landing), rebound = peak after beat
  // sway = torso lean angle, nod = head tilt angle

  get3DPattern() {
    const n = beatsPerMeasure;

    const patterns = {
      1: [
        { pos: [0, -0.35, 0.15], rebound: [0, 0.1, 0.05], sway: 0, nod: 0.08 }
      ],
      2: [
        { pos: [0, -0.35, 0.15], rebound: [0.05, -0.05, 0.08], sway: 0.02, nod: 0.08 },
        { pos: [0.05, -0.2, 0.1], rebound: [0, 0.15, -0.05], sway: -0.02, nod: -0.04 }
      ],
      3: [
        { pos: [0, -0.35, 0.15], rebound: [0.12, -0.08, 0.05], sway: 0.03, nod: 0.1 },
        { pos: [0.2, -0.28, 0.08], rebound: [0.12, -0.05, 0.0], sway: 0.05, nod: 0.02 },
        { pos: [0.05, -0.15, 0.05], rebound: [0, 0.2, -0.08], sway: -0.03, nod: -0.06 }
      ],
      4: [
        { pos: [0, -0.35, 0.18], rebound: [-0.08, -0.08, 0.06], sway: -0.02, nod: 0.1 },
        { pos: [-0.15, -0.3, 0.1], rebound: [0.05, -0.05, 0.05], sway: -0.04, nod: 0.03 },
        { pos: [0.2, -0.28, 0.08], rebound: [0.12, -0.02, 0.0], sway: 0.04, nod: 0.02 },
        { pos: [0.05, -0.12, 0.05], rebound: [0, 0.22, -0.1], sway: -0.02, nod: -0.07 }
      ],
      5: [
        { pos: [0, -0.35, 0.18], rebound: [-0.08, -0.08, 0.06], sway: -0.02, nod: 0.1 },
        { pos: [-0.15, -0.3, 0.1], rebound: [0.05, -0.05, 0.05], sway: -0.04, nod: 0.03 },
        { pos: [0.02, -0.3, 0.12], rebound: [0.1, -0.06, 0.03], sway: 0.0, nod: 0.04 },
        { pos: [0.2, -0.26, 0.08], rebound: [0.12, -0.02, 0.0], sway: 0.05, nod: 0.02 },
        { pos: [0.05, -0.12, 0.05], rebound: [0, 0.22, -0.1], sway: -0.02, nod: -0.07 }
      ],
      6: [
        { pos: [0, -0.35, 0.18], rebound: [-0.06, -0.1, 0.06], sway: -0.02, nod: 0.1 },
        { pos: [-0.12, -0.32, 0.1], rebound: [-0.1, -0.08, 0.05], sway: -0.03, nod: 0.04 },
        { pos: [-0.08, -0.3, 0.08], rebound: [0.08, -0.05, 0.04], sway: -0.01, nod: 0.03 },
        { pos: [0.18, -0.3, 0.1], rebound: [0.15, -0.06, 0.03], sway: 0.04, nod: 0.03 },
        { pos: [0.14, -0.26, 0.08], rebound: [0.1, -0.02, 0.0], sway: 0.03, nod: 0.02 },
        { pos: [0.05, -0.12, 0.05], rebound: [0, 0.22, -0.1], sway: -0.02, nod: -0.07 }
      ]
    };

    if (patterns[n]) return patterns[n];

    // Fallback for 7+ beats
    const pts = [{ pos: [0, -0.35, 0.18], rebound: [-0.08, -0.08, 0.06], sway: -0.02, nod: 0.1 }];
    for (let i = 1; i < n - 1; i++) {
      const isInner = i % 2 === 1;
      const x = isInner ? -0.12 : 0.18;
      const y = -0.32 + i * 0.015;
      pts.push({
        pos: [x, y, 0.1 - i * 0.005],
        rebound: [x * 0.6, y + 0.15, 0.03],
        sway: x * 0.2,
        nod: 0.03
      });
    }
    pts.push({ pos: [0.05, -0.12, 0.05], rebound: [0, 0.22, -0.1], sway: -0.02, nod: -0.07 });
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

    let progress, effectiveAnimBeat;
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
  // Given a target hand position in body-local coords, solve shoulder & elbow angles

  _solveArmIK(side, targetX, targetY, targetZ) {
    const upperLen = 0.28;
    const lowerLen = 0.27;
    const shoulderX = side * 0.25;
    const shoulderY = 1.28;
    const shoulderZ = 0;

    // Target relative to shoulder
    const dx = targetX - shoulderX;
    const dy = targetY - shoulderY;
    const dz = targetZ - shoulderZ;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Clamp reach
    const maxReach = upperLen + lowerLen - 0.02;
    const minReach = 0.08;
    const reach = Math.max(minReach, Math.min(dist, maxReach));

    // Elbow angle via law of cosines
    let cosElbow = (upperLen * upperLen + lowerLen * lowerLen - reach * reach) /
                   (2 * upperLen * lowerLen);
    cosElbow = Math.max(-1, Math.min(1, cosElbow));
    const elbowAngle = Math.PI - Math.acos(cosElbow);

    // Shoulder pitch (up/down in YZ plane relative to direction)
    const planarDist = Math.sqrt(dx * dx + dz * dz);
    const shoulderPitch = -Math.atan2(-dy, planarDist);

    // Shoulder yaw (left/right)
    const shoulderYaw = Math.atan2(dz, dx * side);

    // Shoulder roll (how much the arm extends outward)
    const shoulderRoll = Math.atan2(dx * side, -dy);

    return { shoulderPitch, shoulderYaw, shoulderRoll, elbowAngle };
  }

  // ── Apply pose to skeleton ─────────────────────────────────────────────

  _applyPose(state) {
    const { pos, sway, nod } = state;

    // Smooth sway & nod for natural motion
    this.currentSway += (sway - this.currentSway) * 0.08;
    this.currentNod += (nod - this.currentNod) * 0.1;

    // Breathing
    this.breathPhase += 0.015;
    const breath = Math.sin(this.breathPhase) * 0.003;

    // Apply torso sway
    if (this.bodyGroup) {
      this.bodyGroup.rotation.z = this.currentSway;
      this.bodyGroup.position.y = breath;
    }

    // Head nod
    if (this.meshes.headGroup) {
      this.meshes.headGroup.rotation.x = this.currentNod;
      // Slight head turn following baton
      this.meshes.headGroup.rotation.y = -this.currentSway * 0.5;
    }

    // Right arm (baton hand) — follows conducting pattern
    const rTarget = {
      x: pos[0] + 0.25,  // offset from center to right shoulder
      y: pos[1] + 1.28,  // offset to shoulder height
      z: pos[2]
    };
    this._poseArm(1, rTarget.x, rTarget.y, rTarget.z);

    // Left arm — mirrors with reduced amplitude and slight delay feel
    const lTarget = {
      x: -pos[0] - 0.25,
      y: pos[1] * 0.6 + 1.28 + 0.05,  // Less vertical travel
      z: pos[2] * 0.5
    };
    this._poseArm(-1, lTarget.x, lTarget.y, lTarget.z);
  }

  _poseArm(side, tx, ty, tz) {
    const sideKey = side === 1 ? 'R' : 'L';
    const shoulder = this.bones['shoulder' + sideKey];
    const upperArm = this.bones['upperArm' + sideKey];
    const elbow = this.bones['elbow' + sideKey];
    const wrist = this.bones['wrist' + sideKey];
    if (!shoulder || !upperArm || !elbow) return;

    const ik = this._solveArmIK(side, tx, ty, tz);

    // Apply rotations
    upperArm.rotation.set(0, 0, 0);
    // Shoulder pitch — primary up/down
    upperArm.rotation.z = side * (ik.shoulderRoll - Math.PI / 2);
    upperArm.rotation.x = ik.shoulderPitch * 0.3;
    // Forward reach
    upperArm.rotation.y = -ik.shoulderYaw * side * 0.4;

    // Elbow bend
    elbow.rotation.set(0, 0, 0);
    elbow.rotation.x = ik.elbowAngle * 0.7;

    // Wrist — slight flex to keep baton at good angle
    if (wrist) {
      wrist.rotation.x = -0.2 + (side === 1 ? 0.1 : 0);
    }
  }

  // ── Update & render ────────────────────────────────────────────────────

  update() {
    if (!this.initialized) return;

    const state = this._getConductingState();
    this._applyPose(state);

    this.renderer.render(this.scene, this.camera);
  }

  // Start the render loop
  start() {
    if (!this.initialized) return;
    this._updateSize();
    this.container.style.display = '';
    this._loop();
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
    if (!this.container || !this.renderer) return;
    const w = this.container.clientWidth || 640;
    const h = this.container.clientHeight || 480;
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
