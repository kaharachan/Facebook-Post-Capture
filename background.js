const CONTEXT_MENU_ID = 'capture-facebook-post';
const CAPTURE_VISIBLE_TAB_DELAY_MS = 650;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Capture Facebook post/modal',
    contexts: ['page', 'image', 'video', 'link', 'selection'],
    documentUrlPatterns: ['https://www.facebook.com/*', 'https://web.facebook.com/*']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id || !tab.windowId) return;
  await captureFacebookTarget(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CAPTURE_FROM_POPUP') {
    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
      const tab = tabs[0];
      if (!tab?.id || !tab.windowId) {
        sendResponse({ ok: false, error: 'Không tìm thấy tab hiện tại.' });
        return;
      }

      const result = await captureFacebookTarget(tab).catch(error => ({
        ok: false,
        error: error?.message || String(error)
      }));
      sendResponse(result);
    });

    return true;
  }

  if (message?.type === 'DEBUG_FROM_POPUP') {
    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'Không tìm thấy tab hiện tại.' });
        return;
      }

      const injected = await ensureContentScript(tab);
      if (!injected.ok) {
        sendResponse(injected);
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type: 'DEBUG_FACEBOOK_CAPTURE_TARGET' }, response => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse(response);
      });
    });

    return true;
  }

  if (message?.type === 'DOWNLOAD_CAPTURE_IMAGE') {
    chrome.downloads.download({
      url: message.dataUrl,
      filename: message.filename || `facebook-post-${Date.now()}.png`,
      saveAs: true
    }, downloadId => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true, downloadId });
    });

    return true;
  }

});

async function captureFacebookTarget(tab) {
  const injected = await ensureContentScript(tab);
  if (!injected.ok) return injected;

  const options = await getCaptureOptions();
  const prepared = await sendMessage(tab.id, {
    type: 'PREPARE_FIT_FACEBOOK_CAPTURE',
    blurOwnerName: options.blurOwnerName,
    blurGroupName: options.blurGroupName
  });
  if (!prepared?.ok) return prepared || { ok: false, error: 'Content script không phản hồi.' };

  try {
    const croppedDataUrl = await captureFitTarget(tab, prepared.session);
    const filename = `facebook-post-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;

    const action = options.showCaptureMenu
      ? await sendMessage(tab.id, { type: 'SHOW_CAPTURE_RESULT_MODAL', dataUrl: croppedDataUrl, filename })
      : await sendMessage(tab.id, { type: 'COPY_CAPTURE_TO_CLIPBOARD', dataUrl: croppedDataUrl, filename });

    return {
      ok: action?.ok !== false,
      error: action?.ok === false ? action.error : undefined,
      filename,
      action,
      session: prepared.session,
      options,
      debug: prepared.debug
    };
  } finally {
    await sendMessage(tab.id, { type: 'FINISH_FULL_FACEBOOK_CAPTURE' });
  }
}

async function getCaptureOptions() {
  const settings = await chrome.storage.local.get({
    blurOwnerName: false,
    blurGroupName: false,
    showCaptureMenu: false
  });
  return {
    blurOwnerName: Boolean(settings.blurOwnerName),
    blurGroupName: Boolean(settings.blurGroupName),
    showCaptureMenu: Boolean(settings.showCaptureMenu)
  };
}

async function captureFitTarget(tab, session) {
  await delay(120);

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return await cropAndResizeImage(dataUrl, session.visibleRect, session.output, session.dpr);
}

async function cropAndResizeImage(dataUrl, rect, output, dpr) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = dpr || 1;

  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.min(bitmap.width - sx, Math.round(rect.width * scale));
  const sh = Math.min(bitmap.height - sy, Math.round(rect.height * scale));
  const outputWidth = Math.max(1, sw);
  const outputHeight = Math.max(1, sh);

  const canvas = new OffscreenCanvas(outputWidth, outputHeight);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return await blobToDataUrl(blob);
}

async function captureFullTarget(tab, session) {
  const scale = session.dpr || 1;
  const outputWidth = Math.max(1, Math.ceil(session.width * scale));
  const outputHeight = Math.max(1, Math.ceil(session.height * scale));
  const canvas = new OffscreenCanvas(outputWidth, outputHeight);
  const ctx = canvas.getContext('2d');
  const step = Math.max(120, Math.floor(session.viewport.height * 0.85));

  const offsets = [];
  for (let offsetY = 0; offsetY < session.height; offsetY += step) {
    offsets.push(offsetY);
  }
  if (!offsets.includes(Math.max(0, session.height - session.viewport.height))) {
    offsets.push(Math.max(0, session.height - session.viewport.height));
  }

  let shotIndex = 0;
  for (const offsetY of [...new Set(offsets)].sort((a, b) => a - b)) {
    const scrolled = await sendMessage(tab.id, {
      type: 'SCROLL_FULL_FACEBOOK_CAPTURE',
      offsetY
    });

    if (!scrolled?.ok || !scrolled.shot?.source?.width || !scrolled.shot?.source?.height) continue;

    if (shotIndex > 0) {
      await delay(CAPTURE_VISIBLE_TAB_DELAY_MS);
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    shotIndex += 1;
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    drawShot(ctx, bitmap, scrolled.shot, scale, outputWidth, outputHeight);
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return await blobToDataUrl(blob);
}

function drawShot(ctx, bitmap, shot, scale, outputWidth, outputHeight) {
  const sx = Math.max(0, Math.round(shot.source.x * scale));
  const sy = Math.max(0, Math.round(shot.source.y * scale));
  const sw = Math.min(bitmap.width - sx, Math.round(shot.source.width * scale));
  const sh = Math.min(bitmap.height - sy, Math.round(shot.source.height * scale));
  const dx = Math.max(0, Math.round(shot.dest.x * scale));
  const dy = Math.max(0, Math.round(shot.dest.y * scale));
  const dw = Math.min(outputWidth - dx, sw);
  const dh = Math.min(outputHeight - dy, sh);

  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  ctx.drawImage(bitmap, sx, sy, dw, dh, dx, dy, dw, dh);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureContentScript(tab) {
  if (!isFacebookTab(tab)) {
    return { ok: false, error: 'Tab hiện tại không phải Facebook.' };
  }

  const ping = await sendMessage(tab.id, { type: 'PING_FACEBOOK_CAPTURE' });
  if (ping?.ok) return { ok: true, injected: false };

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    const secondPing = await sendMessage(tab.id, { type: 'PING_FACEBOOK_CAPTURE' });
    if (secondPing?.ok) return { ok: true, injected: true };

    return {
      ok: false,
      error: secondPing?.error || 'Đã inject content script nhưng vẫn không nhận phản hồi.'
    };
  } catch (error) {
    return {
      ok: false,
      error: `Không inject được content script: ${error?.message || String(error)}`
    };
  }
}

function isFacebookTab(tab) {
  try {
    const url = new URL(tab.url || '');
    return url.hostname === 'www.facebook.com' || url.hostname === 'web.facebook.com';
  } catch {
    return false;
  }
}

function sendMessage(tabId, message) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

async function cropImage(dataUrl, rect, dpr) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = dpr || 1;

  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.min(bitmap.width - sx, Math.round(rect.width * scale));
  const sh = Math.min(bitmap.height - sy, Math.round(rect.height * scale));

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob) {
  return blob.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer);
    let binary = '';

    for (let index = 0; index < bytes.length; index += 0x8000) {
      const chunk = bytes.subarray(index, index + 0x8000);
      binary += String.fromCharCode(...chunk);
    }

    return `data:${blob.type};base64,${btoa(binary)}`;
  });
}
