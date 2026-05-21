# Architecture

Tài liệu này mô tả kiến trúc hiện tại của Facebook Post Capture: extension Manifest V3 để capture riêng bài viết hoặc modal bài viết Facebook, hỗ trợ scroll-stitching sắc nét, privacy masking, tự mở `Xem thêm`, lấy link bài viết và gắn QR.

## Thành phần chính

| File | Vai trò |
| --- | --- |
| `manifest.json` | Khai báo Manifest V3, permissions, host permissions, popup, service worker và content script. |
| `background.js` | Điều phối context menu/popup, inject content script khi cần, chụp viewport, stitch ảnh, copy/download. |
| `content.js` | Nhận diện target Facebook, chuẩn bị phiên capture, scroll target, mask tên, mở `Xem thêm`, tìm post URL, gắn QR, preview modal/toast. |
| `popup.html` / `popup.css` / `popup.js` | UI popup, lưu setting bằng `chrome.storage.local`, gửi lệnh debug/capture. |
| `docs/images/*` | Ảnh minh hoạ README. |

## Luồng capture tổng quan

1. Người dùng right-click vào post/modal hoặc bấm nút trong popup.
2. `content.js` lưu toạ độ right-click gần nhất để xác định target chính xác hơn.
3. `background.js` nhận lệnh `CAPTURE_FROM_CONTEXT_MENU` hoặc `CAPTURE_FROM_POPUP`.
4. `background.js` gọi `ensureContentScript()` bằng message `PING_FACEBOOK_CAPTURE`; nếu tab chưa có content script thì inject `content.js`.
5. `background.js` đọc setting hiện tại:
   - `blurOwnerName`
   - `blurGroupName`
   - `showCaptureMenu`
   - `expandSeeMore`
   - `attachPostQr`
6. `background.js` gửi `PREPARE_FULL_FACEBOOK_CAPTURE` sang `content.js`.
7. `content.js` tìm target post/modal, mở `Xem thêm` nếu bật, lấy post URL nếu cần QR, tạo capture session và trả về kích thước output.
8. `background.js` chụp nhiều viewport bằng `chrome.tabs.captureVisibleTab()` và stitch lại bằng `OffscreenCanvas`.
9. `background.js` gửi `FINISH_FULL_FACEBOOK_CAPTURE` để `content.js` restore DOM/scroll/mask/QR.
10. Output được copy thẳng vào clipboard hoặc hiện preview modal tuỳ `showCaptureMenu`.

## Target detection

Extension không phụ thuộc vào class obfuscated của Facebook. Thay vào đó, `content.js` dùng các marker ổn định hơn:

- `[role="dialog"]`
- `[aria-label^="Hành động đối với bài viết này"]`
- `[aria-label^="Actions for this post"]`
- `[data-ad-rendering-role="story_message"]`
- `[data-ad-rendering-role="profile_name"]`
- `[data-ad-rendering-role="comment_button"]`
- `[data-ad-rendering-role="like_button"]`
- `[data-ad-rendering-role="share_button"]`

Logic chọn target:

- Nếu có dialog đang hiển thị, ưu tiên post container trong dialog đó.
- Nếu right-click nằm trong dialog, tìm post container gần điểm click.
- Nếu không có dialog, tìm post container gần marker/action button trên feed.
- Một container hợp lệ thường cần action button và đủ marker như message/profile/like/comment/share.
- `Highlight target` flash target và trả về debug info để kiểm tra vùng đang được nhận diện.

## Scroll-stitching capture

`chrome.tabs.captureVisibleTab()` chỉ chụp được viewport hiện tại, nên extension dùng pipeline scroll-stitching:

1. `content.js` chuẩn hoá vị trí scroll để phần đầu target nằm gần đầu viewport.
2. Capture session lưu:
   - DOM element target
   - scroll parent nếu target nằm trong container scroll riêng
   - toạ độ document/parent của target
   - kích thước output theo CSS pixel
   - `devicePixelRatio`
   - danh sách element bị mask/ẩn/QR để restore
3. `background.js` tính danh sách offset cần chụp theo chiều cao target.
4. Với mỗi offset, `background.js` gửi `SCROLL_FULL_FACEBOOK_CAPTURE`.
5. `content.js` scroll window hoặc scroll parent tới offset đó và trả về crop rect viewport.
6. `background.js` chụp viewport, decode bitmap, crop đúng vùng target rồi vẽ vào `OffscreenCanvas` ở native scale.
7. Ảnh cuối cùng được xuất PNG data URL.

Cách này giữ độ sắc nét tốt hơn fit-clone vì ảnh được stitch theo pixel thật của màn hình thay vì scale toàn bộ post vào một viewport nhỏ.

## Chuẩn bị DOM trước capture

Trong `PREPARE_FULL_FACEBOOK_CAPTURE`, `content.js` có thể thực hiện các bước sau:

- Tự click `Xem thêm` / `See more` trong target nếu `expandSeeMore` bật.
- Tìm link bài viết nếu `attachPostQr` bật.
- Gắn QR vào header post bằng ảnh QuickChart.
- Tạm mask tên chủ post hoặc tên group.
- Ẩn các floating element/tooltip có thể dính vào ảnh capture.
- Re-measure target sau khi gắn QR để output đủ chiều cao.

Tất cả thay đổi DOM đều được lưu record và restore trong `FINISH_FULL_FACEBOOK_CAPTURE`.

## Post URL detection

Post URL được dùng cho QR, preview modal và debug `Post Url <case>`. Hàm chính là `findPostLinkResult(root)` trong `content.js`.

Thứ tự kiểm tra hiện tại:

1. `current-*`: normalize URL hiện tại của tab.
2. `direct-*`: quét các link có sẵn trong post container, ancestor scope và active dialog.
3. `hover-*`: synthetic hover các link timestamp khả nghi để Facebook hydrate href canonical, sau đó quét lại.

Các pattern được ưu tiên:

- `/posts/pfbid...`
- `/posts/...`
- `/permalink.php`
- `story_fbid`
- group canonical derive từ:
  - `multi_permalinks`
  - `set=gm.<postId>` + `idorvanity=<groupId>`
  - group id trong URL ancestor
- `/share/p/...`
- `/share/v/...`
- `/watch/?v=...`
- `fbid` không thuộc photo URL

Debug popup hiển thị case thật, ví dụ:

- `Post Url current-watch`
- `Post Url direct-group-derived`
- `Post Url hover-pfbid-post`

Sau synthetic hover, extension dispatch unhover events và chờ tooltip đóng để hạn chế tooltip bị capture vào ảnh.

## QR link bài viết

Khi `attachPostQr` bật:

1. `content.js` gọi `findPostLink()`.
2. Nếu có URL, `attachQrToPostHeader()` tìm header phù hợp của post.
3. QR được tạo từ QuickChart:
   - `https://quickchart.io/qr?text=<postUrl>&margin=0&size=120`
4. QR được gắn absolute vào header, có viền đỏ `#ff2d55`.
5. Extension đợi ảnh QR load hoặc timeout trước khi capture.
6. Sau capture, QR được remove và style header được restore.

## Privacy masking

Có 2 setting độc lập:

- `blurOwnerName`: che tên người đăng.
- `blurGroupName`: che tên group.

Phân loại candidate:

- Post cá nhân: `[data-ad-rendering-role="profile_name"]` không chứa group link được xem là owner.
- Post group:
  - Group name thường là link `/groups/...` không chứa `/user/`.
  - Owner trong group thường là link `/groups/.../user/...`.

Để tránh che nhầm commenter, owner/group header được ưu tiên lấy trước vùng `[data-ad-rendering-role="story_message"]`.

Mask được áp dụng trực tiếp vào target trong phiên capture và được restore sau khi capture kết thúc.

## Output behavior

Setting `showCaptureMenu` quyết định output:

- `false`: copy PNG vào clipboard và hiện toast `Đã sao chép hình ảnh`.
- `true`: hiện preview modal trong trang với:
  - ảnh vừa capture
  - nút `Copy`
  - nút `Download`
  - nút `Đóng`
  - link bài viết dạng muted/italic nếu detect được

Nút `Copy` dùng Clipboard API. Nút `Download` gửi data URL về service worker để gọi `chrome.downloads.download()`.

## Popup settings

Các setting được lưu bằng `chrome.storage.local`:

| Setting key | Tác dụng |
| --- | --- |
| `blurOwnerName` | Mask tên chủ post. |
| `blurGroupName` | Mask tên group. |
| `showCaptureMenu` | Hiện preview modal thay vì copy thẳng. |
| `expandSeeMore` | Tự mở text rút gọn. |
| `attachPostQr` | Tìm link bài viết và gắn QR vào header. |

## Message contracts

Các message chính giữa `background.js` và `content.js`:

| Message | Hướng | Mục đích |
| --- | --- | --- |
| `PING_FACEBOOK_CAPTURE` | background → content | Kiểm tra content script đã sẵn sàng. |
| `DEBUG_FACEBOOK_CAPTURE_TARGET` | background/popup → content | Highlight target và trả debug info/post URL. |
| `PREPARE_FULL_FACEBOOK_CAPTURE` | background → content | Chuẩn bị target và trả capture session. |
| `SCROLL_FULL_FACEBOOK_CAPTURE` | background → content | Scroll target tới offset và trả crop rect. |
| `FINISH_FULL_FACEBOOK_CAPTURE` | background → content | Restore DOM và scroll sau capture. |
| `SHOW_CAPTURE_RESULT_MODAL` | background → content | Hiện preview modal với image/post URL. |
| `COPY_CAPTURE_TO_CLIPBOARD` | background → content | Copy data URL PNG vào clipboard trong page context. |

## Known limitations

- Facebook thay đổi DOM thường xuyên, nên marker có thể cần cập nhật theo thời gian.
- Clipboard image write cần browser hỗ trợ `ClipboardItem` và tab/page còn tương tác được.
- Capture post rất dài cần nhiều lần `captureVisibleTab()`, nên thời gian có thể tăng.
- URL canonical phụ thuộc vào href Facebook expose; một số post riêng tư/layout mới có thể không detect được.
- QR dùng dịch vụ QuickChart nên cần mạng để QR load đầy đủ.
