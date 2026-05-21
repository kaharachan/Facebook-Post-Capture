const statusEl = document.getElementById('status');
const blurOwnerNameEl = document.getElementById('blurOwnerName');
const blurGroupNameEl = document.getElementById('blurGroupName');
const showCaptureMenuEl = document.getElementById('showCaptureMenu');
const expandSeeMoreEl = document.getElementById('expandSeeMore');
const attachPostQrEl = document.getElementById('attachPostQr');

loadSettings();

blurOwnerNameEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ blurOwnerName: blurOwnerNameEl.checked });
  setStatus(blurOwnerNameEl.checked ? 'Đã bật làm mờ tên chủ post.' : 'Đã tắt làm mờ tên chủ post.');
});

blurGroupNameEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ blurGroupName: blurGroupNameEl.checked });
  setStatus(blurGroupNameEl.checked ? 'Đã bật làm mờ tên group.' : 'Đã tắt làm mờ tên group.');
});

showCaptureMenuEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ showCaptureMenu: showCaptureMenuEl.checked });
  setStatus(showCaptureMenuEl.checked ? 'Đã bật menu sau capture.' : 'Đã tắt menu sau capture. Capture sẽ copy thẳng vào clipboard.');
});

expandSeeMoreEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ expandSeeMore: expandSeeMoreEl.checked });
  setStatus(expandSeeMoreEl.checked ? 'Đã bật tự mở “xem thêm”.' : 'Đã tắt tự mở “xem thêm”.');
});

attachPostQrEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ attachPostQr: attachPostQrEl.checked });
  setStatus(attachPostQrEl.checked ? 'Đã bật gắn QR link bài viết.' : 'Đã tắt gắn QR link bài viết.');
});

document.getElementById('debug').addEventListener('click', async () => {
  setStatus('Đang tìm target...');
  const result = await chrome.runtime.sendMessage({ type: 'DEBUG_FROM_POPUP' });
  setStatus(formatDebugResult(result));
});

document.getElementById('capture').addEventListener('click', async () => {
  setStatus('Đang capture...');
  const result = await chrome.runtime.sendMessage({ type: 'CAPTURE_FROM_POPUP' });
  setStatus(JSON.stringify(result, null, 2));
});

function setStatus(text) {
  statusEl.textContent = text;
}

function formatDebugResult(result) {
  if (!result || !Object.prototype.hasOwnProperty.call(result, 'postUrl')) {
    return JSON.stringify(result, null, 2);
  }

  const { postUrl, postUrlCase, ...displayResult } = result;
  const label = postUrl ? `Post Url ${postUrlCase || getPostUrlCase(postUrl)}` : 'Post Url';
  return `${JSON.stringify(displayResult, null, 2)}\n${label}: ${postUrl || 'Không tìm thấy link bài viết trong DOM hiện tại.'}`;
}

function getPostUrlCase(postUrl) {
  if (/\/watch\//i.test(postUrl) && /[?&]v=/.test(postUrl)) return 'watch';
  if (/\/share\/p\//i.test(postUrl)) return 'share-p';
  if (/\/share\/v\//i.test(postUrl)) return 'share-v';
  if (/\/groups\/[^/]+\/posts\//i.test(postUrl)) return 'group-post';
  if (/\/posts\/pfbid/i.test(postUrl)) return 'pfbid-post';
  if (/\/posts\//i.test(postUrl)) return 'post';
  if (/\/permalink\.php/i.test(postUrl)) return 'permalink';
  if (/story_fbid=/i.test(postUrl)) return 'story-fbid';
  if (/fbid=/i.test(postUrl)) return 'fbid';
  if (/multi_permalinks=/i.test(postUrl)) return 'multi-permalinks';
  return 'unknown';
}

async function loadSettings() {
  const settings = await chrome.storage.local.get({
    blurOwnerName: false,
    blurGroupName: false,
    showCaptureMenu: false,
    expandSeeMore: false,
    attachPostQr: false
  });
  blurOwnerNameEl.checked = Boolean(settings.blurOwnerName);
  blurGroupNameEl.checked = Boolean(settings.blurGroupName);
  showCaptureMenuEl.checked = Boolean(settings.showCaptureMenu);
  expandSeeMoreEl.checked = Boolean(settings.expandSeeMore);
  attachPostQrEl.checked = Boolean(settings.attachPostQr);
}
