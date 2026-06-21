import { state } from './state.js';
import { getAnimationProgress } from './stage.js';

// ── 3D Conductor (stylized mannequin) ────────────────────────────────────────
// A front-facing conductor rendered with Three.js. Deliberately a clean matte
// "artist's mannequin" in concert tails: smooth featureless head (no eyes,
// nose, or mouth), neutral porcelain material, soft even studio lighting. The
// previous attempt put realistic eyes and skin on a primitive head, which fell
// straight into the uncanny valley; a faceless mannequin reads as charming and
// intentional instead. The motion is where the realism budget goes: 2-bone IK
// arms tracing true conducting patterns, an underdamped baton that lags and
// settles at each ictus, breathing, body sway, and idle micro-motion.
// ─────────────────────────────────────────────────────────────────────────────

class Conductor3D {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.container = null;
    this.bones = {};
    this.meshes = {};
    this.clock = new THREE.Clock();
    this.initialized = false;
    this.animationFrameId = null;

    // Breathing + sway smoothing state
    this.breathPhase = Math.random() * Math.PI * 2;
    this.currentSway = 0;
    this.currentNod = 0;
    this.idlePhase = Math.random() * 100;

    // Baton spring-damper state (gives the tip mass/inertia)
    this.prevHandPos = null;
    this.batonLagX = 0;
    this.batonLagZ = 0;
    this.batonLagVelX = 0;
    this.batonLagVelZ = 0;
  }

  // ── Initialization ───────────────────────────────────────────────────────

  init() {
    if (this.initialized) return;

    this.container = document.createElement('div');
    this.container.id = 'conductor3d-container';
    this.container.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:1;display:flex;' +
      'align-items:center;justify-content:center;';

    this.scene = new THREE.Scene();
    this.scene.background = null; // transparent — p5/page background shows through

    // Upper-body (waist-up) framing, looking slightly down at the chest line.
    this.camera = new THREE.PerspectiveCamera(32, 4 / 3, 0.1, 100);
    this.camera.position.set(0, 1.42, 3.25);
    this.camera.lookAt(0, 1.18, 0);

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (this.renderer.outputEncoding !== undefined && THREE.sRGBEncoding !== undefined) {
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    if (THREE.ACESFilmicToneMapping !== undefined) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
    }
    this.renderer.domElement.style.borderRadius = '12px';
    this.container.appendChild(this.renderer.domElement);

    this._setupLights();
    this._buildBody();

    this.initialized = true;
  }

  // ── Lighting ──────────────────────────────────────────────────────────────
  // Soft and even, like a product/studio shoot. Avoids the dramatic, raking
  // key light that exaggerated every seam on the old model and made it eerie.

  _setupLights() {
    const hemi = new THREE.HemisphereLight(0xfdfbff, 0x3a3f4a, 0.95);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff6ec, 0.85);
    key.position.set(-2.5, 4, 4);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xdce8ff, 0.45);
    fill.position.set(3, 2, 2.5);
    this.scene.add(fill);

    const amb = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(amb);
  }

  _mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness !== undefined ? opts.roughness : 0.85,
      metalness: opts.metalness !== undefined ? opts.metalness : 0.0,
      ...opts
    });
  }

  // ── Build mannequin ─────────────────────────────────────────────────────

  _buildBody() {
    const mannequin = 0xe8d2bd; // warm porcelain/maple — the mannequin surface
    const coat      = 0x24272f; // charcoal tails (reads better than pure black)
    const shirt     = 0xf3f3f7; // off-white dress shirt
    const cap        = 0x32363f; // dark matte "hair" cap (front/back orientation)
    const satin     = 0x15171c; // lapel / bow-tie satin

    const bodyGroup = new THREE.Group();
    this.bodyGroup = bodyGroup;
    this.scene.add(bodyGroup);

    const skinMat = this._mat(mannequin, { roughness: 0.78 });
    this._skinMat = skinMat;
    const coatMat = this._mat(coat, { roughness: 0.92 });

    // ── Torso — tapered so it reads as a chest, not a box ──
    const torsoGeo = new THREE.CylinderGeometry(0.21, 0.17, 0.6, 24, 1);
    torsoGeo.scale(1.18, 1, 0.72); // wider across shoulders, flatter front-to-back
    const torsoMesh = new THREE.Mesh(torsoGeo, coatMat);
    torsoMesh.position.set(0, 1.04, 0);
    bodyGroup.add(torsoMesh);
    this.meshes.torso = torsoMesh;

    // Shoulder yoke — rounded block carrying the shoulder line out to the arms
    const yokeGeo = new THREE.SphereGeometry(0.27, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
    yokeGeo.scale(1.0, 0.7, 0.72);
    const yokeMesh = new THREE.Mesh(yokeGeo, coatMat);
    yokeMesh.position.set(0, 1.26, 0);
    bodyGroup.add(yokeMesh);

    // Shirt front — V-shaped white panel between the lapels
    const shirtMat = this._mat(shirt, { roughness: 0.55, side: THREE.DoubleSide });
    const shirtShape = new THREE.Shape();
    shirtShape.moveTo(-0.02, 0.2);
    shirtShape.lineTo(0.02, 0.2);
    shirtShape.lineTo(0.085, -0.2);
    shirtShape.lineTo(-0.085, -0.2);
    shirtShape.closePath();
    const shirtMesh = new THREE.Mesh(new THREE.ShapeGeometry(shirtShape), shirtMat);
    shirtMesh.position.set(0, 1.12, 0.125);
    bodyGroup.add(shirtMesh);

    // Lapels — peaked satin triangles meeting at the bow-tie knot
    const lapelMat = this._mat(satin, { roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const lp = new THREE.Shape();
      lp.moveTo(s * 0.02, 0.2);
      lp.lineTo(s * 0.18, 0.17);
      lp.lineTo(s * 0.15, -0.01);
      lp.lineTo(s * 0.025, -0.07);
      lp.closePath();
      const lMesh = new THREE.Mesh(new THREE.ShapeGeometry(lp), lapelMat);
      lMesh.position.set(0, 1.12, 0.1265);
      bodyGroup.add(lMesh);
    }

    // Bow tie
    const btGeo = new THREE.SphereGeometry(0.03, 12, 8);
    btGeo.scale(1.9, 0.7, 0.5);
    const btMesh = new THREE.Mesh(btGeo, this._mat(satin, { roughness: 0.5 }));
    btMesh.position.set(0, 1.31, 0.128);
    bodyGroup.add(btMesh);

    // ── Neck ──
    const neckGeo = new THREE.CylinderGeometry(0.058, 0.07, 0.12, 16);
    const neckMesh = new THREE.Mesh(neckGeo, skinMat);
    neckMesh.position.set(0, 1.38, 0);
    bodyGroup.add(neckMesh);

    // ── Head — smooth featureless ovoid (the whole point) ──
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.52, 0);
    bodyGroup.add(headGroup);
    this.meshes.headGroup = headGroup;

    const headGeo = new THREE.SphereGeometry(0.125, 32, 28);
    headGeo.scale(0.94, 1.2, 1.0); // gently egg-shaped, jaw narrower than crown
    const headMesh = new THREE.Mesh(headGeo, skinMat);
    headGroup.add(headMesh);

    // Hair cap — a smooth matte shell over the crown and back. No strands, no
    // hairline drama; it exists purely so the head has an unambiguous front
    // and back without resorting to a face.
    const capGeo = new THREE.SphereGeometry(0.129, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.62);
    capGeo.scale(0.97, 1.2, 1.04);
    const capMesh = new THREE.Mesh(capGeo, this._mat(cap, { roughness: 0.95 }));
    capMesh.position.set(0, 0.012, -0.012);
    capMesh.rotation.x = -0.18; // tip back so the face stays open, brow stays clear
    headGroup.add(capMesh);

    // ── Baton (built before arms so it can be parented to the hand) ──
    const batonGroup = new THREE.Group();
    const shaftGeo = new THREE.CylinderGeometry(0.0048, 0.0038, 0.36, 8);
    const shaft = new THREE.Mesh(shaftGeo, this._mat(0xf3ecdc, { roughness: 0.35 }));
    shaft.position.y = -0.18;
    batonGroup.add(shaft);
    const gripGeo = new THREE.SphereGeometry(0.016, 10, 8);
    gripGeo.scale(1, 1.3, 1);
    const grip = new THREE.Mesh(gripGeo, this._mat(0x2a2d34, { roughness: 0.8 }));
    batonGroup.add(grip);
    this.meshes.baton = batonGroup;

    // ── Arms (right carries the baton) ──
    this._buildArm(bodyGroup, 1, coat);
    this._buildArm(bodyGroup, -1, coat);
  }

  _buildArm(parent, side, jacketColor) {
    const shoulderGroup = new THREE.Group();
    shoulderGroup.position.set(side * 0.26, 1.3, 0.06);
    parent.add(shoulderGroup);

    const upperArmGroup = new THREE.Group();
    shoulderGroup.add(upperArmGroup);

    const sleeveMat = this._mat(jacketColor, { roughness: 0.9 });
    const uaGeo = new THREE.CylinderGeometry(0.044, 0.037, 0.28, 14);
    const ua = new THREE.Mesh(uaGeo, sleeveMat);
    ua.position.y = -0.14;
    upperArmGroup.add(ua);

    const elbowGroup = new THREE.Group();
    elbowGroup.position.set(0, -0.28, 0);
    upperArmGroup.add(elbowGroup);

    const faGeo = new THREE.CylinderGeometry(0.035, 0.03, 0.26, 14);
    const fa = new THREE.Mesh(faGeo, sleeveMat);
    fa.position.y = -0.13;
    elbowGroup.add(fa);

    // White shirt cuff peeking from the sleeve
    const cuffGeo = new THREE.CylinderGeometry(0.032, 0.034, 0.022, 14);
    const cuff = new THREE.Mesh(cuffGeo, this._mat(0xf0f0f4, { roughness: 0.45 }));
    cuff.position.y = -0.248;
    elbowGroup.add(cuff);

    const wristGroup = new THREE.Group();
    wristGroup.position.set(0, -0.27, 0);
    elbowGroup.add(wristGroup);

    // Hand — a simple tapered mitt (mannequin hands are stylized, not detailed)
    const handGeo = new THREE.SphereGeometry(0.027, 12, 10);
    handGeo.scale(0.85, 1.25, 0.6);
    const hand = new THREE.Mesh(handGeo, this._skinMat);
    hand.position.y = -0.022;
    wristGroup.add(hand);

    if (side === 1 && this.meshes.baton) {
      wristGroup.add(this.meshes.baton);
      this.meshes.baton.position.set(0, -0.03, 0.012);
      this.meshes.baton.rotation.x = 0.25;
    }

    const k = side === 1 ? 'R' : 'L';
    this.bones['shoulder' + k] = shoulderGroup;
    this.bones['upperArm' + k] = upperArmGroup;
    this.bones['elbow' + k] = elbowGroup;
    this.bones['wrist' + k] = wristGroup;
  }

  // ── Conducting patterns ────────────────────────────────────────────────────
  // Each beat: { pos: ictus [x,y,z], rebound: peak after the beat, sway, nod }.
  // x = stage left/right, y = up/down, z = toward/away from the audience.

  get3DPattern() {
    const n = state.beatsPerMeasure;
    const patterns = {
      1: [
        { pos: [0, -0.35, 0.15], rebound: [0, -0.05, 0.08], sway: 0, nod: 0.08 }
      ],
      2: [
        { pos: [0, -0.35, 0.15], rebound: [0.08, -0.15, 0.1], sway: 0.02, nod: 0.08 },
        { pos: [0.1, -0.15, 0.1], rebound: [0, 0.05, 0.05], sway: -0.02, nod: -0.04 }
      ],
      3: [
        { pos: [0, -0.35, 0.15], rebound: [0.15, -0.2, 0.1], sway: 0.03, nod: 0.1 },
        { pos: [0.30, -0.30, 0.12], rebound: [0.18, -0.15, 0.08], sway: 0.05, nod: 0.02 },
        { pos: [0.05, -0.12, 0.08], rebound: [0, 0.05, 0.05], sway: -0.03, nod: -0.06 }
      ],
      4: [
        { pos: [0, -0.35, 0.18], rebound: [-0.12, -0.2, 0.1], sway: -0.02, nod: 0.1 },
        { pos: [-0.22, -0.30, 0.14], rebound: [0.05, -0.18, 0.1], sway: -0.04, nod: 0.03 },
        { pos: [0.30, -0.28, 0.12], rebound: [0.18, -0.12, 0.06], sway: 0.04, nod: 0.02 },
        { pos: [0.05, -0.10, 0.08], rebound: [0, 0.05, 0.05], sway: -0.02, nod: -0.07 }
      ],
      5: [
        { pos: [0, -0.35, 0.18], rebound: [-0.12, -0.2, 0.1], sway: -0.02, nod: 0.1 },
        { pos: [-0.22, -0.30, 0.14], rebound: [0, -0.18, 0.1], sway: -0.04, nod: 0.03 },
        { pos: [0.05, -0.30, 0.14], rebound: [0.15, -0.18, 0.08], sway: 0.0, nod: 0.04 },
        { pos: [0.30, -0.26, 0.12], rebound: [0.18, -0.10, 0.06], sway: 0.05, nod: 0.02 },
        { pos: [0.05, -0.10, 0.08], rebound: [0, 0.05, 0.05], sway: -0.02, nod: -0.07 }
      ],
      6: [
        { pos: [0, -0.35, 0.18], rebound: [-0.10, -0.22, 0.1], sway: -0.02, nod: 0.1 },
        { pos: [-0.20, -0.32, 0.14], rebound: [-0.15, -0.20, 0.1], sway: -0.03, nod: 0.04 },
        { pos: [-0.12, -0.26, 0.12], rebound: [0.10, -0.18, 0.08], sway: -0.01, nod: 0.03 },
        { pos: [0.25, -0.30, 0.14], rebound: [0.20, -0.18, 0.08], sway: 0.04, nod: 0.03 },
        { pos: [0.20, -0.24, 0.12], rebound: [0.12, -0.10, 0.06], sway: 0.03, nod: 0.02 },
        { pos: [0.05, -0.10, 0.08], rebound: [0, 0.05, 0.05], sway: -0.02, nod: -0.07 }
      ]
    };
    if (patterns[n]) return patterns[n];

    // 7+ beats: down on 1, alternate left/right, up on the last.
    const pts = [{ pos: [0, -0.35, 0.18], rebound: [-0.12, -0.2, 0.1], sway: -0.02, nod: 0.1 }];
    for (let i = 1; i < n - 1; i++) {
      const x = (i % 2 === 1) ? -0.18 : 0.25;
      pts.push({ pos: [x, -0.30, 0.14], rebound: [x * 0.6, -0.2, 0.08], sway: x * 0.15, nod: 0.03 });
    }
    pts.push({ pos: [0.05, -0.10, 0.08], rebound: [0, 0.05, 0.05], sway: -0.02, nod: -0.07 });
    return pts;
  }

  // ── Current hand target from the beat clock ────────────────────────────────

  _getConductingState() {
    const pattern = this.get3DPattern();
    const n = pattern.length;

    // Resting pose when stopped: hands hang at a neutral mid-height.
    if (typeof Tone === 'undefined' || Tone.Transport.state !== 'started' || state.lastBeatTime <= 0) {
      const last = pattern[n - 1];
      return {
        pos: [
          (last.pos[0] + last.rebound[0]) / 2,
          (last.pos[1] + last.rebound[1]) / 2 - 0.05,
          (last.pos[2] + last.rebound[2]) / 2
        ],
        sway: 0,
        nod: 0
      };
    }

    const beatDuration = 60 / (state.cachedBPM || Tone.Transport.bpm.value);
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

    const lastFiredBeatIndex = (effectiveAnimBeat - 1 + state.beatsPerMeasure) % state.beatsPerMeasure;
    const fromIdx = lastFiredBeatIndex % n;
    const toIdx = (fromIdx + 1) % n;

    const p0 = pattern[fromIdx].pos;
    const p1 = pattern[fromIdx].rebound;
    const p2 = pattern[toIdx].pos;

    // Quadratic Bézier ictus→rebound→next-ictus. Steeper ease on the
    // preparation beat (last→first) so the downbeat has a clear "snap".
    const easePower = fromIdx === n - 1 ? 2.4 : 1.7;
    const t = Math.pow(progress, easePower);
    const mt = 1 - t;
    const pos = [
      mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
      mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
      mt * mt * p0[2] + 2 * mt * t * p1[2] + t * t * p2[2]
    ];
    const sway = pattern[fromIdx].sway * (1 - t) + pattern[toIdx].sway * t;
    const nod = pattern[fromIdx].nod * (1 - t) + pattern[toIdx].nod * t;
    return { pos, sway, nod };
  }

  // ── 2-bone IK (geometric, with a pole vector for the elbow) ────────────────

  _solveArmIK(side, targetX, targetY, targetZ) {
    const upperLen = 0.28;
    const lowerLen = 0.27;
    const shoulderPos = new THREE.Vector3(side * 0.26, 1.3, 0.06);
    const targetPos = new THREE.Vector3(targetX, targetY, targetZ);

    const toTarget = new THREE.Vector3().subVectors(targetPos, shoulderPos);
    let dist = toTarget.length();
    const maxReach = upperLen + lowerLen - 0.01;
    const minReach = 0.08;
    if (dist > maxReach) {
      toTarget.multiplyScalar(maxReach / dist); dist = maxReach;
      targetPos.copy(shoulderPos).add(toTarget);
    } else if (dist < minReach) {
      toTarget.multiplyScalar(minReach / Math.max(dist, 1e-6)); dist = minReach;
      targetPos.copy(shoulderPos).add(toTarget);
    }

    const proj = (upperLen * upperLen - lowerLen * lowerLen + dist * dist) / (2 * dist);
    const h2 = upperLen * upperLen - proj * proj;
    const h = h2 > 0 ? Math.sqrt(h2) : 0;
    const u = toTarget.clone().normalize();

    // Elbow points outward and slightly back, like a real conductor's stance.
    const pole = new THREE.Vector3(side, -0.4, -0.8).normalize();
    const v = pole.clone().sub(u.clone().multiplyScalar(pole.dot(u)));
    if (v.lengthSq() < 1e-6) v.set(side, 0, 0).sub(u.clone().multiplyScalar(u.x * side));
    v.normalize();

    const elbowPos = shoulderPos.clone()
      .add(u.multiplyScalar(proj))
      .add(v.multiplyScalar(h));
    return { shoulderPos, elbowPos, targetPos };
  }

  _poseArm(side, tx, ty, tz) {
    const k = side === 1 ? 'R' : 'L';
    const upperArm = this.bones['upperArm' + k];
    const elbow = this.bones['elbow' + k];
    const wrist = this.bones['wrist' + k];
    if (!upperArm || !elbow) return;

    const { shoulderPos, elbowPos, targetPos } = this._solveArmIK(side, tx, ty, tz);
    const DOWN = new THREE.Vector3(0, -1, 0);

    const upperDir = new THREE.Vector3().subVectors(elbowPos, shoulderPos).normalize();
    upperArm.quaternion.setFromUnitVectors(DOWN, upperDir);

    const forearmDirWorld = new THREE.Vector3().subVectors(targetPos, elbowPos).normalize();
    const forearmDirLocal = forearmDirWorld.applyQuaternion(upperArm.quaternion.clone().invert());
    elbow.quaternion.setFromUnitVectors(DOWN, forearmDirLocal);

    if (wrist) {
      if (side === 1) {
        const beatProg = getAnimationProgress();
        wrist.rotation.set(-0.1 + Math.sin(beatProg * Math.PI) * 0.15, 0, 0);
      } else {
        wrist.rotation.set(-0.1, 0, 0);
      }
    }
  }

  _updateBatonDrag(pos) {
    if (!this.meshes.baton) return;
    if (!this.prevHandPos) this.prevHandPos = [pos[0], pos[1], pos[2]];

    const velX = pos[0] - this.prevHandPos[0];
    const velZ = pos[2] - this.prevHandPos[2];
    this.prevHandPos[0] = pos[0];
    this.prevHandPos[1] = pos[1];
    this.prevHandPos[2] = pos[2];

    // Shaft points along local -Y, so a +X hand move should trail the tip to
    // -X (a negative Z rotation). Underdamped spring → slight wobble at ictus.
    const dragScale = 14;
    const targetLagZ = -velX * dragScale;
    const targetLagX = velZ * dragScale;
    const stiffness = 0.18, damping = 0.62;
    this.batonLagVelX = (this.batonLagVelX + (targetLagX - this.batonLagX) * stiffness) * damping;
    this.batonLagVelZ = (this.batonLagVelZ + (targetLagZ - this.batonLagZ) * stiffness) * damping;
    this.batonLagX += this.batonLagVelX;
    this.batonLagZ += this.batonLagVelZ;

    const wristFlick = Math.sin(getAnimationProgress() * Math.PI) * 0.45;
    this.meshes.baton.rotation.x = 0.25 + this.batonLagX + wristFlick;
    this.meshes.baton.rotation.z = this.batonLagZ;
  }

  // ── Pose application ────────────────────────────────────────────────────────

  _applyPose(s) {
    const pos = s.pos;
    this.currentSway += (s.sway - this.currentSway) * 0.08;
    this.currentNod += (s.nod - this.currentNod) * 0.1;

    this.breathPhase += 0.015;
    const breath = Math.sin(this.breathPhase) * 0.004;

    const t = this.clock.elapsedTime;
    const idleYaw   = Math.sin(t * 0.31) * 0.02 + Math.sin(t * 0.83 + 1.3) * 0.006;
    const idlePitch = Math.sin(t * 0.47) * 0.012 + Math.sin(t * 1.17 + 0.6) * 0.004;
    const idleRoll  = Math.sin(t * 0.23 + 2.1) * 0.006;

    if (this.bodyGroup) {
      this.bodyGroup.rotation.z = this.currentSway + idleRoll * 0.4;
      this.bodyGroup.position.y = breath;
    }
    if (this.meshes.headGroup) {
      this.meshes.headGroup.rotation.x = this.currentNod + idlePitch;
      this.meshes.headGroup.rotation.y = -this.currentSway * 0.5 + idleYaw;
      this.meshes.headGroup.rotation.z = idleRoll;
    }

    // Right hand follows the pattern; left hand mirrors it across the body.
    this._poseArm(1, pos[0] + 0.26, pos[1] + 1.3, pos[2] + 0.06);
    this._poseArm(-1, -pos[0] - 0.26, pos[1] + 1.3, pos[2] + 0.06);
    this._updateBatonDrag(pos);
  }

  // ── Frame loop ──────────────────────────────────────────────────────────────

  update() {
    if (!this.initialized) return;
    this.clock.getDelta(); // advance elapsedTime for idle motion
    this._ensureParent();
    this._updateSize();
    this._applyPose(this._getConductingState());
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
}

export function stop3DConductor() {
  if (instance) instance.stop();
}

export function resize3DConductor() {
  if (instance && instance.initialized && instance.animationFrameId) instance.resize();
}
