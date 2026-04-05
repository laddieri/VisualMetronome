// WebGPU bouncing ball demo — syncs to the metronome beat.
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
  // Renders a single full-screen triangle (no vertex buffer).
  // The fragment shader draws the ball + glow purely in pixel space.
  const shaderCode = /* wgsl */`
    struct Uniforms {
      resolution : vec2f,   // canvas size in pixels
      ballPos    : vec2f,   // ball centre in pixels (Y = 0 at bottom)
      radius     : f32,     // ball radius in pixels
      progress   : f32,     // beat progress 0 → 1
      onBeat     : f32,     // 1.0 at beat landing, fades to 0 quickly
      _pad       : f32,
    }

    @group(0) @binding(0) var<uniform> u : Uniforms;

    @vertex
    fn vs(@builtin(vertex_index) vi : u32) -> @builtin(position) vec4f {
      // One oversized triangle covers the whole clip space
      var pos = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f( 3.0, -1.0),
        vec2f(-1.0,  3.0)
      );
      return vec4f(pos[vi], 0.0, 1.0);
    }

    @fragment
    fn fs(@builtin(position) fragCoord : vec4f) -> @location(0) vec4f {
      let px  = fragCoord.xy;
      let res = u.resolution;

      // WebGPU frag coords: Y=0 at top, so flip ball Y
      let centre = vec2f(u.ballPos.x, res.y - u.ballPos.y);
      let d = distance(px, centre);

      // Background
      var col = vec3f(0.14, 0.14, 0.17);

      // Faint centre guide line
      if (abs(px.x - res.x * 0.5) < 1.0) {
        col = vec3f(0.28, 0.28, 0.32);
      }

      // Outer glow (soft halo, warm amber, brightens on beat)
      let glowR  = u.radius * 3.0;
      let glow   = max(0.0, 1.0 - d / glowR);
      col += vec3f(1.0, 0.6, 0.15) * (glow * glow * (0.20 + 0.45 * u.onBeat));

      // Ball with smooth anti-aliased edge
      let edge = smoothstep(u.radius + 1.5, u.radius - 1.5, d);
      if (edge > 0.0) {
        let bright   = 0.82 + 0.18 * u.onBeat;
        let ballCol  = vec3f(bright, bright * 0.87, bright * 0.65);
        col = mix(col, ballCol, edge);
      }

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

  // Uniforms: 8 × f32 = 32 bytes
  // [ resolution.x, resolution.y, ballPos.x, ballPos.y, radius, progress, onBeat, _pad ]
  const uniformBuffer = device.createBuffer({
    size : 32,
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
    if (elapsed > spb * 2)    return 0;                                    // stale / tabbed out
    return Math.min(elapsed / spb, 1);
  }

  // ── Render loop ───────────────────────────────────────────────────────────
  function frame() {
    const W      = canvas.width;
    const H      = canvas.height;
    const radius = 22;
    const margin = 48;

    const progress    = getBeatProgress();
    const displacement = Math.sin(progress * Math.PI); // 0 → peak at 0.5 → 0
    const ballX  = margin + displacement * (W - margin * 2);
    const ballY  = H / 2;
    const onBeat = progress < 0.08 ? 1.0 - (progress / 0.08) : 0.0;

    const udata = new Float32Array([W, H, ballX, ballY, radius, progress, onBeat, 0]);
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
