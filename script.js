/**
 * OCEAN DEPTHS - Redesigned Standalone 3D Experience Script
 * 
 * Bám sát phong cách video tham chiếu:
 * 1. Không gian mở đầu siêu thực: ánh hoàng hôn đào/hồng/tím + mặt phẳng nước phản chiếu + bong bóng tán sắc 3D.
 * 2. Diễn tiến màu sắc: Đào/tím -> Xanh tím huyền bí -> Xanh ngọc biển sâu.
 * 3. Chuyển động cá mập theo đường cong 3D S-curve điện ảnh: bẻ cua, nghiêng thân, lướt gần camera rồi lùi xa.
 * 4. Toàn bộ cơ thể cá mập nằm trọn vẹn trong khung nhìn (40-55% chiều rộng), không bị cắt xén.
 * 5. Tách biệt sharkPivot (GSAP) khỏi sharkModel (AnimationMixer xương bơi).
 * 6. Tương thích cả khi chạy qua local server và khi mở trực tiếp file index.html.
 */

(function () {
  'use strict';

  // Helper chuyển đổi Base64 Data URI sang ArrayBuffer (chạy offline không bị lỗi CORS)
  function base64ToArrayBuffer(base64) {
    var commaIdx = base64.indexOf(',');
    var cleanB64 = commaIdx >= 0 ? base64.slice(commaIdx + 1) : base64;
    var binaryString = window.atob(cleanB64);
    var len = binaryString.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // =========================================================================
  // MARTIN RENOU THREEJS-CAUSTICS SHADER PIPELINE (BSD-3-Clause)
  // Tích hợp: Mô phỏng sóng nước (WaterSimulation), EnvironmentMap & Caustics
  // =========================================================================

  class WaterSimulation {
    constructor(renderer, size) {
      this.size = size || 256;
      this._camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 2000);
      this._geometry = new THREE.PlaneBufferGeometry(2, 2);

      var type = (renderer.capabilities && renderer.capabilities.isWebGL2)
        ? THREE.HalfFloatType
        : (THREE.FloatType || THREE.HalfFloatType);

      var options = {
        type: type,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        stencilBuffer: false,
        depthBuffer: false
      };

      this._targetA = new THREE.WebGLRenderTarget(this.size, this.size, options);
      this._targetB = new THREE.WebGLRenderTarget(this.size, this.size, options);
      this.target = this._targetA;

      var simVertexShader = [
        'precision highp float;',
        'attribute vec3 position;',
        'varying vec2 coord;',
        'void main() {',
        '  coord = position.xy * 0.5 + 0.5;',
        '  gl_Position = vec4(position.xy, 0.0, 1.0);',
        '}'
      ].join('\n');

      var dropFragmentShader = [
        'precision highp float;',
        'const float PI = 3.141592653589793;',
        'uniform sampler2D texture;',
        'uniform vec2 center;',
        'uniform float radius;',
        'uniform float strength;',
        'varying vec2 coord;',
        'void main() {',
        '  vec4 info = texture2D(texture, coord);',
        '  vec2 toCenter = coord - (center * 0.5 + 0.5);',
        '  float drop = max(0.0, 1.0 - length(toCenter) / radius);',
        '  drop = 0.5 - cos(drop * PI) * 0.5;',
        '  info.r += drop * strength;',
        '  gl_FragColor = info;',
        '}'
      ].join('\n');

      var updateFragmentShader = [
        'precision highp float;',
        'uniform sampler2D texture;',
        'uniform vec2 delta;',
        'varying vec2 coord;',
        'void main() {',
        '  vec4 info = texture2D(texture, coord);',
        '  vec2 dx = vec2(delta.x, 0.0);',
        '  vec2 dy = vec2(0.0, delta.y);',
        '  float average = (',
        '    texture2D(texture, coord - dx).r +',
        '    texture2D(texture, coord - dy).r +',
        '    texture2D(texture, coord + dx).r +',
        '    texture2D(texture, coord + dy).r',
        '  ) * 0.25;',
        '  info.g += (average - info.r) * 2.0;',
        '  info.g *= 0.992;',
        '  info.r += info.g;',
        '  vec3 ddx = vec3(delta.x, texture2D(texture, vec2(coord.x + delta.x, coord.y)).r - info.r, 0.0);',
        '  vec3 ddy = vec3(0.0, texture2D(texture, vec2(coord.x, coord.y + delta.y)).r - info.r, delta.y);',
        '  info.ba = normalize(cross(ddy, ddx)).xz;',
        '  gl_FragColor = info;',
        '}'
      ].join('\n');

      var dropMaterial = new THREE.RawShaderMaterial({
        uniforms: {
          center: { value: [0, 0] },
          radius: { value: 0 },
          strength: { value: 0 },
          texture: { value: null }
        },
        vertexShader: simVertexShader,
        fragmentShader: dropFragmentShader
      });

      var updateMaterial = new THREE.RawShaderMaterial({
        uniforms: {
          delta: { value: [1 / this.size, 1 / this.size] },
          texture: { value: null }
        },
        vertexShader: simVertexShader,
        fragmentShader: updateFragmentShader
      });

      this._dropMesh = new THREE.Mesh(this._geometry, dropMaterial);
      this._updateMesh = new THREE.Mesh(this._geometry, updateMaterial);
    }

    addDrop(renderer, x, y, radius, strength) {
      this._dropMesh.material.uniforms['center'].value = [x, y];
      this._dropMesh.material.uniforms['radius'].value = radius;
      this._dropMesh.material.uniforms['strength'].value = strength;
      this._render(renderer, this._dropMesh);
    }

    stepSimulation(renderer) {
      this._render(renderer, this._updateMesh);
    }

    _render(renderer, mesh) {
      var _oldTarget = this.target;
      var _newTarget = this.target === this._targetA ? this._targetB : this._targetA;
      var currentRt = renderer.getRenderTarget();

      renderer.setRenderTarget(_newTarget);
      mesh.material.uniforms['texture'].value = _oldTarget.texture;
      renderer.render(mesh, this._camera);
      renderer.setRenderTarget(currentRt);

      this.target = _newTarget;
    }
  }

  class EnvironmentMap {
    constructor(renderer, size) {
      this.size = size || 512;
      var type = (renderer.capabilities && renderer.capabilities.isWebGL2)
        ? THREE.HalfFloatType
        : (THREE.FloatType || THREE.HalfFloatType);

      this.target = new THREE.WebGLRenderTarget(this.size, this.size, {
        type: type,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat
      });

      var vertexShader = [
        'varying vec4 vWorldPosition;',
        'varying float vDepth;',
        'void main() {',
        '  vWorldPosition = modelMatrix * vec4(position, 1.0);',
        '  vec4 projectedPosition = projectionMatrix * viewMatrix * vWorldPosition;',
        '  vDepth = projectedPosition.z;',
        '  gl_Position = projectedPosition;',
        '}'
      ].join('\n');

      var fragmentShader = [
        'varying vec4 vWorldPosition;',
        'varying float vDepth;',
        'void main() {',
        '  gl_FragColor = vec4(vWorldPosition.xyz, vDepth);',
        '}'
      ].join('\n');

      this._material = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader
      });
      this._meshes = [];
    }

    setMeshes(meshes) {
      this._meshes = meshes || [];
    }

    render(renderer, lightCamera) {
      var oldTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();

      for (var i = 0; i < this._meshes.length; i++) {
        var m = this._meshes[i];
        if (!m || !m.visible) continue;
        var origMat = m.material;
        m.material = this._material;
        renderer.render(m, lightCamera);
        m.material = origMat;
      }

      renderer.setRenderTarget(oldTarget);
    }
  }

  class Caustics {
    constructor(renderer, size, waterY) {
      this.size = size || 512;
      this.waterY = waterY !== undefined ? waterY : 2.45;

      var type = (renderer.capabilities && renderer.capabilities.isWebGL2)
        ? THREE.HalfFloatType
        : (THREE.FloatType || THREE.HalfFloatType);

      this.target = new THREE.WebGLRenderTarget(this.size, this.size, {
        type: type,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat
      });

      this._waterGeometry = new THREE.PlaneBufferGeometry(24, 24, 160, 160);
      this._waterGeometry.rotateX(-Math.PI / 2);

      var waterVertexShader = [
        'uniform vec3 light;',
        'uniform sampler2D water;',
        'uniform sampler2D env;',
        'uniform float deltaEnvTexture;',
        'varying vec3 oldPosition;',
        'varying vec3 newPosition;',
        'varying float waterDepth;',
        'varying float depth;',
        'const float eta = 0.7504;',
        'const int MAX_ITERATIONS = 40;',
        'void main() {',
        '  vec2 uvCoord = uv;',
        '  vec4 waterInfo = texture2D(water, uvCoord);',
        '  vec3 waterPos = vec3(position.x, ' + this.waterY.toFixed(2) + ' + waterInfo.r * 0.35, position.z);',
        '  vec3 waterNorm = normalize(vec3(waterInfo.b, 1.0, waterInfo.a));',
        '  oldPosition = waterPos;',
        '  vec4 projectedWater = projectionMatrix * viewMatrix * vec4(waterPos, 1.0);',
        '  vec2 currentPos = projectedWater.xy;',
        '  vec2 coords = 0.5 + 0.5 * currentPos;',
        '  vec3 refracted = refract(normalize(light), waterNorm, eta);',
        '  vec4 projRefract = projectionMatrix * viewMatrix * vec4(refracted, 0.0);',
        '  vec3 refractedDir = projRefract.xyz;',
        '  waterDepth = 0.5 + 0.5 * (projectedWater.z / projectedWater.w);',
        '  float currentDepth = projectedWater.z;',
        '  vec4 environment = texture2D(env, coords);',
        '  float factor = deltaEnvTexture / max(length(refractedDir.xy), 0.0001);',
        '  vec2 deltaDir = refractedDir.xy * factor;',
        '  float deltaDepth = refractedDir.z * factor;',
        '  for (int i = 0; i < MAX_ITERATIONS; i++) {',
        '    currentPos += deltaDir;',
        '    currentDepth += deltaDepth;',
        '    if (environment.w <= currentDepth) break;',
        '    environment = texture2D(env, 0.5 + 0.5 * currentPos);',
        '  }',
        '  newPosition = environment.xyz;',
        '  vec4 projEnv = projectionMatrix * viewMatrix * vec4(newPosition, 1.0);',
        '  depth = 0.5 + 0.5 * (projEnv.z / projEnv.w);',
        '  gl_Position = projEnv;',
        '}'
      ].join('\n');

      var waterFragmentShader = [
        'uniform float causticsFactor;',
        'varying vec3 oldPosition;',
        'varying vec3 newPosition;',
        'varying float waterDepth;',
        'varying float depth;',
        'void main() {',
        '  float causticsIntensity = 0.0;',
        '  if (depth >= waterDepth) {',
        '    float oldArea = length(dFdx(oldPosition)) * length(dFdy(oldPosition));',
        '    float newArea = length(dFdx(newPosition)) * length(dFdy(newPosition));',
        '    float ratio = (newArea <= 0.000001) ? 3.5 : clamp(oldArea / newArea, 0.0, 4.0);',
        '    causticsIntensity = causticsFactor * ratio;',
        '  }',
        '  gl_FragColor = vec4(causticsIntensity, 0.0, 0.0, depth);',
        '}'
      ].join('\n');

      this._waterMaterial = new THREE.ShaderMaterial({
        uniforms: {
          light: { value: new THREE.Vector3(0.08, -0.99, -0.05).normalize() },
          env: { value: null },
          water: { value: null },
          deltaEnvTexture: { value: 1.0 / this.size },
          causticsFactor: { value: 0.18 }
        },
        vertexShader: waterVertexShader,
        fragmentShader: waterFragmentShader,
        transparent: true,
        side: THREE.DoubleSide
      });

      this._waterMaterial.blending = THREE.CustomBlending;
      this._waterMaterial.blendEquation = THREE.AddEquation;
      this._waterMaterial.blendSrc = THREE.OneFactor;
      this._waterMaterial.blendDst = THREE.OneFactor;
      this._waterMaterial.blendEquationAlpha = THREE.AddEquation;
      this._waterMaterial.blendSrcAlpha = THREE.OneFactor;
      this._waterMaterial.blendDstAlpha = THREE.ZeroFactor;
      this._waterMaterial.extensions = { derivatives: true };

      this._waterMesh = new THREE.Mesh(this._waterGeometry, this._waterMaterial);
    }

    setTextures(waterTex, envTex) {
      this._waterMaterial.uniforms['water'].value = waterTex;
      this._waterMaterial.uniforms['env'].value = envTex;
    }

    render(renderer, lightCamera) {
      var oldTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(this._waterMesh, lightCamera);
      renderer.setRenderTarget(oldTarget);
    }
  }

  class OceanDepthsApp {
    constructor() {
      this.canvas = document.getElementById('webgl-canvas');
      this.backdrop = document.getElementById('ambient-backdrop');
      this.loadingScreen = document.getElementById('loading-screen');
      this.loadingProgressBar = document.getElementById('loading-progress-bar');
      this.loadingPercent = document.getElementById('loading-percent');
      this.loadingStatus = document.getElementById('loading-status');
      this.fallbackBanner = document.getElementById('fallback-banner');
      this.fallbackMessage = document.getElementById('fallback-message');

      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this.lastTime = performance.now();
      this.startTime = performance.now();

      // Hệ thống chiếu sáng
      this.sunLight = null;
      this.ambientLight = null;
      this.fillLight = null;
      this.rimLight = null;

      // 3D Objects & Cá mập
      this.sharkPivot = null;       // Controller nhóm cha: vị trí toàn cảnh cho ScrollTrigger
      this.sharkSwimGroup = null;   // Controller nhóm con: chuyển động tự bơi qua lại & rẽ quay đầu
      this.sharkModel = null;       // Mô hình 3D chứa xương cho AnimationMixer
      this.patrolDistance = 0;      // Quãng đường tự bơi tích lũy (delta time)
      this.mixer = null;

      // Hệ thống Caustics & Đáy biển (ThreeJS Caustics)
      this.waterSim = null;
      this.envMap = null;
      this.caustics = null;
      this.lightCamera = null;
      this.seabedMesh = null;
      this.seabedMaterial = null;
      this.waterSurfaceMesh = null;
      this.rockMeshes = [];
      this.simTick = 0;

      this.bubbles = [];            // Giảm bong bóng lớn, giữ không gian thoáng
      this.particles = null;        // Hạt bụi nước biển siêu mịn

      this.timeline = null;
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      window.__oceanApp = this;

      this.init();
    }

    checkWebGLSupport() {
      try {
        var testCanvas = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && 
          (testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl')));
      } catch (e) {
        return false;
      }
    }

    init() {
      if (!this.checkWebGLSupport()) {
        this.showFallback('Trình duyệt chưa bật WebGL. Nội dung vẫn hiển thị đầy đủ bên dưới.');
        this.hideLoading();
        return;
      }

      try {
        this.setupScene();
        this.setupCamera();
        this.setupRenderer();
        this.setupLighting();
        this.setupCausticsPipeline();
        this.setupSeabedAndRocks();
        this.setupWaterSurface();
        this.setupMarineParticles();
        this.initCreditsModal();
        this.initNavigation();
        this.loadSharkModel();
        this.bindEvents();
        this.animate();
      } catch (err) {
        console.error('Lỗi khởi tạo cảnh 3D:', err);
        this.showFallback('Lỗi khởi tạo: ' + err.message);
        this.hideLoading();
      }
    }

    setupScene() {
      this.scene = new THREE.Scene();
      // Sương mù nước biển xanh ngọc - sâu thẳm có chiều sâu điện ảnh
      this.scene.fog = new THREE.FogExp2(0x031826, 0.045);
    }

    setupCamera() {
      var isMobile = window.innerWidth < 768;
      var fov = isMobile ? 48 : 38;
      this.camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 100);
      // Đặt camera ở độ cao vừa tầm nhìn giữa mặt nước phía trên và đáy cát phía dưới
      this.camera.position.set(0, 0.4, 8.2);
    }

    setupRenderer() {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if (this.renderer.outputEncoding !== undefined) {
        this.renderer.outputEncoding = THREE.sRGBEncoding;
      }
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
    }

    setupLighting() {
      // 1. Ánh sáng môi trường đại dương xanh ngọc sâu lắng
      this.ambientLight = new THREE.AmbientLight(0x0e3f52, 2.2);
      this.scene.add(this.ambientLight);

      // 2. Nắng biển rọi từ trên mặt nước xuống (Light Vector cho Caustics & khối cá mập)
      this.sunLight = new THREE.DirectionalLight(0xe0f7fa, 3.2);
      this.sunLight.position.set(2, 8, 2);
      this.scene.add(this.sunLight);

      // 3. Ánh sáng hắt dịu phía trước làm rõ mặt và vây cá mập
      this.fillLight = new THREE.DirectionalLight(0x38bdf8, 1.8);
      this.fillLight.position.set(-3, 1, 5);
      this.scene.add(this.fillLight);

      // 4. Ánh sáng viền (Rim light) tôn dáng cá mập trong làn nước
      this.rimLight = new THREE.PointLight(0x2dd4bf, 3.5, 22);
      this.rimLight.position.set(3, 3, -3);
      this.scene.add(this.rimLight);
    }

    /**
     * Khởi tạo Pipeline Caustics & Simulation (Martin Renou ThreeJS Caustics)
     */
    setupCausticsPipeline() {
      var isMobile = window.innerWidth < 768;
      var simSize = isMobile ? 128 : 256;
      var causticsSize = isMobile ? 256 : 512;

      // Light Camera: Camera trực giao từ trên cao nhìn xuống đáy cát
      var lightCamSpan = 12.0;
      this.lightCamera = new THREE.OrthographicCamera(
        -lightCamSpan, lightCamSpan, lightCamSpan, -lightCamSpan, 0.1, 20.0
      );
      this.lightCamera.position.set(0, 5.5, 0);
      this.lightCamera.up.set(0, 0, -1);
      this.lightCamera.lookAt(0, -2.4, 0);

      try {
        this.waterSim = new WaterSimulation(this.renderer, simSize);
        this.envMap = new EnvironmentMap(this.renderer, causticsSize);
        this.caustics = new Caustics(this.renderer, causticsSize, 2.45);

        // Tạo trước 4 giọt sóng nhẹ lan tỏa
        for (var i = 0; i < 4; i++) {
          this.waterSim.addDrop(
            this.renderer,
            (Math.random() - 0.5) * 1.2,
            (Math.random() - 0.5) * 1.2,
            0.04,
            (i & 1) ? 0.025 : -0.025
          );
        }
      } catch (e) {
        console.warn('Khởi tạo caustics pipeline có cảnh báo (dùng fallback an toàn):', e);
      }
    }

    /**
     * Tạo đáy biển cát nhấp nhô nhẹ & cụm đá hai bên (chừa vùng trung tâm thoáng đãng)
     */
    setupSeabedAndRocks() {
      // 1. NỀN CÁT ĐÁY BIỂN (Seabed Plane)
      var seabedGeo = new THREE.PlaneBufferGeometry(55, 42, 96, 80);
      seabedGeo.rotateX(-Math.PI / 2);

      var posAttr = seabedGeo.attributes.position;
      var posArray = posAttr.array;
      for (var i = 0; i < posArray.length; i += 3) {
        var x = posArray[i];
        var z = posArray[i + 2];
        var sideFactor = Math.min(Math.max(Math.abs(x) * 0.35, 0.15), 1.1);
        var dune = (Math.sin(x * 0.26) * 0.18 + Math.cos(z * 0.22) * 0.14) * sideFactor;
        var micro = Math.sin(x * 0.55 + z * 0.42) * 0.04;
        posArray[i + 1] = -2.35 + dune + micro;
      }
      seabedGeo.computeVertexNormals();

      // Shader vật liệu đáy biển nhận chiếu xạ caustics
      this.seabedMaterial = new THREE.ShaderMaterial({
        uniforms: {
          light: { value: new THREE.Vector3(0.08, -0.99, -0.05).normalize() },
          caustics: { value: null },
          lightProjectionMatrix: { value: this.lightCamera.projectionMatrix },
          lightViewMatrix: { value: this.lightCamera.matrixWorldInverse },
          baseColor: { value: new THREE.Color(0xd2bc8a) }, // Cát sáng dịu
          oceanDeepColor: { value: new THREE.Color(0x021624) }, // Xanh vực thẳm xa
          causticsStrength: { value: 0.38 } // Vệt sáng caustics mềm, không chói lóa
        },
        vertexShader: [
          'uniform mat4 lightProjectionMatrix;',
          'uniform mat4 lightViewMatrix;',
          'varying vec3 vWorldPosition;',
          'varying vec3 vNormal;',
          'varying vec2 vUv;',
          'varying vec4 vLightPosition;',
          'void main() {',
          '  vUv = uv;',
          '  vNormal = normalize(normalMatrix * normal);',
          '  vec4 worldPos = modelMatrix * vec4(position, 1.0);',
          '  vWorldPosition = worldPos.xyz;',
          '  vec4 lightRelPos = lightProjectionMatrix * lightViewMatrix * worldPos;',
          '  vLightPosition = 0.5 + (lightRelPos / lightRelPos.w) * 0.5;',
          '  gl_Position = projectionMatrix * viewMatrix * worldPos;',
          '}'
        ].join('\n'),
        fragmentShader: [
          'uniform sampler2D caustics;',
          'uniform vec3 light;',
          'uniform vec3 baseColor;',
          'uniform vec3 oceanDeepColor;',
          'uniform float causticsStrength;',
          'varying vec3 vWorldPosition;',
          'varying vec3 vNormal;',
          'varying vec2 vUv;',
          'varying vec4 vLightPosition;',
          'float sampleCaustics(sampler2D tex, vec2 uv) {',
          '  vec2 d = vec2(1.0 / 512.0);',
          '  float s = texture2D(tex, uv).r * 0.36;',
          '  s += texture2D(tex, uv + vec2(d.x, 0.0)).r * 0.16;',
          '  s += texture2D(tex, uv - vec2(d.x, 0.0)).r * 0.16;',
          '  s += texture2D(tex, uv + vec2(0.0, d.y)).r * 0.16;',
          '  s += texture2D(tex, uv - vec2(0.0, d.y)).r * 0.16;',
          '  return s;',
          '}',
          'void main() {',
          '  vec3 N = normalize(vNormal);',
          '  vec3 L = normalize(-light);',
          '  float diff = clamp(dot(N, L), 0.0, 1.0);',
          '  float sandRipple = sin(vWorldPosition.x * 5.0 + vWorldPosition.z * 3.5) * 0.035 +',
          '                     cos(vWorldPosition.x * 2.5 - vWorldPosition.z * 4.0) * 0.02;',
          '  vec3 sand = baseColor + vec3(sandRipple);',
          '  float causticVal = 0.0;',
          '  if (vLightPosition.x >= 0.0 && vLightPosition.x <= 1.0 &&',
          '      vLightPosition.y >= 0.0 && vLightPosition.y <= 1.0) {',
          '    float cDepth = texture2D(caustics, vLightPosition.xy).w;',
          '    if (cDepth > vLightPosition.z - 0.003) {',
          '      causticVal = sampleCaustics(caustics, vLightPosition.xy);',
          '    }',
          '  }',
          '  vec3 causticColor = vec3(0.55, 0.95, 1.0);',
          '  vec3 col = sand * (0.42 + 0.38 * diff);',
          '  col += causticColor * (causticVal * causticsStrength * (0.4 + 0.6 * diff));',
          '  float dist = length(cameraPosition - vWorldPosition);',
          '  float fog = smoothstep(5.0, 28.0, dist);',
          '  col = mix(col, oceanDeepColor, fog);',
          '  gl_FragColor = vec4(col, 1.0);',
          '}'
        ].join('\n')
      });

      this.seabedMesh = new THREE.Mesh(seabedGeo, this.seabedMaterial);
      this.seabedMesh.name = 'Ocean_Seabed';
      this.scene.add(this.seabedMesh);

      // 2. CỤM ĐÁ THẤP Ở HAI BÊN
      var envMeshes = [this.seabedMesh];

      if (typeof window.ROCK_DATA !== 'undefined' && window.ROCK_DATA) {
        var rockData = window.ROCK_DATA;
        var rockGeo = new THREE.BufferGeometry();
        rockGeo.setAttribute('position', new THREE.Float32BufferAttribute(rockData.positions, 3));
        rockGeo.setIndex(rockData.indices);
        rockGeo.computeVertexNormals();

        var rockMat = this.seabedMaterial.clone();
        rockMat.uniforms.baseColor.value = new THREE.Color(0x384a54); // Đá ngầm xám rêu đại dương

        // Cụm đá bên trái tiền cảnh
        var rockLeft = new THREE.Mesh(rockGeo, rockMat);
        rockLeft.position.set(-4.2, -2.15, -0.4);
        rockLeft.scale.set(0.14, 0.08, 0.14);
        rockLeft.rotation.set(0.1, 0.4, 0);
        this.scene.add(rockLeft);
        this.rockMeshes.push(rockLeft);
        envMeshes.push(rockLeft);

        // Cụm đá bên phải trung cảnh
        var rockRight = new THREE.Mesh(rockGeo, rockMat);
        rockRight.position.set(4.0, -2.12, 0.6);
        rockRight.scale.set(0.13, 0.07, 0.13);
        rockRight.rotation.set(-0.1, -0.6, 0.05);
        this.scene.add(rockRight);
        this.rockMeshes.push(rockRight);
        envMeshes.push(rockRight);
      }

      if (this.envMap) {
        this.envMap.setMeshes(envMeshes);
      }
    }

    /**
     * Tạo mặt nước phía trên đường bơi cá mập (HD rõ nét, gợn sóng tự nhiên đa tầng, không đường biên cứng)
     */
    setupWaterSurface() {
      // 1. MẶT BIỂN RỘNG PHÍA TRÊN VỚI BÁN KÍNH MỞ RỘNG (150 x 120 đơn vị)
      var waterGeo = new THREE.PlaneBufferGeometry(150, 120, 96, 72);
      waterGeo.rotateX(-Math.PI / 2);

      var waterMat = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0.0 },
          sunPosition: { value: new THREE.Vector3(2.5, 9.5, -2.0) },
          sunColor: { value: new THREE.Color(0xa5f3fc) },       // Xanh ngọc bích pha trắng sáng
          waterColor: { value: new THREE.Color(0x0e5d70) },     // Xanh ngọc đại dương rạng rỡ
          oceanDeepColor: { value: new THREE.Color(0x021727) }, // Xanh vực thẳm xa
          fogColor: { value: new THREE.Color(0x031826) }        // Sương mù hòa sắc
        },
        vertexShader: [
          'uniform float time;',
          'varying vec3 vWorldPos;',
          'varying vec2 vUv;',
          'void main() {',
          '  vUv = uv;',
          '  vec4 worldPos = modelMatrix * vec4(position, 1.0);',
          '  // Nhấp nhô sóng 3D tự nhiên đa tần số',
          '  float w1 = sin(worldPos.x * 0.45 + worldPos.z * 0.32 + time * 0.65) * 0.045;',
          '  float w2 = cos(worldPos.x * 0.85 - worldPos.z * 0.65 + time * 0.95) * 0.028;',
          '  float w3 = sin(worldPos.x * 1.8 + worldPos.z * 1.4 + time * 1.4) * 0.012;',
          '  worldPos.y += (w1 + w2 + w3);',
          '  vWorldPos = worldPos.xyz;',
          '  gl_Position = projectionMatrix * viewMatrix * worldPos;',
          '}'
        ].join('\n'),
        fragmentShader: [
          'uniform float time;',
          'uniform vec3 sunPosition;',
          'uniform vec3 sunColor;',
          'uniform vec3 waterColor;',
          'uniform vec3 oceanDeepColor;',
          'uniform vec3 fogColor;',
          'varying vec3 vWorldPos;',
          'varying vec2 vUv;',
          '// Vector pháp tuyến sóng 4 tầng chi tiết HD (tỉ lệ 1:1 đẳng hướng không bị méo ngang)',
          'vec3 getHDWaveNormal(vec2 p, float t) {',
          '  vec2 d1 = vec2(0.707, 0.707);',
          '  float p1 = (p.x * d1.x + p.y * d1.y) * 0.55 + t * 0.65;',
          '  vec2 d2 = vec2(-0.6, 0.8);',
          '  float p2 = (p.x * d2.x + p.y * d2.y) * 1.15 - t * 0.85;',
          '  vec2 d3 = vec2(0.85, -0.35);',
          '  float p3 = (p.x * d3.x + p.y * d3.y) * 2.4 + t * 1.25;',
          '  vec2 d4 = vec2(-0.25, -0.96);',
          '  float p4 = (p.x * d4.x + p.y * d4.y) * 4.8 - t * 1.8;',
          '  float dhdx = cos(p1) * d1.x * 0.55 * 0.16 +',
          '               cos(p2) * d2.x * 1.15 * 0.09 +',
          '               cos(p3) * d3.x * 2.4 * 0.04 +',
          '               cos(p4) * d4.x * 4.8 * 0.018;',
          '  float dhdz = cos(p1) * d1.y * 0.55 * 0.16 +',
          '               cos(p2) * d2.y * 1.15 * 0.09 +',
          '               cos(p3) * d3.y * 2.4 * 0.04 +',
          '               cos(p4) * d4.y * 4.8 * 0.018;',
          '  return normalize(vec3(-dhdx, -1.0, -dhdz));',
          '}',
          'void main() {',
          '  vec3 toCam = normalize(cameraPosition - vWorldPos);',
          '  vec3 toSurface = -toCam; // Hướng từ camera nhìn lên mặt nước',
          '  vec3 N = getHDWaveNormal(vWorldPos.xz, time);',
          '  float viewUp = clamp(toSurface.y, 0.0, 1.0);',
          '  // 1. Cửa sổ Snell & Vùng sáng mặt trời trên cao',
          '  vec3 L = normalize(sunPosition - vWorldPos);',
          '  float sunAlign = max(0.0, dot(toSurface, normalize(vec3(L.x, L.y, L.z))));',
          '  float sunHalo = pow(sunAlign, 6.0) * 0.75;',
          '  float sunCore = pow(sunAlign, 36.0) * 1.1;',
          '  // 2. Điểm lấp lánh Specular HD trên các gờ sóng',
          '  vec3 R = reflect(toSurface, N);',
          '  float spec1 = pow(max(0.0, dot(R, L)), 48.0) * 0.85;',
          '  float spec2 = pow(max(0.0, dot(R, L)), 120.0) * 1.25;',
          '  float glint = spec1 + spec2;',
          '  // 3. Phối màu nước biển HD rõ nét',
          '  vec3 luminousSun = mix(sunColor, vec3(1.0, 1.0, 1.0), 0.65);',
          '  vec3 surfaceColorHD = mix(waterColor, luminousSun, clamp(sunHalo + sunCore, 0.0, 1.0));',
          '  surfaceColorHD += vec3(0.92, 0.98, 1.0) * glint;',
          '  // 4. Phản xạ nội toàn phần ở góc xiên (Total Internal Reflection)',
          '  float fresnel = pow(1.0 - viewUp, 2.2);',
          '  surfaceColorHD = mix(surfaceColorHD, oceanDeepColor, fresnel * 0.75);',
          '  // 5. XÓA BỎ HOÀN TOÀN ĐƯỜNG BIÊN CỨNG: Fade xa mượt mà (32 - 68 đơn vị)',
          '  float dist = length(vWorldPos.xz - cameraPosition.xz);',
          '  float edgeFade = 1.0 - smoothstep(32.0, 68.0, dist);',
          '  float alpha = clamp((0.78 + 0.18 * viewUp) * edgeFade, 0.0, 0.95);',
          '  float fogFactor = smoothstep(12.0, 52.0, dist);',
          '  surfaceColorHD = mix(surfaceColorHD, fogColor, fogFactor);',
          '  gl_FragColor = vec4(surfaceColorHD, alpha);',
          '}'
        ].join('\n'),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
      });

      this.waterSurfaceMesh = new THREE.Mesh(waterGeo, waterMat);
      this.waterSurfaceMesh.position.set(0, 2.45, 0);
      this.waterSurfaceMesh.name = 'Ocean_Water_Surface';
      this.scene.add(this.waterSurfaceMesh);

      // 2. CÁC TIA SÁNG XUYÊN NƯỚC MỀM MẠI (Underwater Sunbeams)
      this.sunbeams = new THREE.Group();
      this.sunbeams.name = 'Underwater_Sunbeams';
      var beamGeo = new THREE.PlaneBufferGeometry(5.0, 10.0);
      var beamMat = new THREE.MeshBasicMaterial({
        color: 0x5eead4,
        transparent: true,
        opacity: 0.075,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });

      var beamData = [
        { x: 1.2, y: 0.6, z: -1.0, rotZ: 0.22, rotY: 0.1 },
        { x: -0.6, y: 0.8, z: -0.5, rotZ: -0.18, rotY: -0.2 },
        { x: 2.8, y: 0.5, z: -1.8, rotZ: 0.32, rotY: 0.3 }
      ];

      for (var i = 0; i < beamData.length; i++) {
        var bd = beamData[i];
        var beamMesh = new THREE.Mesh(beamGeo, beamMat);
        beamMesh.position.set(bd.x, bd.y, bd.z);
        beamMesh.rotation.set(-0.25, bd.rotY, bd.rotZ);
        this.sunbeams.add(beamMesh);
      }
      this.scene.add(this.sunbeams);
    }

    /**
     * Bụi nước đại dương siêu mịn lơ lửng
     */
    setupMarineParticles() {
      var isMobile = window.innerWidth < 768;
      var count = isMobile ? 180 : 380;
      var geo = new THREE.BufferGeometry();
      var pos = new Float32Array(count * 3);

      for (var i = 0; i < count; i++) {
        var i3 = i * 3;
        pos[i3] = (Math.random() - 0.5) * 22;
        pos[i3 + 1] = (Math.random() - 0.5) * 10 + 0.2;
        pos[i3 + 2] = (Math.random() - 0.5) * 16;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

      var mat = new THREE.PointsMaterial({
        color: 0x80e5ff,
        size: isMobile ? 0.024 : 0.032,
        transparent: true,
        opacity: 0.38,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });

      this.particles = new THREE.Points(geo, mat);
      this.scene.add(this.particles);
    }

    updateFloatingElements(elapsedTime, delta) {
      // Cập nhật dao động bong bóng
      for (var i = 0; i < this.bubbles.length; i++) {
        var b = this.bubbles[i];
        var u = b.userData;
        b.position.y = u.baseY + Math.sin(elapsedTime * u.speed + u.offset) * u.amp;
        b.position.x = u.baseX + Math.cos(elapsedTime * (u.speed * 0.7) + u.offset) * (u.amp * 0.5);
      }

      // Cập nhật bụi nước
      if (this.particles) {
        var pos = this.particles.geometry.attributes.position.array;
        var count = pos.length / 3;
        for (var j = 0; j < count; j++) {
          var j3 = j * 3;
          pos[j3 + 1] += 0.15 * delta;
          if (pos[j3 + 1] > 8) pos[j3 + 1] = -8;
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
      }
    }

    /**
     * Chuyển động tự bơi qua lại (Autonomous Patrol Swim) của nhóm con sharkSwimGroup:
     * - Bơi chậm từ trái sang phải dọc theo trục X.
     * - Khi tới gần biên, rẽ theo một cung rộng bán kính R để quay đầu 180 độ.
     * - Xoay hướng bơi mượt mà theo trục đầu (+1.36 rad), không lật scale âm, không bơi lùi.
     * - Thay đổi chiều sâu (Z) và độ cao (Y) lượn sóng tự nhiên, nghiêng thân (banking) khi vào cua.
     * - Hoạt động độc lập bằng delta time, không bị ảnh hưởng bởi GSAP ScrollTrigger ở nhóm cha sharkPivot.
     */
    updateSharkMovement(delta, elapsedTime) {
      const swim = this.sharkSwimGroup;
      const pointer = this.sharkPointer;
      if (!swim || !pointer) {
        this.updateSharkPatrol(delta, elapsedTime);
        return;
      }

      const rect = pointer.hero.getBoundingClientRect();
      const canvas = this.renderer.domElement.getBoundingClientRect();
      if (performance.now() - pointer.lastMovedAt < 250 &&
          pointer.x >= rect.left && pointer.x < rect.right &&
          pointer.y >= rect.top && pointer.y < rect.bottom &&
          canvas.width && canvas.height) {
        this.camera.updateMatrixWorld();
        this.sharkPivot.updateMatrixWorld(true);
        this.camera.getWorldDirection(pointer.plane.normal);
        this.sharkPivot.getWorldPosition(pointer.target);
        pointer.plane.setFromNormalAndCoplanarPoint(pointer.plane.normal, pointer.target);
        pointer.ndc.set(
          2 * (pointer.x - canvas.left) / canvas.width - 1,
          1 - 2 * (pointer.y - canvas.top) / canvas.height
        );
        pointer.ray.setFromCamera(pointer.ndc, this.camera);
        if (pointer.ray.ray.intersectPlane(pointer.plane, pointer.target)) {
          this.sharkPivot.worldToLocal(pointer.target);
          const dx = pointer.target.x - swim.position.x;
          const dy = pointer.target.y - swim.position.y;
          const dz = pointer.target.z - swim.position.z;
          const distance = Math.hypot(dx, dy, dz);
          if (distance > 0.035) {
            const horizontal = Math.hypot(dx, dz);
            if (horizontal > 0.01) pointer.yaw = Math.atan2(-dz, dx);
            if (!pointer.turnTarget) {
  pointer.turnTarget = new THREE.Object3D();
}

const pitch = THREE.MathUtils.clamp(
  Math.atan2(dy, horizontal), -1.2, 1.2
);

pointer.turnTarget.rotation.set(0, pointer.yaw, 0);
pointer.turnTarget.rotateZ(pitch);
pointer.turnTarget.rotateY(1.36);

const turnBlend = 1 - Math.exp(-10 * delta);
swim.quaternion.slerp(pointer.turnTarget.quaternion, turnBlend);

            // Giới hạn vị trí thân cá, vẫn hướng đầu về điểm chuột thực tế.
            const isMobile = window.innerWidth < 768;
            const leftLimit = isMobile ? -0.75 : -3.5;
            const rightLimit = isMobile ? 0.55 : 1.45;

            pointer.target.x = THREE.MathUtils.clamp(
            pointer.target.x, leftLimit, rightLimit
            );
            pointer.target.y = THREE.MathUtils.clamp(pointer.target.y, -0.9, 0.9);
            pointer.target.z = THREE.MathUtils.clamp(pointer.target.z, -0.6, 0.6);
            const travel = swim.position.distanceTo(pointer.target);
            if (travel > 0.001) {
              swim.position.lerp(pointer.target, Math.min(1, 1.5 * delta / travel));
            }
          }
          pointer.returnTime = 0.65;
          pointer.returnPosition.copy(swim.position);
          pointer.returnRotation.copy(swim.quaternion);
          return;
        }
      }

      this.updateSharkPatrol(delta, elapsedTime);
      if (pointer.returnTime > 0) {
        pointer.returnTime = Math.max(0, pointer.returnTime - delta);
        const remaining = pointer.returnTime / 0.65;
        const weight = remaining * remaining * (3 - 2 * remaining);
        swim.position.lerp(pointer.returnPosition, weight);
        swim.quaternion.slerp(pointer.returnRotation, weight);
      }
    }

    updateSharkPatrol(delta, elapsedTime) {
      if (!this.sharkSwimGroup) return;

      var isMobile = window.innerWidth < 768;
      // Giới hạn biên độ tuần tra an toàn (tránh vùng chữ và mép màn hình)
      var minX = isMobile ? -0.45 : -1.15;
      var maxX = isMobile ? 0.45 : 1.15;
      var R = isMobile ? 0.28 : 0.42;       // Bán kính cung rẽ rộng tự nhiên
      var speed = isMobile ? 0.65 : 0.88;   // Tốc độ bơi nhanh hơn, chuyển động năng động uyển chuyển

      var L = maxX - minX;
      var P = 2 * L + 2 * Math.PI * R;      // Tổng chu vi một chu kỳ bơi qua lại

      // Tích lũy quãng đường dựa trên delta time (ổn định mọi FPS)
      this.patrolDistance = (this.patrolDistance + speed * delta) % P;
      var s = this.patrolDistance;

      var x, z, vx, vz, banking = 0, dip = 0;

      if (s < L) {
        // GIAI ĐOẠN 1: Bơi thẳng từ trái sang phải
        var u = s;
        x = minX + u;
        z = -R;
        vx = 1; vz = 0;
      } else if (s < L + Math.PI * R) {
        // GIAI ĐOẠN 2: Cung rẽ rộng ở mép phải (quay đầu 180° từ phải sang trái)
        var theta = (s - L) / R;
        x = maxX + R * Math.sin(theta);
        z = -R * Math.cos(theta);
        vx = Math.cos(theta);
        vz = Math.sin(theta);
        // Nghiêng thân vào tâm khúc cua và hạ độ sâu nhẹ
        banking = -0.16 * Math.sin(theta);
        dip = -0.06 * Math.sin(theta);
      } else if (s < 2 * L + Math.PI * R) {
        // GIAI ĐOẠN 3: Bơi thẳng từ phải sang trái
        var u2 = s - (L + Math.PI * R);
        x = maxX - u2;
        z = R;
        vx = -1; vz = 0;
      } else {
        // GIAI ĐOẠN 4: Cung rẽ rộng ở mép trái (quay đầu 180° từ trái sang phải)
        var theta2 = (s - (2 * L + Math.PI * R)) / R;
        x = minX - R * Math.sin(theta2);
        z = R * Math.cos(theta2);
        vx = -Math.cos(theta2);
        vz = -Math.sin(theta2);
        // Nghiêng thân vào tâm khúc cua và hạ độ sâu nhẹ
        banking = 0.16 * Math.sin(theta2);
        dip = -0.06 * Math.sin(theta2);
      }

      // Hướng quay Yaw (rotation.y) tính theo vector vận tốc + góc bù trục đầu thực tế (+1.36 rad)
      var heading = Math.atan2(vz, vx);
      var targetRotY = heading + 1.36;

      // Độ cao uốn lượn (Y) và góc ngẩng đầu/chúi đầu (Pitch) tự nhiên theo nhịp bơi nhanh
      var undulation = Math.sin(elapsedTime * 1.85) * 0.06;
      var pitch = Math.cos(elapsedTime * 1.85) * 0.035;

      this.sharkSwimGroup.position.set(x, undulation + dip, z);
      this.sharkSwimGroup.rotation.set(pitch, targetRotY, banking);
    }

    loadSharkModel() {
      var self = this;
      var loader = new THREE.GLTFLoader();

      this.updateLoadingProgress(25, 'Đang chuẩn bị mô hình cá mập...');

      // Ưu tiên nạp từ dữ liệu nhị phân nhúng để chạy được trực tiếp lẫn server
      if (typeof window.SHARK_MODEL_DATA !== 'undefined' && window.SHARK_MODEL_DATA) {
        try {
          this.updateLoadingProgress(55, 'Đang giải mã mô hình & vật liệu...');
          var buffer = base64ToArrayBuffer(window.SHARK_MODEL_DATA);
          this.updateLoadingProgress(80, 'Đang căn chỉnh tỷ lệ điện ảnh...');

          loader.parse(
            buffer,
            '',
            function (gltf) {
              self.onSharkLoaded(gltf);
            },
            function (err) {
              console.warn('Lỗi parse dữ liệu nhúng, thử nạp qua URL:', err);
              self.loadFromFile(loader);
            }
          );
          return;
        } catch (e) {
          console.warn('Lỗi giải mã base64:', e);
        }
      }

      this.loadFromFile(loader);
    }

    loadFromFile(loader) {
      var self = this;
      loader.load(
        './models/shark/shark.glb',
        function (gltf) {
          self.onSharkLoaded(gltf);
        },
        function (xhr) {
          if (xhr.lengthComputable && xhr.total > 0) {
            var percent = Math.min(Math.round((xhr.loaded / xhr.total) * 100), 95);
            self.updateLoadingProgress(percent, 'Đang nạp dữ liệu (' + percent + '%)...');
          }
        },
        function (err) {
          console.error('Không thể nạp file mô hình:', err);
          self.showFallback('Không thể tải mô hình cá mập. Vui lòng kiểm tra lại file shark.glb.');
          self.hideLoading();
        }
      );
    }

    onSharkLoaded(gltf) {
      console.log('%c🦈 OCEAN DEPTHS — Mô hình cá mập đã sẵn sàng!', 'color: #ff9e79; font-weight: bold; font-size: 14px;');

      // 1. Tách biệt hệ thống theo 3 cấp:
      // - Cấp 1 (sharkPivot): Nhóm cha gắn với ScrollTrigger (vị trí toàn cảnh theo cuộn)
      // - Cấp 2 (sharkSwimGroup): Nhóm con quản lý việc tự bơi qua lại, lượn sóng và rẽ quay đầu
      // - Cấp 3 (sharkModel): Lưới 3D chứa các khớp xương chạy AnimationMixer (quẫy đuôi/thân)
      this.sharkPivot = new THREE.Group();
      this.sharkPivot.name = 'Shark_Pivot_ScrollParent';
      this.scene.add(this.sharkPivot);

      this.sharkSwimGroup = new THREE.Group();
      this.sharkSwimGroup.name = 'Shark_Autonomous_SwimGroup';
      this.sharkPivot.add(this.sharkSwimGroup);

      this.sharkModel = gltf.scene;
      this.sharkModel.name = 'Shark_Animated_Scene';

      // 2. Tinh chỉnh vật liệu da cá mập bóng ướt, bắt sáng hoàng hôn
      this.sharkModel.traverse(function (child) {
        if (child.isMesh && child.material) {
          child.castShadow = true;
          child.receiveShadow = true;
          child.material.roughness = 0.35;
          child.material.metalness = 0.12;
          child.material.needsUpdate = true;
        }
      });

      // 3. Chuẩn hóa kích thước và căn giữa mô hình chính xác vào tâm (0, 0, 0) của sharkSwimGroup
      var initialBox = new THREE.Box3().setFromObject(this.sharkModel);
      var initialSize = initialBox.getSize(new THREE.Vector3());
      var maxDim = Math.max(initialSize.x, initialSize.y, initialSize.z);
      var targetScale = 5.2 / maxDim;
      this.sharkModel.scale.setScalar(targetScale);

      // Cập nhật ma trận và căn giữa chuẩn xác:
      this.sharkModel.updateMatrixWorld(true);
      var scaledBox = new THREE.Box3().setFromObject(this.sharkModel);
      var scaledCenter = scaledBox.getCenter(new THREE.Vector3());
      this.sharkModel.position.set(-scaledCenter.x, -scaledCenter.y, -scaledCenter.z);

      this.sharkModel.scale.multiplyScalar(0.75);
    this.sharkSwimGroup.add(this.sharkModel);

      // 4. Kích hoạt animation 'Swimming' liên tục (quẫy đuôi tuần hoàn theo nhịp bơi nhanh hơn)
      if (gltf.animations && gltf.animations.length > 0) {
        this.mixer = new THREE.AnimationMixer(this.sharkModel);
        var swimClip = THREE.AnimationClip.findByName(gltf.animations, 'Swimming') || gltf.animations[0];
        this.swimmingAction = this.mixer.clipAction(swimClip);
        this.swimmingAction.setLoop(THREE.LoopRepeat);
        this.swimmingAction.timeScale = 1.35; // Tăng nhịp quẫy đuôi đồng bộ nhịp bơi nhanh
        this.swimmingAction.play();
      }

      // 5. Cài đặt GSAP ScrollTrigger uốn lượn S-curve và chuyển màu môi trường
      this.setupCinematicScrollTimeline();

      // 6. Hoàn tất màn hình chờ
      this.updateLoadingProgress(100, 'Khám phá thế giới cá mập!');
      var self = this;
      setTimeout(function () {
        self.hideLoading();
      }, 350);
    }

    /**
     * Thiết lập GSAP ScrollTrigger với đường bơi S-curve và biến đổi màu sắc
     */
    setupCinematicScrollTimeline() {
      if (!this.sharkPivot || typeof gsap === 'undefined') return;

      if (typeof ScrollTrigger !== 'undefined') {
        gsap.registerPlugin(ScrollTrigger);
      }

      var isMobile = window.innerWidth < 768;

      // TỌA ĐỘ BỐ CỤC TOÀN CẢNH (NHÓM CHA sharkPivot):
      // Giai đoạn 1: Mở đầu (Hero) - Đặt cá mập bơi ở GIỮA màn hình (y: 0.4 khớp độ cao camera)
      var p1 = isMobile
        ? { x: 0.0, y: 0.55, z: -0.4, rotX: 0.02, scale: 0.72 }
        : { x: 1.15, y: 0.40, z: 0.0, rotX: 0.02, scale: 1.05 };

      // Giai đoạn 2: Giác quan (Senses) - Duy trì cá mập ở giữa màn hình bên phải khối nội dung
      var p2 = isMobile
        ? { x: 0.1, y: 0.45, z: -0.3, rotX: -0.05, scale: 0.75 }
        : { x: 1.35, y: 0.40, z: 0.2, rotX: -0.08, scale: 1.05 };

      // Giai đoạn 3: Sinh vật (Species) - Bơi ở giữa màn hình phía trên các thẻ khám phá
      var p3 = isMobile
        ? { x: 0.0, y: 0.50, z: -0.5, rotX: 0.02, scale: 0.7 }
        : { x: -1.3, y: 0.45, z: -0.1, rotX: 0.02, scale: 0.95 };

      // Giai đoạn 4: Cảnh kết (Conserve) - Bơi uyển chuyển ngay trung tâm màn hình hướng lên luồng sáng
      var p4 = isMobile
        ? { x: 0.0, y: 0.50, z: -0.3, rotX: 0.1, scale: 0.75 }
        : { x: 0.0, y: 0.45, z: 0.0, rotX: 0.1, scale: 1.05 };

      // Thiết lập vị trí khởi đầu cho nhóm cha sharkPivot (không ghi đè rotation.y của nhóm con)
      this.sharkPivot.position.set(p1.x, p1.y, p1.z);
      this.sharkPivot.rotation.set(p1.rotX, 0, 0);
      this.sharkPivot.scale.setScalar(p1.scale);

      if (this.timeline) {
        this.timeline.kill();
        if (typeof ScrollTrigger !== 'undefined') {
          ScrollTrigger.getAll().forEach(function (t) { t.kill(); });
        }
      }

      if (this.reducedMotion) return;

      var self = this;

      // 1 TIMELINE DUY NHẤT ĐIỀU KHIỂN BỐ CỤC TOÀN CẢNH (NHÓM CHA)
      this.timeline = gsap.timeline({
        scrollTrigger: {
          trigger: '.content-scroll',
          start: 'top top',
          end: 'bottom bottom',
          scrub: 1.2,
          invalidateOnRefresh: true,
          onUpdate: function (s) {
            self.onScrollProgress(s.progress);
          }
        }
      });

      // BƯỚC 1: TỪ HERO -> SENSES (0.0 -> 0.33)
      this.timeline.to(this.sharkPivot.position, {
        x: p2.x, y: p2.y, z: p2.z, ease: 'power1.inOut', duration: 1
      }, 0);
      this.timeline.to(this.sharkPivot.rotation, {
        x: p2.rotX, ease: 'power1.inOut', duration: 1
      }, 0);
      this.timeline.to(this.sharkPivot.scale, {
        x: p2.scale, y: p2.scale, z: p2.scale, ease: 'power1.inOut', duration: 1
      }, 0);
      // Mặt nước phía trên và đáy cát phía dưới phản ứng theo hành trình cuộn
      if (this.waterSurfaceMesh) {
        this.timeline.to(this.waterSurfaceMesh.position, { y: 3.4, duration: 1 }, 0);
        this.timeline.to(this.waterSurfaceMesh.material, { opacity: 0.35, duration: 0.8 }, 0.2);
      }
      if (this.seabedMesh) {
        this.timeline.to(this.seabedMesh.position, { y: -2.75, duration: 1 }, 0);
      }
      this.timeline.to('.hero-content', { opacity: 0, y: -40, duration: 0.5 }, 0);
      this.timeline.to('.scroll-card', { opacity: 0, y: 20, duration: 0.4 }, 0);

      // BƯỚC 2: TỪ SENSES -> SPECIES (0.33 -> 0.66)
      this.timeline.to(this.sharkPivot.position, {
        x: p3.x, y: p3.y, z: p3.z, ease: 'power1.inOut', duration: 1
      }, 1);
      this.timeline.to(this.sharkPivot.rotation, {
        x: p3.rotX, ease: 'power1.inOut', duration: 1
      }, 1);
      this.timeline.to(this.sharkPivot.scale, {
        x: p3.scale, y: p3.scale, z: p3.scale, ease: 'power1.inOut', duration: 1
      }, 1);
      if (this.waterSurfaceMesh) {
        this.timeline.to(this.waterSurfaceMesh.material, { opacity: 0.2, duration: 1 }, 1);
      }

      // BƯỚC 3: TỪ SPECIES -> CONSERVE (0.66 -> 1.0)
      this.timeline.to(this.sharkPivot.position, {
        x: p4.x, y: p4.y, z: p4.z, ease: 'power1.inOut', duration: 1
      }, 2);
      this.timeline.to(this.sharkPivot.rotation, {
        x: p4.rotX, ease: 'power1.inOut', duration: 1
      }, 2);
      this.timeline.to(this.sharkPivot.scale, {
        x: p4.scale, y: p4.scale, z: p4.scale, ease: 'power1.inOut', duration: 1
      }, 2);
      if (this.waterSurfaceMesh) {
        this.timeline.to(this.waterSurfaceMesh.position, { y: 2.5, duration: 1 }, 2);
        this.timeline.to(this.waterSurfaceMesh.material, { opacity: 0.7, duration: 1 }, 2);
      }
      if (this.seabedMesh) {
        this.timeline.to(this.seabedMesh.position, { y: -2.35, duration: 1 }, 2);
      }

      // Hiệu ứng Fade in cho các khối giao diện
      gsap.utils.toArray('.feature-card').forEach(function (card) {
        gsap.from(card, {
          scrollTrigger: {
            trigger: card,
            start: 'top 85%',
            end: 'top 45%',
            scrub: 1
          },
          opacity: 0,
          y: 40,
          scale: 0.96
        });
      });

      gsap.from('.species-card', {
        scrollTrigger: {
          trigger: '.species-grid',
          start: 'top 85%',
          end: 'top 45%',
          scrub: 1
        },
        opacity: 0,
        y: 45,
        stagger: 0.15
      });
    }

    /**
     * Cập nhật chuyển sắc nền và đèn Three.js theo tiến trình cuộn
     */
    onScrollProgress(progress) {
      if (!this.backdrop) return;

      var topColor, midColor, botColor, fogColor;

      if (progress < 0.3) {
        // Giai đoạn 1: Biển ngọc bích ánh nắng (0% - 30%)
        topColor = '#0b4959';
        midColor = '#052636';
        botColor = '#02121e';
        fogColor = 0x031826;
        if (this.sunLight) this.sunLight.color.setHex(0xe0f7fa);
        if (this.rimLight) this.rimLight.color.setHex(0x38bdf8);
        if (this.seabedMaterial && this.seabedMaterial.uniforms) {
          this.seabedMaterial.uniforms.causticsStrength.value = 0.42;
        }
      } else if (progress < 0.7) {
        // Giai đoạn 2: Vực thẳm đại dương xanh tím sâu lắng (30% - 70%)
        topColor = '#06132e';
        midColor = '#040d21';
        botColor = '#020612';
        fogColor = 0x03081a;
        if (this.sunLight) this.sunLight.color.setHex(0x38bdf8);
        if (this.rimLight) this.rimLight.color.setHex(0x818cf8);
        if (this.seabedMaterial && this.seabedMaterial.uniforms) {
          this.seabedMaterial.uniforms.causticsStrength.value = 0.28;
        }
      } else {
        // Giai đoạn 3: Biển sâu xanh ngọc bích tái sinh (70% - 100%)
        topColor = '#033b47';
        midColor = '#012830';
        botColor = '#01151a';
        fogColor = 0x011f26;
        if (this.sunLight) this.sunLight.color.setHex(0x2dd4bf);
        if (this.rimLight) this.rimLight.color.setHex(0x34d399);
        if (this.seabedMaterial && this.seabedMaterial.uniforms) {
          this.seabedMaterial.uniforms.causticsStrength.value = 0.36;
        }
      }

      this.backdrop.style.setProperty('--bg-gradient-top', topColor);
      this.backdrop.style.setProperty('--bg-gradient-mid', midColor);
      this.backdrop.style.setProperty('--bg-gradient-bot', botColor);

      if (this.scene && this.scene.fog) {
        this.scene.fog.color.setHex(fogColor);
      }

      // Cập nhật nav active
      this.updateActiveNav(progress);
    }

    updateActiveNav(progress) {
      var links = document.querySelectorAll('.nav-item');
      var targets = ['hero', 'senses', 'species', 'conserve'];
      var activeIndex = 0;

      if (progress > 0.75) activeIndex = 3;
      else if (progress > 0.45) activeIndex = 2;
      else if (progress > 0.15) activeIndex = 1;

      links.forEach(function (l, idx) {
        if (idx === activeIndex) l.classList.add('active');
        else l.classList.remove('active');
      });
    }

    initNavigation() {
      var btnExplore = document.getElementById('btn-explore');
      var btnAbout = document.getElementById('btn-about');
      var btnBackTop = document.getElementById('btn-back-top');
      var navItems = document.querySelectorAll('.nav-item');

      if (btnExplore) {
        btnExplore.addEventListener('click', function (e) {
          e.preventDefault();
          var s = document.getElementById('senses');
          if (s) s.scrollIntoView({ behavior: 'smooth' });
        });
      }

      if (btnAbout) {
        btnAbout.addEventListener('click', function (e) {
          e.preventDefault();
          var s = document.getElementById('species');
          if (s) s.scrollIntoView({ behavior: 'smooth' });
        });
      }

      if (btnBackTop) {
        btnBackTop.addEventListener('click', function (e) {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }

      navItems.forEach(function (item) {
        item.addEventListener('click', function (e) {
          e.preventDefault();
          var targetId = item.getAttribute('data-target');
          var targetEl = document.getElementById(targetId);
          if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth' });
        });
      });
    }

    initCreditsModal() {
      var modal = document.getElementById('credits-modal');
      var openBtn1 = document.getElementById('credits-toggle-btn');
      var openBtn2 = document.getElementById('btn-open-license');
      var closeBtn = document.getElementById('credits-close-btn');
      var overlay = document.getElementById('credits-overlay');

      function open() {
        if (modal) {
          modal.classList.add('is-open');
          modal.setAttribute('aria-hidden', 'false');
        }
      }

      function close() {
        if (modal) {
          modal.classList.remove('is-open');
          modal.setAttribute('aria-hidden', 'true');
        }
      }

      if (openBtn1) openBtn1.addEventListener('click', open);
      if (openBtn2) openBtn2.addEventListener('click', open);
      if (closeBtn) closeBtn.addEventListener('click', close);
      if (overlay) overlay.addEventListener('click', close);

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal && modal.classList.contains('is-open')) {
          close();
        }
      });
    }

    updateLoadingProgress(percent, text) {
      if (this.loadingProgressBar) this.loadingProgressBar.style.width = percent + '%';
      if (this.loadingPercent) this.loadingPercent.textContent = percent + '%';
      if (this.loadingStatus && text) this.loadingStatus.textContent = text;
    }

    hideLoading() {
      if (this.loadingScreen) this.loadingScreen.classList.add('is-loaded');
    }

    showFallback(msg) {
      if (this.fallbackBanner) this.fallbackBanner.style.display = 'block';
      if (this.fallbackMessage) this.fallbackMessage.textContent = msg;
      var closeBtn = document.getElementById('fallback-close');
      if (closeBtn) {
        var self = this;
        closeBtn.onclick = function () {
          if (self.fallbackBanner) self.fallbackBanner.style.display = 'none';
        };
      }
    }

    bindEvents() {
      var self = this;
      window.addEventListener('resize', function () {
        self.handleResize();
      }, false);
      const hero = document.getElementById('hero');
      if (hero && !this.reducedMotion) {
        const pointer = this.sharkPointer = {
          hero,
          x: 0,
          y: 0,
          lastMovedAt: -Infinity,
          yaw: 0,
          returnTime: 0,
          ndc: new THREE.Vector2(),
          ray: new THREE.Raycaster(),
          plane: new THREE.Plane(),
          target: new THREE.Vector3(),
          returnPosition: new THREE.Vector3(),
          returnRotation: new THREE.Quaternion()
        };

        window.addEventListener('pointermove', function (event) {
          if (event.pointerType !== 'mouse') return;
          pointer.x = event.clientX;
          pointer.y = event.clientY;
          pointer.lastMovedAt = performance.now();
        }, { passive: true, capture: true });

        window.addEventListener('blur', function () {
          pointer.lastMovedAt = -Infinity;
        });
      }

      // Tương tác chuột khuấy động gợn sóng nước mềm mại
      window.addEventListener('mousemove', function (e) {
        if (self.waterSim && self.renderer && !self.reducedMotion) {
          var nx = (e.clientX / window.innerWidth) * 2 - 1;
          var ny = -((e.clientY / window.innerHeight) * 2 - 1);
          if (Math.random() < 0.22) {
            self.waterSim.addDrop(self.renderer, nx * 0.75, ny * 0.75, 0.038, 0.02);
          }
        }
      }, { passive: true });
    }

    handleResize() {
      var w = window.innerWidth;
      var h = window.innerHeight;

      if (this.camera) {
        this.camera.fov = w < 768 ? 48 : 38;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }

      if (this.renderer) {
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      }

      this.setupCinematicScrollTimeline();
    }

    animate() {
      var self = this;
      requestAnimationFrame(function () {
        self.animate();
      });

      var currentTime = performance.now();
      var delta = Math.min((currentTime - this.lastTime) / 1000, 0.1);
      this.lastTime = currentTime;
      var elapsedTime = (currentTime - this.startTime) / 1000;

      // 1. Cập nhật Animation quẫy đuôi cá mập (AnimationMixer độc lập)
      if (this.mixer) {
        this.mixer.update(delta);
      }

      // 2. Cập nhật chuyển động tự bơi qua lại & rẽ quay đầu của nhóm con sharkSwimGroup
      if (!this.reducedMotion) {
        this.updateSharkMovement(delta, elapsedTime);
      }

      // 3. Cập nhật bụi nước lơ lửng & thời gian cho mặt nước
      this.updateFloatingElements(elapsedTime, delta);

      if (this.waterSurfaceMesh && this.waterSurfaceMesh.material && this.waterSurfaceMesh.material.uniforms) {
        if (this.waterSurfaceMesh.material.uniforms.time) {
          this.waterSurfaceMesh.material.uniforms.time.value = elapsedTime;
        }
      }

      if (this.sunbeams) {
        this.sunbeams.rotation.z = Math.sin(elapsedTime * 0.45) * 0.04;
        this.sunbeams.rotation.x = Math.cos(elapsedTime * 0.35) * 0.03;
      }

      // 4. PIPELINE CAUSTICS & SÓNG NƯỚC (ThreeJS Caustics)
      if (this.waterSim && this.caustics && this.renderer) {
        this.simTick = (this.simTick || 0) + 1;
        // Kích hoạt sóng gợn nhẹ tuần hoàn tự nhiên
        if (this.simTick % 42 === 0 && !this.reducedMotion) {
          var rx = (Math.random() - 0.5) * 1.3;
          var ry = (Math.random() - 0.5) * 1.3;
          this.waterSim.addDrop(this.renderer, rx, ry, 0.04, 0.022);
        }

        this.waterSim.stepSimulation(this.renderer);
        var waterTex = this.waterSim.target.texture;

        // PASS 1: Environment Map từ góc nhìn Light Camera
        // Giữ cá mập ngoài pass caustics theo đúng yêu cầu đề bài
        if (this.sharkPivot) this.sharkPivot.visible = false;
        if (this.waterSurfaceMesh) this.waterSurfaceMesh.visible = false;
        if (this.sunbeams) this.sunbeams.visible = false;

        if (this.envMap) {
          this.envMap.render(this.renderer, this.lightCamera);
          var envTex = this.envMap.target.texture;

          // PASS 2: Caustics Refraction từ góc nhìn Light Camera
          this.caustics.setTextures(waterTex, envTex);
          this.caustics.render(this.renderer, this.lightCamera);
          var causticsTex = this.caustics.target.texture;

          // Cập nhật tia caustics vào vật liệu đáy biển
          if (this.seabedMaterial && this.seabedMaterial.uniforms) {
            this.seabedMaterial.uniforms['caustics'].value = causticsTex;
          }
        }

        // Khôi phục hiển thị đầy đủ cho cá mập, mặt nước và tia nắng
        if (this.sharkPivot) this.sharkPivot.visible = true;
        if (this.waterSurfaceMesh) this.waterSurfaceMesh.visible = true;
        if (this.sunbeams) this.sunbeams.visible = true;
      }

      // 5. Render toàn cảnh chính với camera người xem
      if (this.renderer && this.scene && this.camera) {
  if (this.waterSurfaceMesh) this.waterSurfaceMesh.visible = false;
  if (this.seabedMesh) this.seabedMesh.visible = false;
  if (this.sunbeams) this.sunbeams.visible = false;

  this.rockMeshes.forEach(function (rock) {
    rock.visible = false;
  });

  this.renderer.render(this.scene, this.camera);
}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      new OceanDepthsApp();
    });
  } else {
    new OceanDepthsApp();
  }
})();
