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
    /* 屏幕坐标映射到视频纹理（cover 裁切）后取样 */
    'vec3 sampleAt(vec2 s){',
    '  vec2 uv = 0.5 + (s - 0.5) * uvScale;',
    '  uv = clamp(uv, vec2(0.0015), vec2(0.9985));',
    '  return texture2D(tex, uv).rgb;',
    '}',
    'void main(){',
    '  vec2 suv = gl_FragCoord.xy / resolution;',
    /* 棱纹宽度固定：屏幕越窄条数越少，单位宽度保持一致，手机端不会变密 */
    '  float rw = ribWidth / resolution.x;',
    '  float rh = ribWidth / resolution.y;',
    '  float rib = fract(gl_FragCoord.x / ribWidth) - 0.5;',
    '  vec2 r = suv + vec2(rib * rw * 1.28, (rib * rib - 0.0833) * rh * 1.36);',
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
  var frame = 0, paused = false, visible = true, destroyed = false;
  var lastVideoTime = -1, hasFrame = false;

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
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
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

  function render() {
    if (!gl || destroyed) return false;
    if (!canvas.width || !canvas.height) return false;
    if (!upload()) return false;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    /* 27 CSS px 一条；乘上画布实际的像素比，保证不同 DPR 下粗细一致 */
    gl.uniform1f(uRib, RIB_CSS * (canvas.width / Math.max(1, window.innerWidth)));
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

  /* 视频就绪 / 自动播放被拦截后的补播都会回到这里重绘 */
  function boot() {
    resize();
    sync();
    if (gl && !frame) frame = requestAnimationFrame(tick);
  }

  if (video) {
    video.addEventListener('loadeddata', boot);
    video.addEventListener('playing', boot);
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
