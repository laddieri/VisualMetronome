// WebGPU bouncing ball demo — syncs to the metronome beat.
//
// Uses a WebGPU compute shader to simulate 64 particles that burst from the
// centre each time the two balls meet.  The render pass draws balls + particles
// in a single full-screen triangle fragment shader.
//
// Reads lastBeatTime, secondsPerBeat, bluetoothDelay, Tone from global scope.
// Does NOT modify any existing animation code.

(async function initWebGPUBall() {
  const wrapper = document.getElementById('webgpu-ball-wrapper');
  if (!wrapper) return;

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
  canvas.height = 160;   // taller to give particles room to travel
  wrapper.appendChild(canvas);

  const gpuContext = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  gpuContext.configure({ device, format, alphaMode: 'opaque' });

  // ── Constants ────────────────────────────────────────────────────────────
  const N = 64; // particle count — matches compute workgroup_size so 1 dispatch handles all

  // ── Particle storage buffer ───────────────────────────────────────────────
  // Struct layout (per particle, 24 bytes):
  //   offset  0: pos  vec2f  (x, y — Y=0 at bottom)
  //   offset  8: vel  vec2f  (pixels/second)
  //   offset 16: life f32    (1.0 = just spawned, 0.0 = dead)
  //   offset 20: _pad f32
  const particleBuffer = device.createBuffer({
    size : N * 24,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  // Initialise all particles as dead (life = 0)
  device.queue.writeBuffer(particleBuffer, 0, new Float32Array(N * 6));

  // ── Compute shader ────────────────────────────────────────────────────────
  // Runs once per frame.  When spawnBurst = 1.0 it re-initialises every
  // particle from the centre with a deterministic pseudo-random angle & speed.
  // Otherwise it integrates position, applies drag, and decrements life.
  //
  // Compute uniforms (16 bytes):
  //   offset  0: dt         f32  (frame delta-time in seconds)
  //   offset  4: spawnBurst f32  (1.0 on beat landing frame, else 0.0)
  //   offset  8: spawnX     f32  (canvas centre X in pixels)
  //   offset 12: spawnY     f32  (canvas centre Y in pixels)
  const computeShaderCode = /* wgsl */`
    struct Particle {
      pos  : vec2f,
      vel  : vec2f,
      life : f32,
      _pad : f32,
    }

    struct CUniforms {
      dt         : f32,
      spawnBurst : f32,
      spawnX     : f32,
      spawnY     : f32,
    }

    @group(0) @binding(0) var<uniform>            cu        : CUniforms;
    @group(0) @binding(1) var<storage, read_write> particles : array<Particle>;

    // Fast integer hash → float in [0, 1)
    fn hash(n: u32) -> f32 {
      var x = n;
      x ^= x >> 16u;
      x  = x * 0x45d9f3bu;
      x ^= x >> 16u;
      return f32(x & 0x00ffffffu) / f32(0x01000000u);
    }

    @compute @workgroup_size(${N})
    fn cs(@builtin(global_invocation_id) gid: vec3u) {
      let i = gid.x;
      var p = particles[i];

      if (cu.spawnBurst > 0.5) {
        // Burst: scatter from centre with random angle + speed
        let angle = hash(i * 7u  + 1u) * 6.28318530;
        let speed = hash(i * 13u + 3u) * 200.0 + 80.0;   // 80–280 px/s
        p.pos  = vec2f(cu.spawnX, cu.spawnY);
        p.vel  = vec2f(cos(angle) * speed, sin(angle) * speed);
        p.life = hash(i * 3u + 11u) * 0.35 + 0.65;       // 0.65–1.0 initial life
      } else if (p.life > 0.0) {
        // Integrate
        p.pos += p.vel * cu.dt;
        p.vel *= max(0.0, 1.0 - cu.dt * 4.5);            // drag
        p.life = max(0.0, p.life - cu.dt * 2.2);          // dies in ~0.3–0.45 s
      }

      particles[i] = p;
    }
  `;

  // ── Render shader ─────────────────────────────────────────────────────────
  // Full-screen triangle.  Fragment shader draws background, guide line,
  // particle glows, and the two balls — all in pixel space.
  //
  // Render uniforms (48 bytes):
  //   offset  0: resolution vec2f
  //   offset  8: ball1Pos   vec2f  (Y = 0 at bottom)
  //   offset 16: ball2Pos   vec2f
  //   offset 24: radius     f32
  //   offset 28: progress   f32
  //   offset 32: onBeat     f32
  //   offset 36–44: padding (×3 f32)
  const renderShaderCode = /* wgsl */`
    struct Particle {
      pos  : vec2f,
      vel  : vec2f,
      life : f32,
      _pad : f32,
    }

    struct RUniforms {
      resolution : vec2f,
      ball1Pos   : vec2f,
      ball2Pos   : vec2f,
      radius     : f32,
      progress   : f32,
      onBeat     : f32,
      _p0        : f32,
      _p1        : f32,
      _p2        : f32,
    }

    @group(0) @binding(0) var<uniform>        u         : RUniforms;
    @group(0) @binding(1) var<storage, read>  particles : array<Particle>;

    @vertex
    fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
      var pos = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f( 3.0, -1.0),
        vec2f(-1.0,  3.0)
      );
      return vec4f(pos[vi], 0.0, 1.0);
    }

    fn drawBall(px: vec2f, centre: vec2f, radius: f32, onBeat: f32, col: vec3f) -> vec3f {
      var c = col;
      let d = distance(px, centre);
      let glowR = radius * 3.2;
      let glow  = max(0.0, 1.0 - d / glowR);
      c += vec3f(1.0, 0.6, 0.15) * (glow * glow * (0.18 + 0.40 * onBeat));
      let edge = smoothstep(radius + 1.5, radius - 1.5, d);
      if (edge > 0.0) {
        let bright  = 0.82 + 0.18 * onBeat;
        c = mix(c, vec3f(bright, bright * 0.87, bright * 0.65), edge);
      }
      return c;
    }

    @fragment
    fn fs(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
      let px  = fragCoord.xy;
      let res = u.resolution;

      var col = vec3f(0.14, 0.14, 0.17);

      // Centre guide line
      if (abs(px.x - res.x * 0.5) < 1.0) {
        col = vec3f(0.28, 0.28, 0.32);
      }

      // ── Particles ────────────────────────────────────────────────────────
      // WebGPU Y=0 is top; particles store Y with 0 at bottom, so flip.
      for (var i = 0u; i < ${N}u; i++) {
        let p = particles[i];
        if (p.life > 0.001) {
          let pc = vec2f(p.pos.x, res.y - p.pos.y);
          let d  = distance(px, pc);
          let r  = 3.5 * p.life + 1.0;        // shrinks as life drains

          // Soft halo
          let halo = max(0.0, 1.0 - d / (r * 4.0));
          col += vec3f(1.0, 0.75, 0.2) * (halo * halo * p.life * 0.7);

          // Particle dot
          col = mix(col, vec3f(1.0, 0.92, 0.6) * p.life,
                    smoothstep(r + 1.0, r - 1.0, d) * p.life);
        }
      }

      // ── Balls ─────────────────────────────────────────────────────────────
      let c1 = vec2f(u.ball1Pos.x, res.y - u.ball1Pos.y);
      let c2 = vec2f(u.ball2Pos.x, res.y - u.ball2Pos.y);
      col = drawBall(px, c1, u.radius, u.onBeat, col);
      col = drawBall(px, c2, u.radius, u.onBeat, col);

      return vec4f(col, 1.0);
    }
  `;

  // ── Pipelines ─────────────────────────────────────────────────────────────
  const computePipeline = device.createComputePipeline({
    layout : 'auto',
    compute: { module: device.createShaderModule({ code: computeShaderCode }), entryPoint: 'cs' },
  });

  const renderModule = device.createShaderModule({ code: renderShaderCode });
  const renderPipeline = device.createRenderPipeline({
    layout  : 'auto',
    vertex  : { module: renderModule, entryPoint: 'vs' },
    fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  // ── Uniform buffers ───────────────────────────────────────────────────────
  const computeUniformBuffer = device.createBuffer({
    size : 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const renderUniformBuffer = device.createBuffer({
    size : 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // ── Bind groups ───────────────────────────────────────────────────────────
  // Compute: binding 0 = compute uniforms, binding 1 = particles (read_write)
  const computeBindGroup = device.createBindGroup({
    layout : computePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: computeUniformBuffer } },
      { binding: 1, resource: { buffer: particleBuffer       } },
    ],
  });

  // Render:  binding 0 = render uniforms,  binding 1 = particles (read)
  const renderBindGroup = device.createBindGroup({
    layout : renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: renderUniformBuffer } },
      { binding: 1, resource: { buffer: particleBuffer      } },
    ],
  });

  // ── Beat progress (mirrors getAnimationProgress in script.js) ─────────────
  function getBeatProgress() {
    if (typeof lastBeatTime === 'undefined' || lastBeatTime <= 0) return 0;
    if (typeof Tone === 'undefined' || Tone.Transport.state !== 'started') return 0;

    const spb = (typeof secondsPerBeat !== 'undefined' && secondsPerBeat > 0)
      ? secondsPerBeat
      : 60 / ((Tone.Transport.bpm && Tone.Transport.bpm.value) || 96);

    const delay   = (typeof bluetoothDelay !== 'undefined' ? bluetoothDelay : 0) / 1000;
    const elapsed = Tone.now() - lastBeatTime - delay;

    if (elapsed < 0)         return Math.max(0, (elapsed + spb) / spb);
    if (elapsed > spb * 2)   return 0;
    return Math.min(elapsed / spb, 1);
  }

  // ── Render loop ───────────────────────────────────────────────────────────
  const W = canvas.width;
  const H = canvas.height;
  const RADIUS = 22;
  const BASE_DISPLACEMENT = 200;

  let lastFrameMs    = performance.now();
  let lastProgress   = 1.0; // start high so first beat wrap is detected correctly

  function frame() {
    const nowMs    = performance.now();
    const dt       = Math.min((nowMs - lastFrameMs) / 1000, 0.05); // cap at 50 ms
    lastFrameMs    = nowMs;

    const progress = getBeatProgress();

    // Detect beat landing: progress wraps from high (>0.5) to low (<0.05)
    const spawnBurst = (progress < 0.05 && lastProgress > 0.5) ? 1.0 : 0.0;
    lastProgress = progress;

    // Ball positions — same formula as getAnimalX() in script.js
    const displacement = Math.sin(progress * Math.PI) * BASE_DISPLACEMENT;
    const ball1X = W / 2 + displacement;
    const ball2X = W / 2 - displacement;
    const ballY  = H / 2;

    // onBeat flash: full at progress=0, fades to 0 by progress=0.08
    const onBeat = progress < 0.08 ? 1.0 - (progress / 0.08) : 0.0;

    // ── Write uniforms ───────────────────────────────────────────────────────
    device.queue.writeBuffer(
      computeUniformBuffer, 0,
      new Float32Array([dt, spawnBurst, W / 2, H / 2])
    );

    device.queue.writeBuffer(
      renderUniformBuffer, 0,
      new Float32Array([W, H, ball1X, ballY, ball2X, ballY, RADIUS, progress, onBeat, 0, 0, 0])
    );

    // ── Encode: compute pass → render pass ──────────────────────────────────
    const encoder = device.createCommandEncoder();

    // 1. Compute: update all particles
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, computeBindGroup);
    computePass.dispatchWorkgroups(1); // 1 workgroup × workgroup_size(64) = 64 threads
    computePass.end();

    // 2. Render: draw particles + balls
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view       : gpuContext.getCurrentTexture().createView(),
        clearValue : { r: 0.14, g: 0.14, b: 0.17, a: 1 },
        loadOp     : 'clear',
        storeOp    : 'store',
      }],
    });
    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.draw(3);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
