# MXH Live Studio — TikTok × Xiaozhi

Dashboard điều khiển LIVE tiếng Việt, giao diện dark glassmorphism và bố cục responsive. **Dự án frontend tĩnh**, triển khai được trên GitHub Pages. Mã nguồn hiện có **không bao gồm một máy chủ TikTok LIVE/Xiaozhi**; trang sẽ không tự lấy bình luận hoặc tạo âm thanh AI nếu chưa cấu hình backend hợp lệ.

## Tính năng

- Kết nối backend qua WebSocket điều khiển riêng; chỉ nhận **WSS** trên trang HTTPS.
- Cấu hình TikTok username, Xiaozhi WebSocket URL, cooldown phản hồi, bộ lọc bình luận, chào thành viên và cooldown chào.
- Năm KPI: bình luận, lượt gửi Xiaozhi, đang xem, người tham gia, uptime.
- Theo dõi bình luận, sự kiện tham gia và console; xuất console ra tệp TXT có ẩn URL/token cơ bản.
- Sân khấu mô phỏng với hình nền động, 4 preset gradient, ảnh tải cục bộ hoặc URL HTTPS.
- **Demo dữ liệu giả lập** để kiểm tra UI, luôn hiển thị nhãn DEMO.
- Tự thử kết nối lại backend tối đa 3 lần khi WebSocket bị ngắt.
- Không dùng framework, không yêu cầu build Node.js để chạy website.

## Chạy giao diện

Mở file index.html bằng trình duyệt hoặc phục vụ bằng HTTP:

~~~bash
python -m http.server 8080
~~~

Sau đó truy cập http://localhost:8080.

## Đưa lên GitHub Pages

Vào repository **Settings → Pages → Build and deployment → Deploy from a branch**. Chọn nhánh main, thư mục / (root) rồi lưu. Khi GitHub Pages triển khai xong, địa chỉ dự kiến:

**https://xulytiengviet.github.io/MXH/**

> GitHub Pages chỉ host HTML/CSS/JS. Cần chạy backend WebSocket riêng trên một máy chủ có HTTPS/WSS (Render, Cloudflare Workers tương thích, VPS...). GitHub Pages không hỗ trợ WebSocket server.

## Kết nối bridge thật

1. Trên [xiaozhi.me](https://xiaozhi.me/), cấu hình Agent và lấy đúng URL WebSocket/MCP do dịch vụ cung cấp.
2. Triển khai backend hỗ trợ WebSocket control endpoint, ví dụ wss://your-bridge.onrender.com/ws/control.
3. Trong Dashboard, nhập URL **Backend Control** và bấm nút ↗ để kết nối.
4. Nhập **TikTok username** và **Xiaozhi WebSocket URL**.
5. Khởi động livestream TikTok của tài khoản tương ứng, nhấn **Bắt đầu Live**. Chỉ khi backend phát status: running giao diện mới báo đang LIVE.

Theo tài liệu dịch vụ tham khảo của người dùng, quyền sử dụng một số bridge có thể cần tài khoản VIP tại [MCP Endpoint](https://home.ledienbien.edu.vn/mcp.html). MXH không tự xác minh quyền VIP.

### WebSocket JSON API (tương thích mẫu DB-ROBOT)

Lệnh giao diện gửi tới backend:

~~~json
{
  "action": "start",
  "tiktok_username": "ten_tai_khoan",
  "xiaozhi_address": "wss://YOUR-XIAOZHI-URL",
  "token": "",
  "cooldown": "5",
  "filter_keyword": "",
  "greet_newcomers": true,
  "join_cooldown": "4"
}
~~~

Lệnh dừng:

~~~json
{"action": "stop"}
~~~

Backend gửi các sự kiện:

~~~json
{"event": "status", "status": "connecting_xiaozhi"}
{"event": "status", "status": "connecting_tiktok"}
{"event": "status", "status": "running"}
{"event": "viewer", "count": 120}
{"event": "comment", "user": "khach_a", "message": "Xin chào AI!"}
{"event": "join", "user": "khach_b"}
{"event": "log", "level": "info", "message": "Gửi → Xiaozhi"}
{"event": "status", "status": "stopped"}
~~~

Các trạng thái: connecting_xiaozhi, connecting_tiktok, running, stopped, disconnected, error. Bản dashboard hỗ trợ thêm sự kiện sent để đếm lượt gửi; nếu dùng sent thì **không** đồng thời gửi log legacy Gửi → cho cùng một yêu cầu, tránh đếm hai lần.

## Lưu ý bảo mật / kỹ thuật

- Xiaozhi address **có thể là credential**. Chỉ gửi tới backend do bạn quản lý và tin cậy; backend phải xác thực và bảo vệ URL/token, không ghi thông tin này ra log.
- Dashboard không lưu URL Xiaozhi hoặc URL backend vào localStorage, cookies hay tệp. Khi tải lại trang, cần nhập lại cấu hình. Ảnh tải từ máy dùng blob URL cục bộ, được thu hồi khi đổi hoặc đóng trang.
- Nếu backend bảo vệ bằng token, cần thiết kế đăng nhập/session hợp lệ (ví dụ cookie HttpOnly, Secure, SameSite và kiểm soát Origin cho WebSocket); không nên nhúng secret vào mã nguồn frontend công khai.
- Dữ liệu do backend gửi được đưa vào DOM bằng textContent, tránh HTML injection từ bình luận TikTok.
- Một số kết nối không chính thức tới TikTok LIVE có thể thay đổi hoặc vi phạm quy định nền tảng nếu sử dụng không được phép. Backend phải tự quản lý reconnect, giới hạn tốc độ, chống tràn hàng đợi và xác minh quyền truy cập.
- Chatbot AI voice cần luồng xử lý audio/MCP tương ứng ở backend. Dashboard này là giao diện giám sát và điều khiển, không tự tổng hợp tiếng nói trong trình duyệt.
- Các giá trị viewer và sent là do backend báo cáo; nếu backend không gửi, chúng giữ nguyên hoặc chỉ dùng logic tương thích legacy. Không nên dùng để xác nhận doanh thu hay số liệu chính thức.

## Cấu trúc

~~~text
MXH/
├── index.html    # Layout trang Dashboard
├── styles.css    # Theme và responsive
├── app.js        # WebSocket control, UI state, demo, event feed
├── favicon.svg   # Logo
└── README.md
~~~

Phát triển giao diện: Long Ngo.