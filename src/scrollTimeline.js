/**
 * OCEAN DEPTHS - Scroll Timeline with GSAP & ScrollTrigger
 * 
 * Quản lý chuyển động cuộn đồng bộ giữa đối tượng 3D (sharkPivot) và giao diện DOM.
 * Đảm bảo:
 * 1. Tách biệt hoàn toàn sharkPivot khỏi xương/node animation bên trong.
 * 2. Scrub 2 chiều mượt mà, không bị giật hay nhảy vị trí.
 * 3. Hỗ trợ prefers-reduced-motion.
 * 4. Tự điều chỉnh tọa độ theo màn hình máy tính vs điện thoại.
 */

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export class ScrollDirector {
  constructor(sharkPivot, camera) {
    this.sharkPivot = sharkPivot;
    this.camera = camera;
    this.isMobile = window.innerWidth < 768;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.timeline = null;

    this.init();
  }

  // Lấy tọa độ cấu hình theo kích thước màn hình
  getCoordinates() {
    this.isMobile = window.innerWidth < 768;

    if (this.isMobile) {
      return {
        // Màn 1 trên điện thoại: hạ thấp trọng tâm để không che tiêu đề
        hero: {
          x: 0,
          y: -1.3,
          z: -0.8,
          rotX: 0.05,
          rotY: -0.35,
          rotZ: 0.02,
          scale: 0.72
        },
        // Màn 2 trên điện thoại: dịch xuống dưới đáy
        intro: {
          x: 0.3,
          y: -1.6,
          z: -1.2,
          rotX: -0.04,
          rotY: -0.8,
          rotZ: -0.02,
          scale: 0.65
        }
      };
    }

    // Màn hình máy tính / Desktop
    return {
      // Màn 1: Cá mập ở trung tâm lệch phải, góc nhìn chếch ngang khoe trọn thân hình
      hero: {
        x: 1.8,
        y: -0.15,
        z: 0.1,
        rotX: 0.04,
        rotY: -0.42,
        rotZ: 0.02,
        scale: 1.0
      },
      // Màn 2: Cá mập dịch hẳn sang bên phải, xoay nhẹ để nhường không gian bên trái cho nội dung
      intro: {
        x: 3.1,
        y: -0.3,
        z: 0.35,
        rotX: -0.06,
        rotY: -0.85,
        rotZ: -0.03,
        scale: 1.05
      }
    };
  }

  init() {
    if (!this.sharkPivot) return;

    const coords = this.getCoordinates();

    // Thiết lập vị trí khởi đầu của sharkPivot tại Màn 1 (Hero)
    this.sharkPivot.position.set(coords.hero.x, coords.hero.y, coords.hero.z);
    this.sharkPivot.rotation.set(coords.hero.rotX, coords.hero.rotY, coords.hero.rotZ);
    this.sharkPivot.scale.setScalar(coords.hero.scale);

    // Xóa timeline cũ nếu đã tồn tại khi resize
    if (this.timeline) {
      this.timeline.kill();
      ScrollTrigger.getAll().forEach(trigger => trigger.kill());
    }

    if (this.reducedMotion) {
      // Nếu người dùng bật giảm chuyển động, chỉ fade nội dung nhẹ nhàng, không di chuyển 3D đột ngột
      this.initReducedMotionTimeline();
      return;
    }

    this.createCinematicTimeline();
    this.initNavigationInteractions();
  }

  createCinematicTimeline() {
    const coords = this.getCoordinates();

    // Timeline chính gắn với ScrollTrigger giữa 2 màn
    this.timeline = gsap.timeline({
      scrollTrigger: {
        trigger: '#hero',
        start: 'top top',
        endTrigger: '#intro',
        end: 'bottom bottom',
        scrub: 1.2, // Scrub mượt mà 2 chiều
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          // Cập nhật trạng thái active của menu
          this.updateActiveNav(self.progress);
        }
      }
    });

    // 1. Chuyển động của cá mập 3D qua sharkPivot
    this.timeline.to(this.sharkPivot.position, {
      x: coords.intro.x,
      y: coords.intro.y,
      z: coords.intro.z,
      ease: 'power1.inOut'
    }, 0);

    this.timeline.to(this.sharkPivot.rotation, {
      x: coords.intro.rotX,
      y: coords.intro.rotY,
      z: coords.intro.rotZ,
      ease: 'power1.inOut'
    }, 0);

    this.timeline.to(this.sharkPivot.scale, {
      x: coords.intro.scale,
      y: coords.intro.scale,
      z: coords.intro.scale,
      ease: 'power1.inOut'
    }, 0);

    // 2. Chuyển tiếp giao diện Màn 1 (Fade out nhẹ khi cuộn khỏi tầm mắt)
    this.timeline.to('.hero-content', {
      opacity: 0,
      y: -60,
      filter: 'blur(6px)',
      ease: 'power1.in',
      duration: 0.4
    }, 0);

    // 3. Chuyển tiếp giao diện Màn 2 (Fade in từ dưới lên với độ mờ sắc nét dần)
    gsap.set('.intro-content', { opacity: 0, y: 70, filter: 'blur(8px)' });
    this.timeline.to('.intro-content', {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      ease: 'power1.out',
      duration: 0.6
    }, 0.35);

    // 4. Hiệu ứng staggered cho các thẻ thông số stat-card
    gsap.set('.stat-card', { opacity: 0, y: 25 });
    this.timeline.to('.stat-card', {
      opacity: 1,
      y: 0,
      stagger: 0.08,
      ease: 'power2.out',
      duration: 0.45
    }, 0.55);
  }

  initReducedMotionTimeline() {
    gsap.set('.hero-content', { opacity: 1, y: 0 });
    gsap.set('.intro-content', { opacity: 1, y: 0 });
    gsap.set('.stat-card', { opacity: 1, y: 0 });
  }

  // Cập nhật link điều hướng active dựa theo tiến độ cuộn
  updateActiveNav(progress) {
    const navHero = document.querySelector('.nav-link[data-target="hero"]');
    const navIntro = document.querySelector('.nav-link[data-target="intro"]');
    if (!navHero || !navIntro) return;

    if (progress < 0.5) {
      navHero.classList.add('active');
      navIntro.classList.remove('active');
    } else {
      navIntro.classList.add('active');
      navHero.classList.remove('active');
    }
  }

  // Kích hoạt tương tác cho các nút bấm
  initNavigationInteractions() {
    const btnExplore = document.getElementById('btn-explore');
    const btnBackToTop = document.getElementById('btn-back-to-top');
    const navLinks = document.querySelectorAll('.nav-link');

    if (btnExplore) {
      btnExplore.addEventListener('click', (e) => {
        e.preventDefault();
        const introSection = document.getElementById('intro');
        if (introSection) {
          introSection.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }

    if (btnBackToTop) {
      btnBackToTop.addEventListener('click', (e) => {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('data-target');
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  }

  // Cập nhật khi thay đổi kích thước cửa sổ
  handleResize() {
    const coords = this.getCoordinates();
    if (this.timeline) {
      this.init();
      ScrollTrigger.refresh();
    }
  }
}
