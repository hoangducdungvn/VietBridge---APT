# SLIDE STYLE GUIDE — Template "Blue Tech Educational"

> File này là **nguồn chân lý duy nhất** về style thiết kế slide.
> Agent PHẢI đọc và tuân thủ file này trước khi viết bất kỳ đoạn HTML/CSS nào cho slide.
> Không tự ý thêm màu, font, hoặc decoration ngoài những gì được liệt kê dưới đây.

---

## 1. Tổng quan phong cách

- **Cảm giác:** hiện đại, tối giản, thân thiện, giáo dục, tech/AI nhưng dễ tiếp cận.
- **Canvas:** khổ 16:9, kích thước chuẩn `1280x720px` mỗi slide.
- **Nguyên tắc:** ít màu, nhiều khoảng trắng, layout rõ ràng, không nhồi nhét chữ.

---

## 2. Bảng màu (BẮT BUỘC — không thêm màu ngoài danh sách này)

| Vai trò | Tên biến CSS | Hex |
|---|---|---|
| Xanh dương chính (primary) | `--color-primary` | `#527AF0` |
| Xanh nền nhạt (section bg) | `--color-bg-light` | `#98B8F8` |
| Xanh card / shape | `--color-card` | `#C8DAF8` |
| Xanh rất nhạt (pale bg) | `--color-pale` | `#E8F0FF` |
| Trắng nền (off-white) | `--color-white` | `#F8F8F8` |
| Đen (chữ / viền) | `--color-black` | `#000000` |

```css
:root {
  --color-primary: #527AF0;
  --color-bg-light: #98B8F8;
  --color-card: #C8DAF8;
  --color-pale: #E8F0FF;
  --color-white: #F8F8F8;
  --color-black: #000000;
}
```

---

## 3. Font chữ

- **Tiêu đề (heading):** condensed sans-serif, rất đậm, **IN HOA toàn bộ**.
  - Dùng Google Font: `Oswald` (weight 700) — fallback `Anton`, `Bebas Neue`.
  - Kích thước: gấp **2.5–4 lần** body text.
- **Nội dung (body):** sans-serif tròn, dễ đọc, weight regular/medium.
  - Dùng Google Font: `Poppins` (weight 400–600) — fallback `Montserrat`, `Nunito Sans`.
  - Line-height rộng (1.5–1.7).
- **Card heading:** lớn hơn card body khoảng 1.3–1.6 lần.

```html
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
```

---

## 4. Ba kiểu layout chuẩn

### Kiểu 1 — Cover (trang bìa)
- Nền ngoài: xanh dương đậm (`--color-primary`).
- Khung trắng lớn bo góc (radius 24–32px), viền đen mảnh (1.5–2px), nằm giữa slide.
- Bên trong khung: trái là hình minh họa (~45–50% chiều ngang), phải là title + subtitle căn trái, căn giữa theo chiều dọc.
- Subtitle nhỏ hơn nhiều, màu `--color-primary`.

### Kiểu 2 — Section / Explanation split (50/50)
- Chia đôi slide theo chiều dọc:
  - Trái: nền `--color-bg-light`, chứa title lớn + đoạn mô tả (có thể bold từ khóa).
  - Phải: nền trắng, chứa hình minh họa lớn, căn giữa.
- Dùng cho slide mở section hoặc giải thích khái niệm.

### Kiểu 3 — Card / List
- Nền trắng hoặc `--color-pale`.
- Title lớn, in hoa, căn giữa phía trên.
- Nội dung trình bày bằng:
  - **Grid card 4 cột** (hoặc 2 cột) — nền `--color-card`, viền đen mảnh, bo góc lớn (16–24px), text căn giữa, heading bold + body ngắn.
  - **Pill card** (2 cột danh sách ngắn) cho ví dụ/từ khóa ngắn.
  - **Circle number badge** (nền trắng, viền đen) cho mục lục / bảng nội dung.
- **TUYỆT ĐỐI KHÔNG dùng bullet point (`<ul><li>`) truyền thống.**

---

## 5. Hình minh họa / Icon

- Phong cách: **flat vector 2D**, line-art viền đen dày (stroke ~2-3px).
- Chủ đề: robot, người, laptop, điện thoại, gear, chat bubble, microphone, wave line.
- Màu chỉ dùng trong palette xanh-trắng-đen ở mục 2.
- Đặt trên **blob nền hữu cơ** (organic blob shape) màu xanh nhạt để tạo chiều sâu.
- Illustration chiếm 35–50% diện tích slide.
- **KHÔNG dùng:** ảnh thật/stock photo, gradient phức tạp, shadow nặng, 3D.

Nguồn icon gợi ý: SVG inline tự vẽ đơn giản, hoặc Lucide/Font Awesome (line style) tô lại màu theo palette.

---

## 6. Yếu tố trang trí (dùng ít nhưng nhất quán)

Được phép:
- Bo góc lớn (16–32px tùy element)
- Viền đen mảnh (1.5–2px)
- Blob nền hữu cơ (organic shape)
- Đường cong / dashed line
- Icon nhỏ trang trí (gear, sparkle, signal, wave)
- Circle number badge, pill-shaped box

Không được dùng:
- Ảnh stock
- Gradient mạnh
- Biểu đồ phức tạp (chart 3D, pie phức tạp...)
- Shadow/glow hiện đại (box-shadow đậm, neon glow)
- Layout dày đặc chữ, thiếu khoảng trắng

---

## 7. Quy tắc trình bày nội dung

- Không dùng bullet truyền thống (`<li>` với dấu chấm) — thay bằng:
  - Numbered circle badge (mục lục)
  - Pill card (danh sách ngắn)
  - Grid card 4 cột (nhóm ý chính)
- Bold (đen, weight 600–700) các từ khóa quan trọng trong đoạn văn để nhấn mạnh, thay vì highlight màu.
- Mỗi slide chỉ nên có 1 ý chính / 1 khối nội dung rõ ràng — tránh nhồi nhét.

---

## 8. Yêu cầu kỹ thuật khi code

- Xuất 1 file HTML duy nhất (hoặc theo cấu trúc project được yêu cầu), CSS thuần (Flexbox/Grid), không dùng framework ngoài trừ khi được yêu cầu.
- Mỗi slide là 1 `<section class="slide slide--<kiểu>">` cố định `1280x720px`.
- Dùng CSS variables (`:root`) cho toàn bộ màu ở mục 2 — không hardcode hex rải rác.
- Comment rõ ràng phân tách từng slide trong code.
- Giữ đúng tỷ lệ 16:9 khi export/preview.

---

## 9. Checklist trước khi hoàn thành mỗi slide

- [ ] Chỉ dùng 6 màu trong bảng màu mục 2
- [ ] Title dùng Oswald/Anton uppercase, body dùng Poppins
- [ ] Đúng 1 trong 3 layout kiểu (Cover / Split / Card)
- [ ] Không có bullet point truyền thống
- [ ] Card/box có bo góc + viền đen mảnh
- [ ] Illustration là flat vector, viền đen, không ảnh thật
- [ ] Khoảng trắng đủ rộng, không rối mắt