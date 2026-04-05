// WebGPU bouncing ball demo — syncs to the metronome beat.
// Two balls mirror the p5.js animation: both start at centre on the beat,
// fly to opposite sides, and return to centre on the next beat.
// Reads lastBeatTime, secondsPerBeat, bluetoothDelay, and Tone from global
// scope (set by script.js). Does NOT modify any existing animation code.

(async function initWebGPUBall() {
  const wrapper = document.getElementById('webgpu-ball-wrapper');
  if (!wrapper) return;

  // --- WebGPU availability check ---
  if (!navigator.gpu) {
    wrapper.innerHTML =
      '<p class="webgpu-unsupported">WebGPU not supported — try Chrome 113+ or Edge 113+.</p>';
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    wrapper.innerHTML = '<p class="webgpu-unsupported">No WebGPU adapter found.</p>';
    return;
  }

  const device = await adapter.requestDevice();

  const canvas = document.createElement('canvas');
  canvas.width  = 640;
  canvas.height = 120;
  wrapper.appendChild(canvas);

  const gpuContext = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  gpuContext.configure({ device, format, alphaMode: 'opaque' });

  // ── WGSL shader ──────────────────────────────────────────────────────────
  // Full-screen triangle; fragment shader draws two balls + glows in pixel space.
  //
  // Uniform layout (48 bytes, 16-byte aligned):
  //   offset  0: resolution  vec2f
  //   offset  8: ball1Pos    vec2f
  //   offset 16: ball2Pos    vec2f
  //   offset 24: radius      f32
  //   offset 28: progress    f32
  //   offset 32: onBeat      f32
  //   offset 36: _pad        f32  (×3 to reach 48 bytes)
  const shaderCode = /* wgsl */`
    struct Uniforms {
      resolution : vec2f,
      ball1Pos   : vec2f,
      ball2Pos   : vec2f,
      radius     : f32,
      progress   : f32,
      onBeat     : f32,
      _pad0      : f32,
      _pad1      : f32,
      _pad2      : f32,
    }

    @group(0) @binding(0) var<uniform> u : Uniforms;

    @vertex
    fn vs(@builtin(vertex_index) vi : u32) -> @builtin(position) vec4f {
      var pos = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f( 3.0, -1.0),
        vec2f(-1.0,  3.0)
      );
      return vec4f(pos[vi], 0.0, 1.0);
    }

    // Draw one ball + glow contribution into col.
    // ballPos uses bottom-left origin (Y flipped for WebGPU frag coords).
    fn drawBall(px: vec2f, centre: vec2f, radius: f32, onBeat: f32, col: vec3f) -> vec3f {
      var c = col;
      let d = distance(px, centre);

      // Outer glow
      let glowR = radius * 3.2;
      let glow  = max(0.0, 1.0 - d / glowR);
      c += vec3f(1.0, 0.6, 0.15) * (glow * glow * (0.18 + 0.40 * onBeat));

      // Ball with smooth edge
      let edge = smoothstep(radius + 1.5, radius - 1.5, d);
      if (edge > 0.0) {
        let bright  = 0.82 + 0.18 * onBeat;
        let ballCol = vec3f(bright, bright * 0.87, bright * 0.65);
        c = mix(c, ballCol, edge);
      }
      return c;
    }

    @fragment
    fn fs(@builtin(position) fragCoord : vec4f) -> @location(0) vec4f {
      let px  = fragCoord.xy;
      let res = u.resolution;

      // Background
      var col = vec3f(0.14, 0.14, 0.17);

      // Faint centre guide line
      if (abs(px.x - res.x * 0.5) < 1.0) {
        col = vec3f(0.28, 0.28, 0.32);
      }

      // WebGPU Y=0 is top; balls are supplied with Y=0 at bottom, so flip
      let c1 = vec2f(u.ball1Pos.x, res.y - u.ball1Pos.y);
      let c2 = vec2f(u.ball2Pos.x, res.y - u.ball2Pos.y);

      col = drawBall(px, c1, u.radius, u.onBeat, col);
      col = drawBall(px, c2, u.radius, u.onBeat, col);

      return vec4f(col, 1.0);
    }
  `;

  const shaderModule = device.createShaderModule({ code: shaderCode });

  const pipeline = device.createRenderPipeline({
    layout  : 'auto',
    vertex  : { module: shaderModule, entryPoint: 'vs' },
    fragment: { module: shaderModule, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  // 12 × f32 = 48 bytes (multiple of 16 as required by WebGPU)
  // [ res.x, res.y, b1x, b1y, b2x, b2y, radius, progress, onBeat, p0, p1, p2 ]
  const uniformBuffer = device.createBuffer({
    size : 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    layout : pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // ── Beat progress (mirrors getAnimationProgress in script.js) ────────────
  function getBeatProgress() {
    if (typeof lastBeatTime === 'undefined' || lastBeatTime <= 0) return 0;
    if (typeof Tone === 'undefined' || Tone.Transport.state !== 'started') return 0;

    const spb = (typeof secondsPerBeat !== 'undefined' && secondsPerBeat > 0)
      ? secondsPerBeat
      : 60 / ((Tone.Transport.bpm && Tone.Transport.bpm.value) || 96);

    const delay   = (typeof bluetoothDelay !== 'undefined' ? bluetoothDelay : 0) / 1000;
    const elapsed = Tone.now() - lastBeatTime - delay;

    if (elapsed < 0)          return Math.max(0, (elapsed + spb) / spb); // BT delay tail
    if (elapsed > spb * 2)    return 0;                                   // stale / tabbed out
    return Math.min(elapsed / spb, 1);
  }

  // ── Render loop ───────────────────────────────────────────────────────────
  function frame() {
    const W      = canvas.width;
    const H      = canvas.height;
    const radius = 22;

    const progress = getBeatProgress();

    // Mirrors getAnimalX() in script.js:
    //   displacement = sin(progress * π) * 200  (base coords: 640 px wide)
    //   ball1 = centre + displacement   (direction = +1)
    //   ball2 = centre - displacement   (direction = -1)
    // Both balls are at centre (320) when progress = 0 (on the beat) and
    // fly to the sides as the beat progresses, returning at progress = 1.
    const baseDisplacement = 200;
    const displacement = Math.sin(progress * Math.PI) * baseDisplacement;
    const centreX = W / 2;
    const ballY   = H / 2;
    const ball1X  = centreX + displacement;
    const ball2X  = centreX - displacement;

    // Bright flash on beat landing, fades over first 8% of the beat
    const onBeat = progress < 0.08 ? 1.0 - (progress / 0.08) : 0.0;

    const udata = new Float32Array([
      W, H,           // resolution
      ball1X, ballY,  // ball1Pos
      ball2X, ballY,  // ball2Pos
      radius,         // radius
      progress,       // progress
      onBeat,         // onBeat
      0, 0, 0,        // padding
    ]);
    device.queue.writeBuffer(uniformBuffer, 0, udata);

    const encoder = device.createCommandEncoder();
    const pass    = encoder.beginRenderPass({
      colorAttachments: [{
        view       : gpuContext.getCurrentTexture().createView(),
        clearValue : { r: 0.14, g: 0.14, b: 0.17, a: 1 },
        loadOp     : 'clear',
        storeOp    : 'store',
      }],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3); // full-screen triangle, no vertex buffer
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
