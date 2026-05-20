const statusEl = document.getElementById('status');
const blurOwnerNameEl = document.getElementById('blurOwnerName');
const blurGroupNameEl = document.getElementById('blurGroupName');
const showCaptureMenuEl = document.getElementById('showCaptureMenu');

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

document.getElementById('debug').addEventListener('click', async () => {
  setStatus('Đang tìm target...');
  const result = await chrome.runtime.sendMessage({ type: 'DEBUG_FROM_POPUP' });
  setStatus(JSON.stringify(result, null, 2));
});

document.getElementById('capture').addEventListener('click', async () => {
  setStatus('Đang capture...');
  const result = await chrome.runtime.sendMessage({ type: 'CAPTURE_FROM_POPUP' });
  setStatus(JSON.stringify(result, null, 2));
});

function setStatus(text) {
  statusEl.textContent = text;
}

async function loadSettings() {
  const settings = await chrome.storage.local.get({
    blurOwnerName: false,
    blurGroupName: false,
    showCaptureMenu: false
  });
  blurOwnerNameEl.checked = Boolean(settings.blurOwnerName);
  blurGroupNameEl.checked = Boolean(settings.blurGroupName);
  showCaptureMenuEl.checked = Boolean(settings.showCaptureMenu);
}
