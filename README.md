<p align="center">
  <img src="icon/icon48.png" width="72" height="72" alt="Facebook Post Capture icon">
</p>

<h1 align="center">Facebook Post Capture</h1>

<p align="center">
  Capture riêng bài viết hoặc modal bài viết Facebook, hỗ trợ làm mờ tên và copy ảnh nhanh vào clipboard.
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square">
  <img alt="Chrome" src="https://img.shields.io/badge/Chrome-supported-34A853?style=flat-square">
  <img alt="Edge" src="https://img.shields.io/badge/Edge-supported-0078D7?style=flat-square">
  <img alt="No build" src="https://img.shields.io/badge/build-not_required-111827?style=flat-square">
</p>

---

## Preview

<table>
  <tr>
    <td align="center">
      <strong>Extension popup</strong>
    </td>
    <td align="center">
      <strong>Capture preview modal</strong>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/images/popup.png" alt="Facebook Post Capture popup" width="360">
    </td>
    <td align="center" width="50%">
      <img src="docs/images/preview-modal.png" alt="Facebook Post Capture preview modal" width="520">
    </td>
  </tr>
</table>

Popup cho phép bật/tắt các tuỳ chọn privacy và output. Preview modal hiển thị ảnh vừa capture kèm thao tác `Copy`, `Download` hoặc `Đóng`.

## Features

- Capture đúng post hoặc post modal đang chọn trên Facebook.
- Không phụ thuộc vào class obfuscated của Facebook.
- Tự fit target vào viewport để tránh lỗi lặp sticky header khi scroll-capture.
- Copy ảnh PNG vào clipboard sau khi capture.
- Tuỳ chọn hiện modal preview với nút `Copy`, `Download`, `Đóng`.
- Tuỳ chọn che tên chủ post.
- Tuỳ chọn che tên group.
- Toast `Đã sao chép hình ảnh` sau khi copy thành công.
- Chạy trực tiếp bằng Manifest V3, không cần build step.

## Installation

### Chrome / Cốc Cốc / Edge

1. Clone hoặc tải project này về máy.
2. Mở trang quản lý extension:
   - Chrome/Cốc Cốc: `chrome://extensions`
   - Edge: `edge://extensions`
3. Bật `Developer mode`.
4. Chọn `Load unpacked`.
5. Chọn thư mục project.
6. Mở Facebook và bắt đầu sử dụng.

## Usage

### Capture bằng context menu

1. Mở Facebook.
2. Right-click vào bài viết hoặc modal bài viết cần capture.
3. Chọn `Capture Facebook post/modal`.
4. Nếu `Hiện menu sau capture` đang tắt, ảnh sẽ được copy thẳng vào clipboard.
5. Nếu `Hiện menu sau capture` đang bật, modal preview sẽ hiện ra để chọn `Copy` hoặc `Download`.

### Capture bằng popup

1. Click icon extension trên toolbar.
2. Tuỳ chỉnh các setting cần dùng.
3. Click `Capture target`.

### Debug target

Click `Highlight target` trong popup để kiểm tra extension đang nhận diện đúng bài viết/modal nào.

## Settings

| Setting | Mặc định | Mô tả |
| --- | --- | --- |
| `Làm mờ tên chủ post` | Off | Che tên người đăng bài, ví dụ người đăng trong post cá nhân hoặc post group. |
| `Làm mờ tên group` | Off | Che tên group trong post group. |
| `Hiện menu sau capture` | Off | Bật modal preview sau capture với nút `Copy` và `Download`. |


## Technical notes

Phần logic chi tiết:

- [Architecture](docs/ARCHITECTURE.md)

Tóm tắt nhanh:

- Extension dùng `chrome.tabs.captureVisibleTab()` để chụp viewport.
- Trước khi chụp, `content.js` clone riêng target bài viết/modal và scale vào viewport.
- `background.js` crop đúng vùng clone theo device pixel ratio.
- Mask tên chỉ áp dụng trên clone, không sửa DOM gốc của Facebook.

## Permissions

Extension sử dụng các quyền sau:

- `contextMenus`: thêm menu `Capture Facebook post/modal` khi right-click.
- `activeTab`, `tabs`, `scripting`: giao tiếp và inject content script khi cần.
- `downloads`: tải ảnh PNG khi người dùng chọn `Download`.
- `storage`: lưu setting popup.
- `clipboardWrite`: copy ảnh PNG vào clipboard.

Host permissions:

- `https://www.facebook.com/*`
- `https://web.facebook.com/*`

## Known limitations

- Facebook có thể thay đổi DOM, nên selector/marker có thể cần cập nhật theo thời gian.
- Copy ảnh vào clipboard cần browser hỗ trợ `ClipboardItem`.
- Target quá dài sẽ được scale nhỏ để nằm trong viewport trước khi capture.

## Disclaimer

Project này không liên kết, không được tài trợ và không được xác nhận bởi Meta/Facebook. Đây là công cụ cá nhân phục vụ capture nội dung người dùng đang xem trên trình duyệt.
