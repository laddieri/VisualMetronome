import { state } from './state.js';
import { getAnimalX, getAnimationProgress } from './stage.js';


class Circle {
  constructor(direction){
    this.direction = direction;
    this.x = 100;
    this.y = 240;
    this.baseY = 240;
    this.size = 180; // Diameter of the circle
  }

  pigmove(){
    this.x = getAnimalX(this.direction);
    this.y = this.baseY;
  }

  display(){
    var bx = this.x;
    var by = this.y;
    var r  = this.size / 2;
    noStroke();

    switch (state.notationBallStyle) {
      case 'shoe': {
        var uc = color(state.circleColor);
        // Sole (white, thick)
        fill(240);
        beginShape();
        vertex(bx - r, by + r * 0.12);
        vertex(bx - r, by + r * 0.52);
        quadraticVertex(bx - r, by + r * 0.68, bx - r * 0.85, by + r * 0.68);
        vertex(bx + r * 0.85, by + r * 0.68);
        quadraticVertex(bx + r, by + r * 0.68, bx + r, by + r * 0.52);
        vertex(bx + r, by + r * 0.12);
        endShape(CLOSE);
        // Upper (colored, heel taller on left)
        fill(uc);
        beginShape();
        vertex(bx - r * 0.9, by + r * 0.12);
        bezierVertex(bx - r, by - r * 0.5, bx - r * 0.85, by - r, bx - r * 0.3, by - r);
        bezierVertex(bx + r * 0.45, by - r, bx + r * 0.95, by - r * 0.42, bx + r, by + r * 0.12);
        endShape(CLOSE);
        break;
      }
      case 'heart': {
        fill(color(state.circleColor));
        beginShape();
        vertex(bx, by + r * 0.8);
        bezierVertex(bx - r * 0.1, by + r * 0.4, bx - r, by - r * 0.05, bx - r, by - r * 0.2);
        bezierVertex(bx - r, by - r * 0.8, bx - r * 0.1, by - r, bx, by - r * 0.5);
        bezierVertex(bx + r * 0.1, by - r, bx + r, by - r * 0.8, bx + r, by - r * 0.2);
        bezierVertex(bx + r, by - r * 0.05, bx + r * 0.1, by + r * 0.4, bx, by + r * 0.8);
        endShape(CLOSE);
        break;
      }
      case 'star': {
        fill(color(state.circleColor));
        beginShape();
        for (var i = 0; i < 10; i++) {
          var a = (i * TWO_PI / 10) - HALF_PI;
          var rad = (i % 2 === 0) ? r : r * 0.42;
          vertex(bx + cos(a) * rad, by + sin(a) * rad);
        }
        endShape(CLOSE);
        break;
      }
      case 'face': {
        fill(255, 220, 80);
        ellipse(bx, by, this.size, this.size);
        fill(30);
        ellipse(bx - r * 0.3, by - r * 0.2, r * 0.22, r * 0.3);
        ellipse(bx + r * 0.3, by - r * 0.2, r * 0.22, r * 0.3);
        noFill();
        stroke(30);
        strokeWeight(r * 0.1);
        arc(bx, by + r * 0.1, r * 0.8, r * 0.55, 0, PI);
        noStroke();
        break;
      }
      case 'note': {
        fill(color(state.circleColor));
        push();
        translate(bx - r * 0.15, by + r * 0.35);
        rotate(-0.4);
        ellipse(0, 0, r * 0.75, r * 0.52);
        pop();
        rect(bx + r * 0.19, by - r * 0.6, r * 0.13, r * 0.98);
        noFill();
        stroke(color(state.circleColor));
        strokeWeight(r * 0.12);
        beginShape();
        vertex(bx + r * 0.32, by - r * 0.6);
        bezierVertex(bx + r * 0.9, by - r * 0.25, bx + r * 0.7, by + r * 0.05, bx + r * 0.32, by + r * 0.05);
        endShape();
        noStroke();
        break;
      }
      default: { // 'ball'
        fill(color(state.circleColor));
        ellipse(bx, by, this.size, this.size);
      }
    }
  }
}

class Pig {
  constructor(direction){
    this.direction=direction;
    this.x = 100;
    this.y = 240; // Base Y position
    this.baseY = 240;
  }

  pigmove(){
    this.x = getAnimalX(this.direction);
    this.y = this.baseY;
  }

  display(){
      var bodyX = this.x; // variables
      var bodyY = this.y;
      fill(250, 192, 196); //legs
    rect(bodyX+18, bodyY+73, 18, 68);
    rect(bodyX-47, bodyY+71, 18, 68);

    ellipse(bodyX, bodyY, 245, 245); // body

    fill(163, 124, 127);//lefteare
    triangle(bodyX, bodyY-54, bodyX-70, bodyY+15, bodyX-66,bodyY-87);

    //rightears
    triangle(bodyX+65, bodyY+24, bodyX+70, bodyY-85, bodyX-8,bodyY-58);
    fill(13, 13, 13); // earefill

    triangle(bodyX+26, bodyY+62, bodyX+65, bodyY-77, bodyX-38,bodyY-24); // earefill
    triangle(bodyX, bodyY-31, bodyX-52, bodyY+38, bodyX-59,bodyY-77);
    fill(217, 165, 169);
    ellipse(bodyX, bodyY, 155, 144); //head

    fill(224, 107, 117); //nose
    ellipse(bodyX, bodyY+13, 71, 60);

    fill(0, 0, 0); //nosefill
    ellipse(bodyX-10, bodyY+12, 11, 19);
    ellipse(bodyX+10, bodyY+12, 11, 19);

    ellipse(bodyX-17, bodyY-24, 6, 15); //pupils
    ellipse(bodyX+17, bodyY-24, 6, 15);

    fill(259, 192, 196); //legs
    rect(bodyX-81, bodyY+78, 18, 68);
    rect(bodyX+51, bodyY+72, 18, 68);
    fill(8, 8, 8);
    ellipse(bodyX-72, bodyY+141, 21, 11);
    ellipse(bodyX+60, bodyY+141, 21, 11);
    ellipse(bodyX-38, bodyY+138, 18, 10);
    ellipse(bodyX+28, bodyY+138, 18, 10);
  }
}

class Selfie {
  constructor(direction){
    this.direction = direction;
    this.x = 100;
    this.y = 240;
    this.baseY = 240;
    this.size = 280; // Size of the circular face (larger for better visibility)
  }

  pigmove(){
    this.x = getAnimalX(this.direction);
    this.y = this.baseY;
  }

  display(){
    var bodyX = this.x;
    var bodyY = this.y;

    if (state.selfieImage) {
      // Draw the selfie image in a circle
      push();

      // Create circular clipping mask
      imageMode(CENTER);

      // Draw circular border/background
      fill(255);
      stroke(102, 126, 234); // Purple border
      strokeWeight(4);
      ellipse(bodyX, bodyY, this.size + 8, this.size + 8);

      // Clip to circle and draw image
      // Use a graphics buffer for circular mask
      let diameter = this.size;

      // Draw the image
      noStroke();

      // Create circular clip using drawingContext
      drawingContext.save();
      drawingContext.beginPath();
      drawingContext.arc(bodyX, bodyY, diameter / 2, 0, Math.PI * 2);
      drawingContext.clip();

      // Draw the selfie image
      // When mirrorSelfies is true, mirror based on direction so images face each other
      // direction 1 = right side, direction -1 = left side
      push();
      translate(bodyX, bodyY);
      if (state.mirrorSelfies) {
        // Mirror the right image (direction 1) so they face each other
        if (this.direction === 1) {
          scale(-1, 1);
        }
      } else {
        // When not mirroring, show both images with same orientation (mirrored for natural selfie look)
        scale(-1, 1);
      }
      image(state.selfieImage, 0, 0, diameter, diameter);
      pop();

      drawingContext.restore();

      pop();
    } else {
      // Placeholder when no selfie is captured
      fill(200);
      stroke(150);
      strokeWeight(3);
      ellipse(bodyX, bodyY, this.size, this.size);

      // Draw camera icon placeholder
      noStroke();
      fill(120);
      textAlign(CENTER, CENTER);
      textSize(40);
      text("📸", bodyX, bodyY);

      textSize(14);
      fill(100);
      text("Select Selfie", bodyX, bodyY + 50);
    }
  }
}

class Conductor {
  constructor(direction) {
    this.direction = direction; // 1 = right hand, -1 = left hand
    this.x = direction === 1 ? 450 : 190;
    this.y = 200;
    this.handSize = 32;

    // Baton tip physics (only used by the hand holding the baton, direction === -1).
    // The tip is simulated as a point with its own velocity, pulled toward its
    // rest position by a spring. As the hand moves, the tip lags behind, and
    // when the hand stops sharply at the ictus the tip wobbles briefly.
    this.batonTipX = null;
    this.batonTipY = null;
    this.batonTipVX = 0;
    this.batonTipVY = 0;
  }

  // Conducting patterns using Bezier curves for realistic motion.
  // Each beat is defined by an ictus point (the precise beat location) and a
  // control point (the rebound peak after the beat). The hand follows a quadratic
  // Bezier curve: ictus → rebound peak → next ictus, with ease-in timing so the
  // hand lingers at the rebound and accelerates into each ictus — just like a
  // real conductor's baton.
  //
  // Standard conducting patterns (right hand, viewer's perspective):
  //   2-beat: Down, Up                     (J-arc)
  //   3-beat: Down, Right, Up              (triangle)
  //   4-beat: Down, Left, Right, Up        (cross / t-shape)
  //   5-beat: Down, Left, Center, Right, Up (3+2 subdivision)
  //   6-beat: Down, Left-low, Left, Right, Right, Up (German six)
  //
  // All ictus x-values are >= 320 so hands never cross the center line.
  // Left hand is mirrored around x = 320.

  getRightHandPattern() {
    const n = state.beatsPerMeasure;

    // { ictus: [x,y] = where the beat lands, control: [x,y] = rebound peak after }
    const patterns = {
      1: [
        { ictus: [465, 440], control: [465, 175] }
      ],
      2: [
        { ictus: [465, 442], control: [478, 330] },   // beat 1 (down) → rebound up-right
        { ictus: [478, 436], control: [465, 175] }     // beat 2 (up)   → BIG rebound (prep)
      ],
      3: [
        { ictus: [458, 442], control: [505, 325] },   // beat 1 (down)  → rebound up-right
        { ictus: [535, 435], control: [502, 320] },    // beat 2 (right) → rebound up
        { ictus: [478, 360], control: [460, 175] }     // beat 3 (up)    → BIG rebound
      ],
      4: [
        { ictus: [462, 445], control: [418, 330] },   // beat 1 (down)  → rebound up-left
        { ictus: [385, 438], control: [460, 325] },    // beat 2 (left)  → rebound up-right
        { ictus: [538, 435], control: [512, 320] },    // beat 3 (right) → rebound up
        { ictus: [480, 358], control: [462, 175] }     // beat 4 (up)    → BIG rebound
      ],
      5: [
        { ictus: [460, 445], control: [412, 335] },   // beat 1 (down)  → rebound up-left
        { ictus: [385, 440], control: [462, 330] },    // beat 2 (left)  → rebound up-center
        { ictus: [465, 442], control: [510, 328] },    // beat 3 (center)→ rebound up-right
        { ictus: [535, 434], control: [510, 320] },    // beat 4 (right) → rebound up
        { ictus: [480, 358], control: [462, 175] }     // beat 5 (up)    → BIG rebound
      ],
      6: [
        { ictus: [462, 445], control: [420, 340] },   // beat 1 (down)      → rebound up-left
        { ictus: [392, 442], control: [396, 345] },    // beat 2 (left-low)  → rebound up
        { ictus: [402, 438], control: [468, 328] },    // beat 3 (left)      → rebound up-right
        { ictus: [530, 440], control: [522, 335] },    // beat 4 (right)     → rebound up
        { ictus: [512, 434], control: [496, 322] },    // beat 5 (right-in)  → rebound up
        { ictus: [478, 358], control: [462, 175] }     // beat 6 (up)        → BIG rebound
      ]
    };

    if (patterns[n]) return patterns[n];

    // Fallback for 7+ beats: alternate inner/outer ictus positions with
    // proportional rebound heights; last beat gets the big preparatory rebound.
    const pts = [{ ictus: [462, 445], control: [420, 335] }];
    for (let i = 1; i < n - 1; i++) {
      const isInner = i % 2 === 1;
      const ix = isInner ? 390 : 535;
      const iy = 440 - i * 0.5;               // subtle staircase up
      const cx = isInner ? 440 : 510;
      const cy = 330 - i * 0.5;
      pts.push({ ictus: [ix, iy], control: [cx, cy] });
    }
    pts.push({ ictus: [478, 358], control: [462, 175] });
    return pts;
  }

  getPattern() {
    const rightPattern = this.getRightHandPattern();
    if (this.direction === 1) return rightPattern;
    // Mirror x around canvas center (320) for left hand
    return rightPattern.map(({ ictus, control }) => ({
      ictus:   [640 - ictus[0],   ictus[1]],
      control: [640 - control[0], control[1]]
    }));
  }

  getConductorPosition() {
    const pattern = this.getPattern();
    const n = pattern.length;
    if (n === 0) return [this.x, this.y];

    // When stopped, rest at a comfortable preparatory position — hands at
    // moderate height, not as high as the rebound peak during active conducting.
    if (Tone.Transport.state !== 'started' || state.lastBeatTime <= 0) {
      const lastCtrl = pattern[n - 1].control;
      const lastIctus = pattern[n - 1].ictus;
      // Rest halfway between the last ictus and its rebound peak
      return [(lastCtrl[0] + lastIctus[0]) / 2, (lastCtrl[1] + lastIctus[1]) / 2];
    }

    // Compute progress and segment selection independently of getAnimationProgress()
    // so we can handle the Bluetooth delay window correctly for Bezier animation.
    // During the delay window, animBeat has already incremented but the audio hasn't
    // reached the speaker yet — we must keep the previous segment so the hand
    // arrives at the ictus exactly when the sound plays (not when it fires).
    const beatDuration = state.secondsPerBeat || (60 / (Tone.Transport.bpm.value || 96));
    const timeSinceLastBeat = Tone.now() - state.lastBeatTime - (state.bluetoothDelay / 1000);

    let progress, effectiveAnimBeat;
    if (timeSinceLastBeat < 0) {
      // Bluetooth delay window: continue on the previous segment.
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

    // Bezier endpoints: current ictus → rebound peak → next ictus
    const p0 = pattern[fromIdx].ictus;
    const p1 = pattern[fromIdx].control;
    const p2 = pattern[toIdx].ictus;

    // Ease-in timing: hand lingers at rebound peak, accelerates into the ictus.
    // Stronger ease for the large preparatory rebound (last beat → downbeat)
    // so the conductor visibly "hangs" at the top before sweeping down.
    const easePower = fromIdx === n - 1 ? 2.2 : 1.6;
    const t = Math.pow(progress, easePower);

    // Quadratic Bezier: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
    const mt = 1 - t;
    return [
      mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
      mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
    ];
  }

  pigmove() {
    const [x, y] = this.getConductorPosition();
    this.x = x;
    this.y = y;
  }

  display() {
    // Silhouette geometry — shared with arm anchor so arms connect to the shoulders
    const headX = 320;
    const headY = 144;
    const headDiam = 259;
    const neckW = 40;
    const neckTop = headY + headDiam / 2 - 10;
    const torsoTop = neckTop + 30;
    const shoulderW = 200;

    // Arm originates from the outer shoulder edge of the silhouette torso
    const shoulderX = this.direction === 1 ? headX + shoulderW / 2 : headX - shoulderW / 2;
    const shoulderY = torsoTop;

    // Draw silhouette and head — once only from the direction===1 instance
    if (this.direction === 1) {
      // Body silhouette — light in dark mode so it's visible against the dark canvas
      const silhouetteIsDark = window.vmCanvasBg === '#1e293b';
      push();
      noStroke();
      if (silhouetteIsDark) {
        fill(200, 215, 230, 160);
      } else {
        fill(0, 0, 0, 60);
      }

      ellipse(headX, headY, headDiam, headDiam);
      rect(headX - neckW / 2, neckTop, neckW, 35);

      const torsoBot = 465;
      const waistW = 130;
      beginShape();
      vertex(headX - shoulderW / 2, torsoTop);
      vertex(headX + shoulderW / 2, torsoTop);
      vertex(headX + waistW / 2, torsoBot);
      vertex(headX - waistW / 2, torsoBot);
      endShape(CLOSE);

      pop();

      if (state.conductorSelfieImage) {
        // Purple border ring matching the selfie mode style
        noStroke();
        fill(102, 126, 234);
        ellipse(headX, headY, headDiam + 8, headDiam + 8);

        // Circular clip and draw selfie
        drawingContext.save();
        drawingContext.beginPath();
        drawingContext.arc(headX, headY, headDiam / 2, 0, Math.PI * 2);
        drawingContext.clip();

        push();
        imageMode(CENTER);
        noStroke();
        image(state.conductorSelfieImage, headX, headY, headDiam, headDiam);
        pop();

        drawingContext.restore();
      }
    }

    if (state.conductorSelfieImage) {
      // Draw arm from silhouette shoulder to hand
      stroke(180, 130, 80);
      strokeWeight(6);
      line(shoulderX, shoulderY, this.x, this.y);
    }

    // Conductor's right hand (direction === -1, left side of canvas from viewer) holds the baton.
    // The tip lags the hand during acceleration and wobbles slightly at the ictus,
    // modeled as a point with its own momentum held to the hand by a spring.
    if (this.direction === -1) {
      const batonLen = 60;
      // Wrist-flick: baton tip rises to its highest point at the "and" of each beat
      // (halfway between ictuses). sin(progress*π) peaks at 0.5 and returns to 0
      // at beat boundaries, creating a natural wrist-rotation arc.
      const beatProgress = state.lastBeatTime > 0 ? getAnimationProgress() : 0;
      const wristLift = Math.sin(beatProgress * Math.PI) * (Math.PI * 0.22);
      const baseAngle = Math.PI * 0.11 - wristLift;
      const restX = this.x + Math.cos(baseAngle) * batonLen;
      const restY = this.y + Math.sin(baseAngle) * batonLen;

      if (this.batonTipX === null) {
        this.batonTipX = restX;
        this.batonTipY = restY;
      }

      // Spring-damper: underdamped so the tip overshoots slightly when the hand stops.
      const stiffness = 0.22;
      const damping = 0.68;
      this.batonTipVX = (this.batonTipVX + (restX - this.batonTipX) * stiffness) * damping;
      this.batonTipVY = (this.batonTipVY + (restY - this.batonTipY) * stiffness) * damping;
      this.batonTipX += this.batonTipVX;
      this.batonTipY += this.batonTipVY;

      // Keep the baton rigid: project the tip back to exactly batonLen from the hand.
      let dx = this.batonTipX - this.x;
      let dy = this.batonTipY - this.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      dx = (dx / d) * batonLen;
      dy = (dy / d) * batonLen;
      this.batonTipX = this.x + dx;
      this.batonTipY = this.y + dy;

      stroke(230, 220, 200);
      strokeWeight(3);
      line(this.x, this.y, this.batonTipX, this.batonTipY);
    }

    // Draw hand
    noStroke();
    fill(255, 210, 170);
    ellipse(this.x, this.y, this.handSize, this.handSize);
    // Subtle highlight
    fill(255, 235, 210, 160);
    ellipse(this.x - 4, this.y - 5, 10, 10);
  }
}

class PendulumMetronome {
  constructor() {
    this.direction = 1; // kept for API compatibility
  }

  pigmove() {}

  display() {
    const progress = getAnimationProgress();
    const isRunning = Tone.Transport.state === 'started' && state.lastBeatTime > 0;

    let angle = 0;
    if (isRunning) {
      const maxAngle = 0.42;
      const sideSign = (state.animBeat % 2 === 0) ? 1 : -1;
      angle = Math.cos(progress * Math.PI) * maxAngle * sideSign;
    }

    const cx = 320;

    // Classic pyramidal case: wide base at bottom, narrow tip at top
    const bodyTopY  = 195;
    const bodyBotY  = 445;
    const bodyTopHW = 22;
    const bodyBotHW = 90;

    const panelTopY  = bodyTopY + 8;
    const panelBotY  = bodyBotY - 6;
    const panelTopHW = bodyTopHW - 5;
    const panelBotHW = bodyBotHW - 10;

    // Pivot is near the base, hidden inside the wood
    const pivotX   = cx;
    const pivotY   = 428;
    const rodLen   = 345; // tip at y = 428-345 = 83

    // exitDist: how far from pivot to the case top opening
    const exitDist = pivotY - bodyTopY; // 233

    // Weight: slow BPM → high (far from pivot), fast BPM → lower (near case top)
    const bpm       = constrain(state.cachedBPM, 40, 240);
    // weightDst is the signed distance from pivot along the rod (positive = above pivot).
    // Range: 310 (near tip, slow) → -10 (near case bottom, fast)
    const weightDst = map(bpm, 40, 240, 310, -10);

    // ── 1. Body drawn first (behind the pendulum) ─────────────────
    push();
    translate(cx, 0);

    // Drop shadow
    fill(0, 0, 0, 40);
    noStroke();
    beginShape();
    vertex(-bodyBotHW + 6, bodyBotY + 6);
    vertex( bodyBotHW + 6, bodyBotY + 6);
    vertex( bodyTopHW + 6, bodyTopY + 6);
    vertex(-bodyTopHW + 6, bodyTopY + 6);
    endShape(CLOSE);

    // Main body — dark mahogany
    fill(95, 52, 22);
    noStroke();
    beginShape();
    vertex(-bodyBotHW, bodyBotY);
    vertex( bodyBotHW, bodyBotY);
    vertex( bodyTopHW, bodyTopY);
    vertex(-bodyTopHW, bodyTopY);
    endShape(CLOSE);

    // Left wood-grain highlight
    fill(130, 75, 35, 70);
    beginShape();
    vertex(-bodyBotHW,      bodyBotY);
    vertex(-bodyBotHW + 22, bodyBotY);
    vertex(-bodyTopHW + 8,  bodyTopY);
    vertex(-bodyTopHW,      bodyTopY);
    endShape(CLOSE);

    // Right-edge darkening
    fill(60, 30, 10, 60);
    beginShape();
    vertex( bodyBotHW,      bodyBotY);
    vertex( bodyBotHW - 12, bodyBotY);
    vertex( bodyTopHW - 4,  bodyTopY);
    vertex( bodyTopHW,      bodyTopY);
    endShape(CLOSE);

    // Front panel — lighter face
    fill(140, 95, 48);
    beginShape();
    vertex(-panelBotHW, panelBotY);
    vertex( panelBotHW, panelBotY);
    vertex( panelTopHW, panelTopY);
    vertex(-panelTopHW, panelTopY);
    endShape(CLOSE);

    // Tempo scale lines etched on panel
    stroke(70, 45, 20);
    strokeWeight(1.5);
    const lineCount = 8;
    for (let i = 0; i <= lineCount; i++) {
      const t  = i / lineCount;
      const ly = panelBotY + (panelTopY - panelBotY) * t;
      const hw = panelBotHW + (panelTopHW - panelBotHW) * t;
      const ml = (i === 0 || i === lineCount || i === Math.round(lineCount / 2)) ? 12 : 7;
      line(-hw + 4, ly, -hw + 4 + ml, ly);
      line( hw - 4, ly,  hw - 4 - ml, ly);
    }
    noStroke();

    // Slot at top of case where the rod exits
    fill(75, 40, 15);
    rect(-3, bodyTopY - 1, 6, 14);

    // Base platform
    fill(65, 35, 12);
    rect(-bodyBotHW - 10, bodyBotY, bodyBotHW * 2 + 20, 14, 3);

    // Feet
    fill(50, 25, 8);
    rect(-bodyBotHW - 10, bodyBotY + 14, 20, 7, 2);
    rect( bodyBotHW - 10, bodyBotY + 14, 20, 7, 2);

    pop();

    // ── 2. Pendulum drawn on top of body, only the above-case portion ─
    // Only draw from the case-top exit point to the rod tip — this keeps
    // the rod from visually crossing the body face below the exit slot.
    push();
    translate(pivotX, pivotY);
    rotate(angle);

    stroke(55, 55, 62);
    strokeWeight(3.5);
    line(0, bodyBotY - pivotY, 0, -rodLen);
    noStroke();

    // Pointer tip — triangle at top of rod
    fill(45, 45, 52);
    triangle(-5, -rodLen + 5, 5, -rodLen + 5, 0, -rodLen - 12);

    // Sliding weight (diamond / lozenge)
    push();
    translate(0, -weightDst);
    const ww = 22, wh = 32;
    fill(75, 75, 82);
    stroke(45, 45, 52);
    strokeWeight(1);
    beginShape();
    vertex(0,       -wh / 2);
    vertex( ww / 2,  0);
    vertex(0,        wh / 2);
    vertex(-ww / 2,  0);
    endShape(CLOSE);
    noStroke();
    fill(130, 130, 138, 140);
    beginShape();
    vertex(0,       -wh / 2);
    vertex( ww / 2,  0);
    vertex(0,        0);
    vertex(-ww / 4, -wh / 4);
    endShape(CLOSE);
    pop();

    pop();
  }
}

// Function to create animals based on selected type
export function createAnimals() {
  switch(state.animalType) {
    case 'circle':
      if (state.notationBallStyle === 'pig') {
        state.animal1 = new Pig(1);
        state.animal2 = new Pig(-1);
      } else if (state.notationBallStyle === 'selfie') {
        state.animal1 = new Selfie(1);
        state.animal2 = new Selfie(-1);
      } else {
        state.animal1 = new Circle(1);
        state.animal2 = new Circle(-1);
      }
      break;
    // case 'pig':    // removed from animation menu; available as a shape in 'circle' mode
    //   animal1 = new Pig(1);
    //   animal2 = new Pig(-1);
    //   break;
    // case 'selfie': // removed from animation menu
    //   animal1 = new Selfie(1);
    //   animal2 = new Selfie(-1);
    //   break;
    case 'conductor':
      state.animal1 = new Conductor(1);  // right hand
      state.animal2 = new Conductor(-1); // left hand
      break;
    case 'pendulum':
      state.animal1 = new PendulumMetronome();
      state.animal2 = null;
      break;
    // case 'conductor3d': // disabled — re-enable by restoring conductor3d.js script tag
    //   animal1 = new Circle(1);
    //   animal2 = new Circle(-1);
    //   break;
    // case 'webgpu':      // disabled — re-enable by restoring webgpu-ball.js script tag
    //   animal1 = new Circle(1);
    //   animal2 = new Circle(-1);
    //   break;
    case 'score':
      // Notation display handles its own rendering; p5 animals are unused
      state.animal1 = new Circle(1);
      state.animal2 = new Circle(-1);
      break;
    default:
      state.animal1 = new Circle(1);
      state.animal2 = new Circle(-1);
      break;
  }
}
