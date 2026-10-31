# OCEAN DEPTHS — 3D Cinematic Ocean Showcase

Dự án thử nghiệm website 3D tương tác theo cuộn cho bài cuối kì môn Thiết kế Web.

## 🌊 Tổng quan dự án
- **Tên dự án:** OCEAN DEPTHS
- **Chủ đề:** Khám phá cá mập và thế giới đại dương
- **Ngôn ngữ:** Tiếng Việt
- **Phong cách thị giác:** Đại dương điện ảnh sâu lắng (Cinematic Underwater Abyss):
  - Mặt nước gợn sóng phía trên với khúc xạ và ánh sáng mặt trời chiếu xuyên qua.
  - Vệt sáng khúc xạ chuyển động (Water Caustics) nhảy múa trên nền cát nhấp nhô và cụm đá ngầm.
  - Sắc màu đại dương chuyển dần từ xanh ngọc bích ven bờ sang xanh vực thẳm sâu lắng (`#02121e`).

---

## 🌊 Hiệu ứng sóng nước & Caustics (ThreeJS Caustics Pipeline)
- **Tái sử dụng giải thuật ThreeJS Caustics (Martin Renou):**
  - **Mô phỏng sóng nước (`WaterSimulation`):** Sử dụng hệ phương trình sóng chất lỏng với kỹ thuật ping-pong RenderTarget tính toán độ cao và vector pháp tuyến.
  - **Bản đồ môi trường (`EnvironmentMap`):** Quét độ sâu hình học đáy biển từ góc nhìn nguồn sáng trực giao (`lightCamera`).
  - **Khúc xạ & Tụ quang (`Caustics`):** Áp dụng định luật khúc xạ Snell (`eta = 0.7504`), dò tia khúc xạ tới đáy biển và tính tỷ lệ nén diện tích vi phân (`dFdx`/`dFdy`) với additive blending.
  - **Bảo toàn cá mập 100%:** Toàn bộ hệ thống cá mập (`sharkPivot`) được giữ hoàn toàn bên ngoài pass caustics (hệ skinned mesh animation không bị ảnh hưởng, giữ nguyên texture, material PBR và skeleton gốc).
  - **Chiếu xạ đáy biển (`Seabed Material`):** Nền cát vàng sáng dịu với vi gợn cát tự nhiên (`sand ripples`), hòa cùng vệt sáng caustics mềm mại và sương mù nước biển xanh ngọc có chiều sâu.
  - **Cụm đá ngầm:** Bố trí thấp ở hai bên rìa (`X = -4.2` và `X = +4.0`), chừa vùng trung tâm hoàn toàn thoáng cho cá mập tự do bơi lội và quay đầu.

---

## 🦈 Chuyển động bơi tự hành (Autonomous Swim Patrol)
- **Tự bơi qua lại mượt mà khi không cuộn:** Cá mập bơi chậm từ trái sang phải, tới gần rìa màn hình sẽ lượn một vòng cung rộng 180° quay đầu và bơi ngược lại.
- **Khí động học đại dương:** Mô hình luôn hướng mũi theo vector vận tốc thực tế (`+1.36 rad`), tự động nghiêng thân (*banking roll*) khi vào cua và uốn lượn độ cao nhẹ (*undulation dip*), tuyệt đối không lật hình bằng `scaleX` âm hay đổi hướng giật cục.
- **Kiến trúc phân cấp 3 tầng tách bạch (3-Tier Hierarchy):**
  - Cấp 1 (`sharkPivot`): Nhóm cha gắn với GSAP ScrollTrigger điều khiển tọa độ/xoay camera theo hành trình cuộn trang.
  - Cấp 2 (`sharkSwimGroup`): Nhóm con thực thi chuyển động tự bơi qua lại và lượn cua độc lập bằng delta time.
  - Cấp 3 (`sharkModel`): Lưới 3D chạy xương AnimationMixer cho hoạt ảnh vẫy đuôi tuần hoàn `Swimming`.
  -> Hai hệ sinh thái cuộn trang và bơi tự do hoàn toàn không xung đột hay ghi đè thuộc tính của nhau.

---

## 🚀 Cách mở dự án (Cực kỳ đơn giản)

### Cách 1: Mở trực tiếp (Khuyên dùng khi nộp bài hoặc chấm điểm nhanh)
Bạn chỉ cần **nhấp đúp chuột trực tiếp vào tệp `index.html`** trong thư mục dự án:
- Không cần cài đặt server hay gõ lệnh terminal.
- Không bị lỗi CORS do mô hình và thư viện đã được tối ưu nhúng sẵn.
- Chạy offline 100% mượt mà trên Chrome, Edge, Cốc Cốc, Firefox,...

### Cách 2: Chạy qua máy chủ phát triển (Vite Dev Server)
```bash
npm run dev
# Truy cập http://localhost:5173
```

### Cách 3: Đóng gói bản Production
```bash
npm run build
```

---

## 🛠️ Công nghệ sử dụng
- **Three.js (r128) & GLTFLoader:** Khởi tạo không gian 3D, camera perspective, ánh sáng đại dương, nền cát đáy biển, cụm đá ngầm và nạp mô hình cá mập nhị phân.
- **WebGL Caustics Pipeline (Martin Renou):** Simulation ping-pong RenderTarget, ray-marched caustics shader, projective texturing.
- **GSAP 3 + ScrollTrigger:** Điều khiển chuyển động cuộn 2 chiều mượt mà (`scrub`), gắn kết biến đổi của cụm điều khiển `sharkPivot` và hiệu ứng xuất hiện giao diện.
- **Vanilla JavaScript & CSS3:** Thiết kế phi framework tối ưu, responsive máy tính & điện thoại, hỗ trợ `prefers-reduced-motion`.

---

## 🦈 Bản quyền & Ghi công tài nguyên (Credits & Licenses)
1. **Mô hình 3D Cá Mập Trắng:**
   - *Animated Swimming Great White Shark Loop* của [LasquetiSpice (Sketchfab)](https://sketchfab.com/LasquetiSpice)
   - Giấy phép: [CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/)
2. **Hiệu ứng Sóng nước & Ánh sáng khúc xạ (Caustics):**
   - *ThreeJS Caustics* của [Martin Renou](https://github.com/martinRenou/threejs-caustics) (2020)
   - Giấy phép: BSD 3-Clause License
   - Bài viết kỹ thuật: [Real-time rendering of water caustics (Medium)](https://medium.com/@martinRenou/real-time-rendering-of-water-caustics-59cda1d74aa)
3. **Mô hình Đá Ngầm (Rocks):**
   - *Rocks Low Poly Starter Pack* của [Dreyx (Sketchfab)](https://sketchfab.com/3d-models/rocks-low-poly-starter-pack-2a362c908b1047539b1f4f5d78d30b4e)
   - Giấy phép: [CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- **Hoạt ảnh sử dụng:** `Swimming` (bơi nhẹ tuần hoàn liên tục).
