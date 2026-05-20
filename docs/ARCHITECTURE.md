# Architecture

Tài liệu này ghi lại phần logic kỹ thuật của Facebook Post Capture. README chính chỉ giữ nội dung giới thiệu, cài đặt và cách dùng.

## Tổng quan luồng capture

1. Người dùng right-click trong bài viết hoặc modal Facebook.
2. `content.js` lưu lại toạ độ click gần nhất.
3. Context menu hoặc popup gửi yêu cầu capture tới `background.js`.
4. `background.js` đảm bảo content script đã sẵn sàng bằng message `PING_FACEBOOK_CAPTURE`.
5. `content.js` tìm target bài viết/modal dựa trên vị trí click và marker ổn định.
6. Extension tạo clone của target, scale clone vừa viewport, rồi chụp một lần bằng `chrome.tabs.captureVisibleTab()`.
7. `background.js` crop ảnh đúng vùng clone.
8. Kết quả được copy vào clipboard hoặc hiển thị modal preview tuỳ setting.

## Vì sao dùng fit-clone?

`chrome.tabs.captureVisibleTab()` chỉ chụp phần đang nhìn thấy trên viewport. Nếu dùng scroll-stitch để chụp từng lát trên Facebook, ảnh dễ bị lặp thanh header/sticky UI hoặc bị giới hạn quota capture.

Cách `fit-clone` tránh vấn đề đó:

1. Clone riêng post/modal cần chụp.
2. Đặt clone lên overlay trắng cố định.
3. Scale clone để toàn bộ target nằm gọn trong viewport.
4. Capture một lần.
5. Crop đúng vùng clone theo device pixel ratio.

Extension không upscale ảnh về kích thước target gốc, mà giữ theo số pixel thực tế đã capture để hạn chế mờ ảnh.

## Target detection

Extension tránh phụ thuộc vào class obfuscated của Facebook. Các marker đang dùng:

- `[role="dialog"]`
- `[aria-label^="Hành động đối với bài viết này"]`
- `[aria-label^="Actions for this post"]`
- `[data-ad-rendering-role="story_message"]`
- `[data-ad-rendering-role="profile_name"]`
- `[data-ad-rendering-role="comment_button"]`
- `[data-ad-rendering-role="like_button"]`
- `[data-ad-rendering-role="share_button"]`

Logic chính:

- Nếu click trong `[role="dialog"]`, ưu tiên tìm post container bên trong dialog.
- Nếu không có dialog, tìm post container gần vị trí click nhất trên feed.
- Container hợp lệ cần có action button và đủ marker như message/profile/like/comment/share.

## Privacy masking

Mask chỉ áp dụng trên clone, không sửa DOM gốc của Facebook.

Có 2 setting độc lập:

- `blurOwnerName`: che tên người đăng.
- `blurGroupName`: che tên group.

Phân loại name candidate:

- Post cá nhân: `[data-ad-rendering-role="profile_name"]` không chứa group link được xem là owner.
- Post group:
  - Tên group thường nằm trong `[data-ad-rendering-role="profile_name"]` với link `/groups/...` không chứa `/user/`.
  - Tên chủ post trong group thường là link `/groups/.../user/...`.

Để tránh che nhầm tên commenter, owner link trong group chỉ được lấy ở phần header trước `[data-ad-rendering-role="story_message"]`.

## Output behavior

Setting `showCaptureMenu` quyết định hành vi sau capture:

- `false`: copy ảnh PNG vào clipboard và hiện toast `Đã sao chép hình ảnh`.
- `true`: hiện modal preview trong trang với 3 nút:
  - `Copy`
  - `Download`
  - `Đóng`

Nút `Copy` dùng Clipboard API để ghi ảnh PNG vào clipboard. Nút `Download` gửi data URL về background service worker để gọi `chrome.downloads.download()`.

## File responsibilities

- `manifest.json`: cấu hình Manifest V3, permissions, content script, popup và service worker.
- `background.js`: xử lý context menu, capture visible tab, crop ảnh, download và điều phối message.
- `content.js`: tìm target Facebook, tạo fit-clone, mask tên, copy clipboard, toast và modal preview.
- `popup.html`: UI popup.
- `popup.css`: style popup.
- `popup.js`: lưu setting và gửi action từ popup.
- `icon/icon48.png`: icon extension.

## Known limitations

- Facebook thay đổi DOM thường xuyên, nên marker có thể cần cập nhật theo thời gian.
- Clipboard image write cần trang đang focus và browser hỗ trợ `ClipboardItem`.
- Fit-clone ưu tiên ảnh sạch, không bị sticky header, nhưng nếu target quá dài thì ảnh sẽ được scale nhỏ để vừa viewport.
