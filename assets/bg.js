/* 棱纹光栅 × 极光背景
 * 图案：极光视频（来源 im.qq.com 首页背景视频）
 * 光栅：竖向毛玻璃棱纹折射，沿用 LeiBox「Blue Fluted Glass」的折射参数
 * 纯原生 WebGL 实现，无依赖。
 */
(function () {
  'use strict';

  var canvas = document.getElementById('bg');
  var video = document.getElementById('aurora');
  var body = document.body;
  var media = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* 一条竖向棱纹的宽度（CSS 像素）。1920 宽时约 71 条，与最初的效果一致 */
  var RIB_CSS = 27;

  var VERTEX = 'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}';

  var FRAGMENT = [
    'precision highp float;',
    'uniform vec2 resolution;',
    'uniform vec2 uvScale;',
    'uniform sampler2D tex;',
    /* 一条棱纹的宽度（设备像素）：固定值，不随屏幕宽度变化 */
    'uniform float ribWidth;',
    /* 指针位置（0..1，y 轴向上）与扰动强度（0..1） */
    'uniform vec2 uMouse;',
    'uniform float uPointer;',
    'uniform float uTime;',
    /* 屏幕坐标映射到视频纹理（cover 裁切）后取样 */
    'vec3 sampleAt(vec2 s){',
    '  vec2 uv = 0.5 + (s - 0.5) * uvScale;',
    '  uv = clamp(uv, vec2(0.0015), vec2(0.9985));',
    '  return texture2D(tex, uv).rgb;',
    '}',
    'void main(){',
    '  vec2 suv = gl_FragCoord.xy / resolution;',
    /* —— 指针扰动：以指针为圆心的同心涟漪，先把棱纹相位推开，再带动取样点 —— */
    '  float par = resolution.x / resolution.y;',
    '  vec2 dp = (suv - uMouse) * vec2(par, 1.0);',
    '  float pd = max(length(dp), 1e-5);',
    /* 影响半径约屏高 1/4，平方衰减，边界不留圈 */
    '  float infl = uPointer * exp(-pd * pd * 42.0);',
    '  float wave = 0.0;',
    '  vec2 shift = vec2(0.0);',
    '  if (infl > 0.002) {',
    /* 两组波叠加：低频是鼓包，高频是细纹，整体随时间向外走 */
    '    float w = sin(pd * 52.0 - uTime * 6.0) * 0.62 + sin(pd * 23.0 - uTime * 2.8) * 0.38;',
    '    wave = w * infl;',
    '    vec2 dirn = dp / pd;',
    '    vec2 perp = vec2(-dirn.y, dirn.x);',
    /* 径向推开 + 一点切向扭转，像指尖按在玻璃上 */
    '    shift = (dirn * wave * 0.016 + perp * wave * 0.007) / vec2(par, 1.0);',
    '  }',
    /* 棱纹宽度固定：屏幕越窄条数越少，单位宽度保持一致，手机端不会变密 */
    '  float rw = ribWidth / resolution.x;',
    '  float rh = ribWidth / resolution.y;',
    /* wave 直接加在相位上，棱纹才会真的被压弯（只挪取样点看不出形变） */
    '  float rib = fract(gl_FragCoord.x / ribWidth + wave * 1.4) - 0.5;',
    '  vec2 r = suv + vec2(rib * rw * 1.28, (rib * rib - 0.0833) * rh * 1.36) + shift;',
    '  vec3 c = sampleAt(r) * 0.40;',
    '  c += sampleAt(r + vec2(0.0, rh * 0.80)) * 0.20;',
    '  c += sampleAt(r - vec2(0.0, rh * 0.80)) * 0.20;',
    '  c += sampleAt(r + vec2(rw * 0.285, 0.0)) * 0.10;',
    '  c += sampleAt(r - vec2(rw * 0.285, 0.0)) * 0.10;',
    /* 下半屏：越往下取样越糊，权重随高度渐变到 0 */
    '  float m = 1.0 - smoothstep(0.02, 0.60, suv.y);',
    '  if (m > 0.002) {',
    /* 12 点黄金角圆盘采样：少样本也能把颜色糊匀，不会出现采样网格 */
    '    float rad = 0.062 * m;',
    '    vec3 soft = vec3(0.0);',
    '    for (int i = 0; i < 12; i++) {',
    '      float fi = float(i);',
    '      float ang = fi * 2.39996323;',
    '      float rr = sqrt((fi + 0.5) / 12.0) * rad;',
    '      soft += sampleAt(r + vec2(cos(ang), sin(ang)) * rr);',
    '    }',
    '    c = mix(c, soft / 12.0, clamp(m * 1.25, 0.0, 1.0));',
    '  }',
    /* 玻璃略提饱和与亮度 */
    '  float g = dot(c, vec3(0.299, 0.587, 0.114));',
    '  c = mix(vec3(g), c, 1.14);',
    /* 棱纹透镜的暗边与高光 */
    '  c *= 1.0 - 0.07 * pow(abs(rib) * 2.0, 3.0);',
    '  c += vec3(0.85, 0.92, 1.0) * pow(abs(rib) * 2.0, 10.0) * 0.06;',
    /* 涟漪波峰微亮、涡心略暗，给扰动一点体积感 */
    '  c += vec3(0.72, 0.86, 1.0) * max(wave, 0.0) * 0.05;',
    '  c *= 1.0 - 0.05 * uPointer * exp(-pd * pd * 22.0);',
    '  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  var gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    preserveDrawingBuffer: false
  });

  var program = null, buffer = null, texture = null;
  var uRes = null, uScale = null, uRib = null;
  var uMouse = null, uPointer = null, uTime = null;
  var frame = 0, paused = false, visible = true, destroyed = false;
  var lastVideoTime = -1, hasFrame = false;

  /* 指针扰动状态：目标点 → 缓动点，强度随移动加速、随时间衰减 */
  var mouseTo = { x: 0.5, y: 0.5 };
  var mouseAt = { x: 0.5, y: 0.5 };
  var pointerPower = 0;
  var pointerLast = 0;

  function compile(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function initialize() {
    if (!gl) return false;
    var vertex = compile(gl.VERTEX_SHADER, VERTEX);
    var fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return false;
    }
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;

    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    var position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    uRes = gl.getUniformLocation(program, 'resolution');
    uScale = gl.getUniformLocation(program, 'uvScale');
    uRib = gl.getUniformLocation(program, 'ribWidth');
    uMouse = gl.getUniformLocation(program, 'uMouse');
    uPointer = gl.getUniformLocation(program, 'uPointer');
    uTime = gl.getUniformLocation(program, 'uTime');
    gl.uniform1i(gl.getUniformLocation(program, 'tex'), 0);

    texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    return true;
  }

  /* WebGL 不可用：直接铺视频，用 CSS 棱纹叠一层 */
  function fallback() {
    if (gl) {
      if (program) gl.deleteProgram(program);
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
    gl = null;
    program = buffer = texture = null;
    body.classList.add('no-webgl');
  }

  function upload() {
    if (!video || video.readyState < 2 || !video.videoWidth) return false;
    if (hasFrame && video.currentTime === lastVideoTime) return true;
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    } catch (e) {
      /* file:// 或未带 CORS 的跨域视频会上传失败，直接掉到 CSS 光栅，别留一张白屏 */
      fallback();
      return false;
    }
    lastVideoTime = video.currentTime;
    hasFrame = true;
    return true;
  }

  function updateScale() {
    var sa = canvas.width / canvas.height;
    var va = (video.videoWidth || 16) / (video.videoHeight || 9);
    var sx = 1, sy = 1;
    if (sa > va) sy = va / sa;
    else sx = sa / va;
    gl.uniform2f(uScale, sx, sy);
  }

  /* 每帧推进指针：位置缓动跟随，扰动强度按指数衰减 */
  function advancePointer() {
    var now = performance.now();
    var dt = pointerLast ? (now - pointerLast) / 1000 : 0.016;
    pointerLast = now;
    if (dt > 0.1) dt = 0.1;
    var k = 1 - Math.exp(-dt * 16);
    mouseAt.x += (mouseTo.x - mouseAt.x) * k;
    mouseAt.y += (mouseTo.y - mouseAt.y) * k;
    if (pointerPower > 0.0005) {
      pointerPower *= Math.exp(-dt * 2.0);
      if (pointerPower < 0.0005) pointerPower = 0;
    }
  }

  function render() {
    if (!gl || destroyed) return false;
    if (!canvas.width || !canvas.height) return false;
    if (!upload()) return false;
    advancePointer();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    /* 27 CSS px 一条；乘上画布实际的像素比，保证不同 DPR 下粗细一致 */
    gl.uniform1f(uRib, RIB_CSS * (canvas.width / Math.max(1, window.innerWidth)));
    gl.uniform2f(uMouse, mouseAt.x, mouseAt.y);
    gl.uniform1f(uPointer, pointerPower);
    gl.uniform1f(uTime, (performance.now() % 1e7) * 0.001);
    updateScale();
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (!body.classList.contains('is-ready')) body.classList.add('is-ready');
    return true;
  }

  function running() {
    return !!gl && !destroyed && !paused && !media.matches && visible && !document.hidden;
  }

  function tick() {
    frame = 0;
    if (!gl || destroyed) return;
    /* 视频首帧还没解码好：继续等，保证静帧/暂停场景也能出画 */
    if (!hasFrame) {
      if (render()) {
        body.dataset.paused = String(paused || media.matches);
        if (running()) frame = requestAnimationFrame(tick);
      } else {
        frame = requestAnimationFrame(tick);
      }
      return;
    }
    if (!running()) {
      body.dataset.paused = String(paused || media.matches);
      return;
    }
    render();
    frame = requestAnimationFrame(tick);
  }

  function syncPlayback() {
    if (!video) return;
    var shouldPlay = !paused && !media.matches && visible && !document.hidden;
    if (shouldPlay) {
      if (video.paused) {
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      }
    } else if (!video.paused) {
      video.pause();
    }
  }

  function sync() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (!gl) return;
    body.dataset.paused = String(paused || media.matches);
    syncPlayback();
    render();
    if (running() || !hasFrame) frame = requestAnimationFrame(tick);
  }

  function resize() {
    if (!gl) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var w = Math.max(1, Math.round(window.innerWidth * dpr));
    var h = Math.max(1, Math.round(window.innerHeight * dpr));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    render();
  }

  if (!initialize()) {
    fallback();
  } else {
    body.dataset.renderer = 'webgl';
  }

  var resizeTimer = 0;
  function scheduleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  }

  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);

  /* —— 指针扰动 —— */
  var lastMoveAt = 0;

  /* 把客户端坐标换成 0..1 的着色器坐标（y 轴向上），并按移动速度给出扰动强度 */
  function pushPointer(clientX, clientY, dt) {
    var w = Math.max(1, window.innerWidth);
    var h = Math.max(1, window.innerHeight);
    var nx = Math.min(1, Math.max(0, clientX / w));
    var ny = Math.min(1, Math.max(0, 1 - clientY / h));
    var dx = (nx - mouseTo.x) * (w / h);
    var dy = ny - mouseTo.y;
    var speed = Math.sqrt(dx * dx + dy * dy) / Math.max(0.008, dt / 1000);
    mouseTo.x = nx;
    mouseTo.y = ny;
    var target = Math.min(1, 0.30 + speed * 0.55);
    pointerPower += (target - pointerPower) * 0.5;
    if (pointerPower > 1) pointerPower = 1;
  }

  function onPointerMove(e) {
    if (!gl || destroyed || media.matches) return;
    var now = performance.now();
    var dt = lastMoveAt ? now - lastMoveAt : 16;
    lastMoveAt = now;
    pushPointer(e.clientX, e.clientY, Math.min(60, Math.max(8, dt)));
  }

  function onPointerDown(e) {
    if (!gl || destroyed || media.matches) return;
    pushPointer(e.clientX, e.clientY, 16);
    pointerPower = Math.min(1, pointerPower + 0.55);
  }

  if (window.PointerEvent) {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
  } else {
    window.addEventListener('mousemove', onPointerMove, { passive: true });
    window.addEventListener('touchmove', function (e) {
      var t = e.touches && e.touches[0];
      if (t) onPointerMove(t);
    }, { passive: true });
    window.addEventListener('touchstart', function (e) {
      var t = e.touches && e.touches[0];
      if (t) onPointerDown(t);
    }, { passive: true });
  }

  /* 视频就绪 / 自动播放被拦截后的补播都会回到这里重绘 */
  function boot() {
    resize();
    sync();
    if (gl && !frame) frame = requestAnimationFrame(tick);
  }

  if (video) {
    /* file:// 下 crossorigin 会让整段视频加载失败（错误码 4）。
       去掉它至少能出画，纹理仍会被拒，随后走降级：视频 + CSS 光栅 */
    if (location.protocol === 'file:' && video.hasAttribute('crossorigin')) {
      video.removeAttribute('crossorigin');
      video.load();
    }
    video.addEventListener('loadeddata', boot);
    video.addEventListener('playing', boot);
    /* 视频彻底不可用（路径错、编码不支持）：别留一张空画布 */
    video.addEventListener('error', function () {
      if (!destroyed) fallback();
    });
    /* 自动播放被拦截：首次点击页面时补播一次 */
    document.addEventListener('click', function () {
      if (!gl || paused) return;
      if (video.paused) {
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      }
    }, { once: true });
  }

  boot();

  document.addEventListener('visibilitychange', sync);

  if (media.addEventListener) media.addEventListener('change', sync);
  else if (media.addListener) media.addListener(sync);

  var intersection = new IntersectionObserver(function (entries) {
    visible = entries[0].isIntersecting;
    sync();
  });
  intersection.observe(canvas);

  window.addEventListener('pagehide', function () {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(frame);
    intersection.disconnect();
    if (gl) {
      gl.deleteBuffer(buffer);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  }, { once: true });
})();
