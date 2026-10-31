/**
 * OCEAN DEPTHS - Main 3D Experience Script
 * 
 * Công nghệ: Three.js (r187), GSAP ScrollTrigger, Vite, Vanilla JavaScript.
 * Tính năng chính:
 * 1. Khởi tạo sân khấu 3D với ánh sáng đại dương sâu thẳm, hiệu ứng sương mù nước & bụi nước trôi.
 * 2. Tải mô hình 3D cá mập trắng từ file public/models/shark/scene.gltf.
 * 3. Bảo toàn chất liệu PBR chân thực (diffuse, normal, occlusion).
 * 4. Liệt kê các animation trong GLTF và kích hoạt chuyển động 'Swimming' liên tục.
 * 5. Tách biệt sharkPivot (chuyển vị theo cuộn GSAP) khỏi chuyển động vẫy đuôi/bơi của mô hình.
 * 6. Responsive linh hoạt, hỗ trợ prefers-reduced-motion, và xử lý fallback khi không có WebGL.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ScrollDirector } from './scrollTimeline.js';

class OceanDepthsApp {
  constructor() {
    this.canvas = document.getElementById('webgl-canvas');
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

    // Đối tượng điều khiển mô hình cá mập
    this.sharkPivot = null;   // Wrapper group: điều khiển tọa độ/góc xoay toàn cảnh bằng ScrollTrigger
    this.sharkModel = null;   // Scene bên trong: chứa xương và mesh nhận animation từ AnimationMixer
    this.mixer = null;        // AnimationMixer xử lý animation 'Swimming'
    this.swimmingAction = null;

    // Hệ thống hạt bụi nước (marine snow / plankton)
    this.particles = null;

    // Trình quản lý cuộn GSAP
    this.scrollDirector = null;

    this.init();
  }

  /**
   * Kiểm tra khả năng hỗ trợ WebGL
   */
  checkWebGLSupport() {
    try {
      const testCanvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && 
        (testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  init() {
    // 1. Kiểm tra WebGL
    if (!this.checkWebGLSupport()) {
      this.showFallback('Trình duyệt hoặc thiết bị của bạn không bật hỗ trợ WebGL 3D. Bạn vẫn có thể đọc toàn bộ thông tin dự án bên dưới.');
      this.hideLoading();
      return;
    }

    try {
      // 2. Khởi tạo Three.js
      this.setupScene();
      this.setupCamera();
      this.setupRenderer();
      this.setupOceanLighting();
      this.setupMarineParticles();

      // 3. Tải mô hình 3D cá mập
      this.loadSharkModel();

      // 4. Lắng nghe sự kiện cửa sổ
      this.bindEvents();

      // 5. Khởi tạo giao diện Modal Bản quyền
      this.initCreditsModal();

      // 6. Bắt đầu vòng lặp render
      this.animate();
    } catch (err) {
      console.error('Lỗi khởi tạo Three.js:', err);
      this.showFallback(`Không thể khởi tạo không gian 3D: ${err.message}`);
      this.hideLoading();
    }
  }

  setupScene() {
    this.scene = new THREE.Scene();
    // Màu nước biển sâu navy thăm thẳm
    this.scene.background = new THREE.Color(0x020a17);
    // Sương mù đại dương tăng cảm giác chiều sâu điện ảnh
    this.scene.fog = new THREE.FogExp2(0x020a17, 0.048);
  }

  setupCamera() {
    const fov = window.innerWidth < 768 ? 50 : 42;
    this.camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 0, 7.8);
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Giới hạn pixel ratio tối đa 2 để mượt mà trên màn hình Retina / điện thoại
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
  }

  /**
   * Thiết lập hệ thống ánh sáng đại dương:
   * Ánh sáng rọi từ mặt nước xuống (cyan) + ánh sáng phản xạ từ đáy biển + ánh sáng viền
   */
  setupOceanLighting() {
    // 1. Ánh sáng môi trường dịu nhẹ màu xanh biển
    const ambientLight = new THREE.AmbientLight(0x082d4f, 1.8);
    this.scene.add(ambientLight);

    // 2. Nắng biển rọi từ trên mặt nước xuống (Sunlight Caustics Directional Light)
    const sunLight = new THREE.DirectionalLight(0x38bdf8, 3.2);
    sunLight.position.set(4, 9, 5);
    this.scene.add(sunLight);

    // 3. Ánh sáng hắt dịu từ phía trước để thấy rõ mắt và da cá mập
    const frontLight = new THREE.DirectionalLight(0xe0f2fe, 1.6);
    frontLight.position.set(-2, 1, 6);
    this.scene.add(frontLight);

    // 4. Ánh sáng phản xạ dưới bụng cá từ chiều sâu đại dương (Up-welling fill light)
    const bellyLight = new THREE.DirectionalLight(0x0369a1, 1.2);
    bellyLight.position.set(0, -6, 2);
    this.scene.add(bellyLight);

    // 5. Đèn điểm viền lưng cá (Rim light tạo đường nét sắc sảo)
    const rimLight = new THREE.PointLight(0x00f0ff, 2.5, 18);
    rimLight.position.set(3, 3, -4);
    this.scene.add(rimLight);
  }

  /**
   * Tạo hiệu ứng bụi nước biển / sinh vật phù du chuyển động lơ lửng
   */
  setupMarineParticles() {
    const isMobile = window.innerWidth < 768;
    // Giảm số lượng hạt trên điện thoại để tiết kiệm pin và tối ưu GPU
    const particleCount = isMobile ? 380 : 1200;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const scales = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * 22;     // X
      positions[i3 + 1] = (Math.random() - 0.5) * 18; // Y
      positions[i3 + 2] = (Math.random() - 0.5) * 16; // Z
      scales[i] = Math.random() * 0.8 + 0.2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('scale', new THREE.BufferAttribute(scales, 1));

    // Tạo chất liệu hạt phát sáng cyan trong suốt
    const particleMaterial = new THREE.PointsMaterial({
      color: 0x67e8f9,
      size: isMobile ? 0.045 : 0.055,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.particles = new THREE.Points(geometry, particleMaterial);
    this.scene.add(this.particles);
  }

  /**
   * Cập nhật vị trí các hạt nước trôi nhẹ theo dòng hải lưu
   */
  updateParticles(delta) {
    if (!this.particles) return;
    const positions = this.particles.geometry.attributes.position.array;
    const count = positions.length / 3;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // Trôi nhẹ lên trên
      positions[i3 + 1] += 0.25 * delta;
      // Dao động ngang nhẹ nhàng
      positions[i3] += Math.sin(positions[i3 + 1] * 0.5) * 0.08 * delta;

      // Khi trôi quá cao, đưa về đáy
      if (positions[i3 + 1] > 9) {
        positions[i3 + 1] = -9;
        positions[i3] = (Math.random() - 0.5) * 22;
      }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * Tải mô hình 3D cá mập GLTF
   */
  loadSharkModel() {
    const modelPath = './models/shark/scene.gltf';
    const loader = new GLTFLoader();

    this.updateLoadingProgress(10, 'Đang tải tệp mô hình đại dương...');

    loader.load(
      modelPath,
      (gltf) => {
        try {
          this.onSharkLoaded(gltf);
        } catch (err) {
          console.error('Lỗi khi thiết lập mô hình:', err);
          this.showFallback(`Lỗi cấu hình mô hình: ${err.message}`);
          this.hideLoading();
        }
      },
      (xhr) => {
        if (xhr.lengthComputable && xhr.total > 0) {
          const percent = Math.min(Math.round((xhr.loaded / xhr.total) * 100), 95);
          this.updateLoadingProgress(percent, `Đang giải mã mô hình & chất liệu (${percent}%)...`);
        } else {
          this.updateLoadingProgress(60, 'Đang giải mã dữ liệu sinh vật...');
        }
      },
      (error) => {
        console.error('Không thể tải mô hình cá mập:', error);
        this.showFallback('Không tìm thấy file mô hình tại public/models/shark/scene.gltf hoặc đường truyền bị gián đoạn.');
        this.hideLoading();
      }
    );
  }

  /**
   * Xử lý sau khi mô hình cá mập được tải thành công
   */
  onSharkLoaded(gltf) {
    console.log('%c🦈 OCEAN DEPTHS — Mô hình cá mập tải thành công!', 'color: #00f0ff; font-weight: bold; font-size: 14px;');

    // 1. Liệt kê các animation có sẵn theo yêu cầu đề bài
    const animationNames = gltf.animations.map(a => a.name);
    console.log('Danh sách animation có trong mô hình:', animationNames);

    // 2. Tách đối tượng điều khiển: Tạo sharkPivot làm cha
    // Mọi chuyển động cuộn màn hình sẽ tác động lên sharkPivot,
    // giữ nguyên xương và các node bên trong sharkModel độc lập!
    this.sharkPivot = new THREE.Group();
    this.sharkPivot.name = 'Shark_Pivot_Controller';
    this.scene.add(this.sharkPivot);

    this.sharkModel = gltf.scene;
    this.sharkModel.name = 'Shark_Animated_Scene';

    // 3. Tinh chỉnh chất liệu và đảm bảo texture hiển thị rõ nét
    this.setupSharkMaterials(this.sharkModel);

    // 4. Đo đạc kích thước và căn giữa mô hình trong pivot
    const box = new THREE.Box3().setFromObject(this.sharkModel);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Đưa tâm hình học của cá mập về gốc tọa độ của pivot
    this.sharkModel.position.set(-center.x, -center.y, -center.z);

    // Chuẩn hóa kích thước mô hình theo chiều dài thân (khoảng 5.8 đơn vị Three.js)
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetScale = 5.8 / maxDim;
    this.sharkModel.scale.setScalar(targetScale);

    // Thêm mô hình vào pivot
    this.sharkPivot.add(this.sharkModel);

    // 5. Cài đặt AnimationMixer và chọn chuyển động 'Swimming'
    if (gltf.animations && gltf.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(this.sharkModel);

      // Tìm animation 'Swimming' (hoặc animation đầu tiên nếu không trùng tên)
      const swimClip = THREE.AnimationClip.findByName(gltf.animations, 'Swimming') || gltf.animations[0];
      console.log(`Đã chọn animation bơi: "${swimClip.name}" (Thời lượng: ${swimClip.duration.toFixed(2)}s)`);

      this.swimmingAction = this.mixer.clipAction(swimClip);
      this.swimmingAction.setLoop(THREE.LoopRepeat);
      this.swimmingAction.timeScale = 0.85; // Bơi nhịp nhàng, êm dịu
      this.swimmingAction.play();
    } else {
      console.warn('Mô hình không chứa clip animation nào.');
    }

    // 6. Khởi tạo ScrollDirector (GSAP ScrollTrigger gắn kết với sharkPivot)
    this.scrollDirector = new ScrollDirector(this.sharkPivot, this.camera);

    // 7. Hoàn tất màn hình tải
    this.updateLoadingProgress(100, 'Sẵn sàng lặn sâu!');
    setTimeout(() => {
      this.hideLoading();
    }, 450);
  }

  /**
   * Đảm bảo vật liệu và texture của cá mập hiển thị sắc nét, sống động dưới nước
   */
  setupSharkMaterials(model) {
    const textureLoader = new THREE.TextureLoader();

    // Tải các texture gốc đi kèm mô hình trong thư mục textures/ (dùng đường dẫn tương đối)
    const diffuseMap = textureLoader.load('./models/shark/textures/material_0_diffuse.png');
    const normalMap = textureLoader.load('./models/shark/textures/material_0_normal.png');
    const aoMap = textureLoader.load('./models/shark/textures/material_0_occlusion.png');

    diffuseMap.colorSpace = THREE.SRGBColorSpace;

    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;

        // Nếu vật liệu hiện tại chưa có map hoặc bị thiếu do specular-glossiness
        if (!child.material || !child.material.map) {
          child.material = new THREE.MeshStandardMaterial({
            map: diffuseMap,
            normalMap: normalMap,
            normalScale: new THREE.Vector2(1.2, 1.2),
            aoMap: aoMap,
            aoMapIntensity: 1.0,
            roughness: 0.38, // Da cá mập bóng ướt dưới nước
            metalness: 0.08,
            envMapIntensity: 1.2
          });
        } else {
          // Tinh chỉnh vật liệu sẵn có để da cá mập bóng ướt và bắt sáng
          child.material.roughness = THREE.MathUtils.clamp(child.material.roughness ?? 0.4, 0.3, 0.6);
          child.material.metalness = THREE.MathUtils.clamp(child.material.metalness ?? 0.1, 0.05, 0.2);
          child.material.needsUpdate = true;
        }
      }
    });
  }

  updateLoadingProgress(percent, statusText) {
    if (this.loadingProgressBar) {
      this.loadingProgressBar.style.width = `${percent}%`;
    }
    if (this.loadingPercent) {
      this.loadingPercent.textContent = `${percent}%`;
    }
    if (this.loadingStatus && statusText) {
      this.loadingStatus.textContent = statusText;
    }
  }

  hideLoading() {
    if (this.loadingScreen) {
      this.loadingScreen.classList.add('is-loaded');
    }
  }

  showFallback(message) {
    if (this.fallbackBanner) {
      this.fallbackBanner.style.display = 'block';
    }
    if (this.fallbackMessage) {
      this.fallbackMessage.textContent = message;
    }
    const closeBtn = document.getElementById('fallback-close');
    if (closeBtn) {
      closeBtn.onclick = () => {
        this.fallbackBanner.style.display = 'none';
      };
    }
  }

  initCreditsModal() {
    const creditsModal = document.getElementById('credits-modal');
    const creditsBtn = document.getElementById('credits-toggle-btn');
    const closeBtn = document.getElementById('credits-close-btn');
    const overlay = document.getElementById('credits-overlay');

    const openModal = () => {
      creditsModal.classList.add('is-open');
      creditsModal.setAttribute('aria-hidden', 'false');
    };

    const closeModal = () => {
      creditsModal.classList.remove('is-open');
      creditsModal.setAttribute('aria-hidden', 'true');
    };

    if (creditsBtn) creditsBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (overlay) overlay.addEventListener('click', closeModal);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && creditsModal.classList.contains('is-open')) {
        closeModal();
      }
    });
  }

  bindEvents() {
    window.addEventListener('resize', () => this.handleResize(), false);
  }

  handleResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Cập nhật Camera FOV phù hợp theo màn hình
    this.camera.fov = width < 768 ? 50 : 42;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // Cập nhật kích thước Renderer
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Cập nhật ScrollDirector
    if (this.scrollDirector) {
      this.scrollDirector.handleResize();
    }
  }

  /**
   * Vòng lặp render chính (requestAnimationFrame)
   */
  animate() {
    requestAnimationFrame(() => this.animate());

    const currentTime = performance.now();
    const delta = Math.min((currentTime - this.lastTime) / 1000, 0.1);
    this.lastTime = currentTime;
    const elapsedTime = (currentTime - this.startTime) / 1000;

    // 1. Cập nhật Animation thân và đuôi độc lập hoàn toàn với cuộn chuột
    if (this.mixer) {
      this.mixer.update(delta);
    }

    // 2. Chuyển động nổi bồng bềnh nhẹ nhàng của đại dương (subtle oceanic buoyance)
    if (this.sharkPivot && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const bobbing = Math.sin(elapsedTime * 1.4) * 0.04;
      this.sharkPivot.position.y += bobbing * delta;
    }

    // 3. Cập nhật bụi nước
    this.updateParticles(delta);

    // 4. Render cảnh
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

// Khởi chạy ứng dụng khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  new OceanDepthsApp();
});
