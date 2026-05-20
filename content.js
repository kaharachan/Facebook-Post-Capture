if (!window.__facebookPostCaptureLoaded) {
window.__facebookPostCaptureLoaded = true;

let lastContextPoint = null;
let highlightedPost = null;
let activeCapture = null;
let activeFitCapture = null;

const POST_MARKERS = [
  '[aria-label^="Hành động đối với bài viết này"]',
  '[aria-label^="Actions for this post"]',
  '[data-ad-rendering-role="story_message"]',
  '[data-ad-rendering-role="profile_name"]',
  '[data-ad-rendering-role="comment_button"]',
  '[data-ad-rendering-role="like_button"]',
  '[data-ad-rendering-role="share_button"]'
];

document.addEventListener('contextmenu', event => {
  lastContextPoint = {
    x: event.clientX,
    y: event.clientY,
    pageX: event.pageX,
    pageY: event.pageY,
    dpr: window.devicePixelRatio || 1
  };
}, true);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PING_FACEBOOK_CAPTURE') {
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'GET_FACEBOOK_CAPTURE_TARGET') {
    const target = getCaptureTarget();

    if (!target) {
      sendResponse({ ok: false, error: 'Không tìm thấy bài viết/modal Facebook tại vị trí right-click.' });
      return true;
    }

    const rect = getVisibleRect(target);
    if (!rect || rect.width < 20 || rect.height < 20) {
      sendResponse({ ok: false, error: 'Tìm thấy element nhưng vùng capture không hợp lệ.' });
      return true;
    }

    flashTarget(target);

    sendResponse({
      ok: true,
      rect,
      dpr: window.devicePixelRatio || 1,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      page: {
        x: window.scrollX,
        y: window.scrollY
      },
      debug: describeTarget(target)
    });

    return true;
  }

  if (message?.type === 'PREPARE_FULL_FACEBOOK_CAPTURE') {
    const target = getCaptureTarget();

    if (!target) {
      sendResponse({ ok: false, error: 'Không tìm thấy bài viết/modal Facebook tại vị trí right-click.' });
      return true;
    }

    activeCapture = createCaptureSession(target);
    flashTarget(target);
    sendResponse({ ok: true, session: getCaptureSessionInfo(activeCapture), debug: describeTarget(target) });
    return true;
  }

  if (message?.type === 'PREPARE_FIT_FACEBOOK_CAPTURE') {
    const target = getCaptureTarget();

    if (!target) {
      sendResponse({ ok: false, error: 'Không tìm thấy bài viết/modal Facebook tại vị trí right-click.' });
      return true;
    }

    activeFitCapture = createFitCapture(target, {
      blurOwnerName: Boolean(message.blurOwnerName),
      blurGroupName: Boolean(message.blurGroupName)
    });
    sendResponse({ ok: true, session: activeFitCapture.session, debug: describeTarget(target) });
    return true;
  }

  if (message?.type === 'SCROLL_FULL_FACEBOOK_CAPTURE') {
    scrollCaptureSession(activeCapture, message.offsetY || 0);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sendResponse({ ok: true, shot: getCaptureShotInfo(activeCapture) });
      });
    });
    return true;
  }

  if (message?.type === 'FINISH_FULL_FACEBOOK_CAPTURE') {
    restoreCaptureSession(activeCapture);
    activeCapture = null;
    restoreFitCapture(activeFitCapture);
    activeFitCapture = null;
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'COPY_CAPTURE_TO_CLIPBOARD') {
    copyCaptureToClipboard(message.dataUrl)
      .then(() => {
        showCaptureToast('Đã sao chép hình ảnh');
        sendResponse({ ok: true, action: 'copied' });
      })
      .catch(error => sendResponse({ ok: false, action: 'copy-failed', error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'SHOW_CAPTURE_RESULT_MODAL') {
    showCaptureResultModal(message.dataUrl, message.filename);
    sendResponse({ ok: true, action: 'menu-shown' });
    return true;
  }

  if (message?.type === 'DEBUG_FACEBOOK_CAPTURE_TARGET') {
    const target = getCaptureTarget();
    if (target) flashTarget(target);
    sendResponse({
      ok: Boolean(target),
      debug: target ? describeTarget(target) : null,
      point: lastContextPoint
    });
    return true;
  }
});

function getCaptureTarget() {
  const point = lastContextPoint || {
    x: Math.round(window.innerWidth / 2),
    y: Math.round(window.innerHeight / 2)
  };

  const target = document.elementFromPoint(point.x, point.y);
  if (!target) return null;

  const dialog = target.closest('[role="dialog"]');
  if (dialog) {
    const dialogPost = findPostContainer(target, dialog);
    return dialogPost || dialog;
  }

  return findPostContainer(target, document.body);
}

function findPostContainer(target, root) {
  const anchor = findNearestPostAnchor(target, root);
  if (!anchor) return null;

  let current = anchor;
  let best = null;

  while (current && current !== root.parentElement && current !== document.body.parentElement) {
    if (isLikelyPostContainer(current)) {
      best = current;

      const parent = current.parentElement;
      if (!parent || parent === document.body) break;

      const parentRect = parent.getBoundingClientRect();
      const parentPostActions = parent.querySelectorAll('[aria-label^="Hành động đối với bài viết này"], [aria-label^="Actions for this post"]').length;
      const parentTooLarge = parentRect.height > window.innerHeight * 1.8 || parentRect.width > window.innerWidth * 0.98;

      if (parentPostActions > 1 || parentTooLarge) break;
    }

    if (current === root) break;
    current = current.parentElement;
  }

  return best;
}

function findNearestPostAnchor(target, root) {
  let current = target;

  while (current && current !== root.parentElement && current !== document.body.parentElement) {
    if (matchesAny(current, POST_MARKERS)) return current;

    const marker = current.querySelector?.(POST_MARKERS.join(','));
    if (marker) return marker;

    if (current === root) break;
    current = current.parentElement;
  }

  return null;
}

function isLikelyPostContainer(element) {
  const hasAction = Boolean(element.querySelector('[aria-label^="Hành động đối với bài viết này"], [aria-label^="Actions for this post"]'));
  const hasMessage = Boolean(element.querySelector('[data-ad-rendering-role="story_message"]'));
  const hasProfile = Boolean(element.querySelector('[data-ad-rendering-role="profile_name"]'));
  const hasComment = Boolean(element.querySelector('[data-ad-rendering-role="comment_button"], [aria-label="Viết bình luận"], [aria-label="Comment"]'));
  const hasLike = Boolean(element.querySelector('[data-ad-rendering-role="like_button"], [aria-label="Thích"], [aria-label="Gỡ Thích"], [aria-label="Like"], [aria-label="Unlike"]'));
  const hasShare = Boolean(element.querySelector('[data-ad-rendering-role="share_button"], [aria-label^="Gửi nội dung này"], [aria-label^="Send this"]'));
  const markerCount = [hasAction, hasMessage, hasProfile, hasComment, hasLike, hasShare].filter(Boolean).length;

  if (!hasAction) return false;
  if (hasMessage && (hasComment || hasLike || hasShare)) return true;
  return markerCount >= 3;
}

function getVisibleRect(element) {
  const rect = element.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    raw: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom
    }
  };
}

function createCaptureSession(element) {
  const rect = element.getBoundingClientRect();
  const scrollParent = findScrollableParent(element);
  const parentRect = scrollParent?.getBoundingClientRect();
  const targetParentTop = scrollParent ? rect.top - parentRect.top + scrollParent.scrollTop : null;
  const targetParentLeft = scrollParent ? rect.left - parentRect.left + scrollParent.scrollLeft : null;

  return {
    element,
    scrollParent,
    originalWindowScroll: { x: window.scrollX, y: window.scrollY },
    originalParentScrollTop: scrollParent ? scrollParent.scrollTop : null,
    originalParentScrollLeft: scrollParent ? scrollParent.scrollLeft : null,
    targetParentTop,
    targetParentLeft,
    targetDocumentTop: rect.top + window.scrollY,
    targetDocumentLeft: rect.left + window.scrollX,
    width: Math.ceil(rect.width),
    height: Math.ceil(Math.max(rect.height, element.scrollHeight || rect.height)),
    dpr: window.devicePixelRatio || 1,
    mode: scrollParent ? 'element-scroll' : 'window-scroll'
  };
}

function createFitCapture(element, options = {}) {
  restoreFitCapture(activeFitCapture);

  const rect = element.getBoundingClientRect();
  const originalWidth = Math.ceil(rect.width);
  const originalHeight = Math.ceil(Math.max(rect.height, element.scrollHeight || rect.height));
  const margin = 12;
  const scale = Math.min(
    1,
    (window.innerWidth - margin * 2) / originalWidth,
    (window.innerHeight - margin * 2) / originalHeight
  );
  const safeScale = Math.max(0.02, scale);
  const displayWidth = Math.ceil(originalWidth * safeScale);
  const displayHeight = Math.ceil(originalHeight * safeScale);
  const left = Math.max(margin, Math.floor((window.innerWidth - displayWidth) / 2));
  const top = Math.max(margin, Math.floor((window.innerHeight - displayHeight) / 2));

  const cover = document.createElement('div');
  cover.setAttribute('data-facebook-post-capture-cover', 'true');
  Object.assign(cover.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483646',
    background: 'rgba(255,255,255,0.96)',
    pointerEvents: 'none'
  });

  const clone = element.cloneNode(true);
  clone.setAttribute('data-facebook-post-capture-clone', 'true');
  Object.assign(clone.style, {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    width: `${originalWidth}px`,
    maxWidth: 'none',
    height: `${originalHeight}px`,
    maxHeight: 'none',
    overflow: 'hidden',
    transform: `scale(${safeScale})`,
    transformOrigin: 'top left',
    zIndex: '2147483647',
    pointerEvents: 'none'
  });

  if (options.blurOwnerName || options.blurGroupName) {
    maskNamesInClone(clone, options);
  }

  document.documentElement.append(cover, clone);

  return {
    cover,
    clone,
    session: {
      visibleRect: {
        x: left,
        y: top,
        width: displayWidth,
        height: displayHeight
      },
      output: {
        width: originalWidth,
        height: originalHeight
      },
      dpr: window.devicePixelRatio || 1,
      fitScale: safeScale,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      mode: 'fit-clone'
    }
  };
}

function maskNamesInClone(clone, options) {
  const candidates = collectNameMaskCandidates(clone);

  if (options.blurOwnerName) {
    maskElements(candidates.owner, 'owner-name');
  }

  if (options.blurGroupName) {
    maskElements(candidates.group, 'group-name');
  }
}

function collectNameMaskCandidates(clone) {
  const owner = new Set();
  const group = new Set();
  const firstStoryMessage = clone.querySelector('[data-ad-rendering-role="story_message"]');
  const profileNameElements = [...clone.querySelectorAll('[data-ad-rendering-role="profile_name"]')]
    .filter(hasVisibleText);

  for (const element of profileNameElements) {
    if (containsGroupLink(element)) {
      group.add(element);
    } else {
      owner.add(element);
    }
  }

  const groupOwnerLinks = [...clone.querySelectorAll('a[href*="/groups/"][href*="/user/"]')]
    .filter(link => hasVisibleText(link) && link.getAttribute('aria-hidden') !== 'true' && isBeforeElement(link, firstStoryMessage));
  for (const link of groupOwnerLinks) {
    owner.add(findTextMaskTarget(link));
  }

  return { owner, group };
}

function containsGroupLink(element) {
  return Boolean(element.querySelector('a[href*="/groups/"]:not([href*="/user/"])'));
}

function hasVisibleText(element) {
  return Boolean(element?.textContent?.replace(/\s+/g, ' ').trim());
}

function isBeforeElement(element, boundary) {
  if (!boundary) return true;
  return Boolean(element.compareDocumentPosition(boundary) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function findTextMaskTarget(element) {
  const directText = [...element.querySelectorAll('span')]
    .find(span => hasVisibleText(span) && !span.querySelector('span'));
  return directText || element;
}

function maskElements(elements, maskType) {
  for (const element of elements) {
    element.setAttribute('data-facebook-post-capture-masked', maskType);
    Object.assign(element.style, {
      display: 'inline-block',
      filter: 'blur(6px)',
      borderRadius: '6px',
      background: 'rgba(255,255,255,0.78)',
      boxShadow: '0 0 0 4px rgba(255,255,255,0.78)',
      userSelect: 'none'
    });
  }
}

function restoreFitCapture(capture) {
  if (!capture) return;
  capture.clone?.remove();
  capture.cover?.remove();
}

async function copyCaptureToClipboard(dataUrl) {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('Trình duyệt không hỗ trợ copy ảnh vào clipboard ở trang này.');
  }

  const blob = await dataUrlToBlob(dataUrl);
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type || 'image/png']: blob })
  ]);
}

async function dataUrlToBlob(dataUrl) {
  return await (await fetch(dataUrl)).blob();
}

function showCaptureResultModal(dataUrl, filename) {
  document.querySelector('[data-facebook-post-capture-result-modal="true"]')?.remove();

  const overlay = document.createElement('div');
  overlay.setAttribute('data-facebook-post-capture-result-modal', 'true');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    background: 'rgba(0, 0, 0, 0.52)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    boxSizing: 'border-box'
  });

  const modal = document.createElement('div');
  Object.assign(modal.style, {
    width: 'min(560px, 92vw)',
    maxHeight: '88vh',
    background: '#ffffff',
    borderRadius: '18px',
    boxShadow: '0 24px 80px rgba(0, 0, 0, 0.32)',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    fontFamily: 'Arial, sans-serif'
  });

  const image = document.createElement('img');
  image.src = dataUrl;
  image.alt = 'Facebook capture preview';
  Object.assign(image.style, {
    width: '100%',
    maxHeight: '62vh',
    objectFit: 'contain',
    borderRadius: '12px',
    background: '#f3f4f6',
    border: '1px solid #e5e7eb'
  });

  const actions = document.createElement('div');
  Object.assign(actions.style, {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
    flexWrap: 'wrap'
  });

  const status = document.createElement('div');
  status.textContent = 'Chọn Copy hoặc Download.';
  Object.assign(status.style, {
    minHeight: '20px',
    textAlign: 'center',
    color: '#4b5563',
    fontSize: '13px'
  });

  const copyButton = createCaptureModalButton('Copy', '#1877f2');
  copyButton.addEventListener('click', async () => {
    copyButton.disabled = true;
    status.textContent = 'Đang copy ảnh...';
    try {
      window.focus();
      await copyCaptureToClipboard(dataUrl);
      status.textContent = 'Đã copy ảnh vào clipboard.';
      showCaptureToast('Đã sao chép hình ảnh');
      closeModal();
    } catch (error) {
      status.textContent = `Copy lỗi: ${error?.message || String(error)}`;
    } finally {
      copyButton.disabled = false;
    }
  });

  const downloadButton = createCaptureModalButton('Download', '#16a34a');
  downloadButton.addEventListener('click', () => {
    downloadButton.disabled = true;
    status.textContent = 'Đang mở hộp thoại tải xuống...';
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_CAPTURE_IMAGE',
      dataUrl,
      filename
    }, response => {
      if (chrome.runtime.lastError || !response?.ok) {
        status.textContent = `Download lỗi: ${chrome.runtime.lastError?.message || response?.error || 'Không rõ lỗi.'}`;
        downloadButton.disabled = false;
        return;
      }
      status.textContent = 'Đã gửi ảnh tới trình tải xuống.';
      closeModal();
    });
  });

  const closeButton = createCaptureModalButton('Đóng', '#6b7280');
  const closeModal = () => {
    document.removeEventListener('keydown', closeCaptureResultModalOnEscape, true);
    overlay.remove();
  };
  closeButton.addEventListener('click', closeModal);

  actions.append(copyButton, downloadButton, closeButton);
  modal.append(image, actions, status);
  overlay.append(modal);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeModal();
  });
  document.addEventListener('keydown', closeCaptureResultModalOnEscape, true);
  document.documentElement.append(overlay);
}

function closeCaptureResultModalOnEscape(event) {
  if (event.key !== 'Escape') return;
  document.removeEventListener('keydown', closeCaptureResultModalOnEscape, true);
  document.querySelector('[data-facebook-post-capture-result-modal="true"]')?.remove();
}

function createCaptureModalButton(label, background) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  Object.assign(button.style, {
    minWidth: '112px',
    border: '0',
    borderRadius: '999px',
    padding: '10px 18px',
    color: '#ffffff',
    background,
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer'
  });
  return button;
}

function showCaptureToast(message) {
  document.querySelector('[data-facebook-post-capture-toast="true"]')?.remove();

  const toast = document.createElement('div');
  toast.setAttribute('data-facebook-post-capture-toast', 'true');
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    top: '18px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
    padding: '12px 22px',
    borderRadius: '999px',
    background: '#064e3b',
    color: '#ffffff',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.28)',
    fontFamily: 'Arial, sans-serif',
    fontSize: '14px',
    fontWeight: '700',
    lineHeight: '20px',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 160ms ease, transform 160ms ease'
  });

  document.documentElement.append(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-8px)';
    window.setTimeout(() => toast.remove(), 180);
  }, 1800);
}

function getCaptureSessionInfo(session) {
  return {
    width: Math.ceil(session.width),
    height: Math.ceil(session.height),
    dpr: session.dpr,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    mode: session.mode
  };
}

function scrollCaptureSession(session, offsetY) {
  if (!session) return;

  if (session.scrollParent) {
    session.scrollParent.scrollTop = session.targetParentTop + offsetY;
  } else {
    window.scrollTo(session.originalWindowScroll.x, session.targetDocumentTop + offsetY);
  }
}

function getCaptureShotInfo(session) {
  if (!session) return null;

  const rect = session.element.getBoundingClientRect();
  const visibleLeft = Math.max(0, rect.left);
  const visibleTop = Math.max(0, rect.top);
  const visibleRight = Math.min(window.innerWidth, rect.right);
  const visibleBottom = Math.min(window.innerHeight, rect.bottom);

  let destX = Math.max(0, visibleLeft - rect.left);
  let destY;

  if (session.scrollParent) {
    destY = session.scrollParent.scrollTop - session.targetParentTop + Math.max(0, visibleTop - rect.top);
  } else {
    const visibleDocumentTop = visibleTop + window.scrollY;
    destY = visibleDocumentTop - session.targetDocumentTop;
  }

  return {
    source: {
      x: visibleLeft,
      y: visibleTop,
      width: Math.max(0, visibleRight - visibleLeft),
      height: Math.max(0, visibleBottom - visibleTop)
    },
    dest: {
      x: destX,
      y: Math.max(0, destY)
    }
  };
}

function restoreCaptureSession(session) {
  if (!session) return;

  if (session.scrollParent) {
    session.scrollParent.scrollTop = session.originalParentScrollTop;
    session.scrollParent.scrollLeft = session.originalParentScrollLeft;
  }

  window.scrollTo(session.originalWindowScroll.x, session.originalWindowScroll.y);
}

function findScrollableParent(element) {
  let current = element;

  while (current && current !== document.body && current !== document.documentElement) {
    const style = window.getComputedStyle(current);
    const canScrollY = /(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 2;
    if (canScrollY) return current;
    current = current.parentElement;
  }

  return null;
}

function flashTarget(element) {
  if (highlightedPost) {
    highlightedPost.style.outline = '';
    highlightedPost.style.outlineOffset = '';
  }

  highlightedPost = element;
  element.style.outline = '3px solid #ff2d55';
  element.style.outlineOffset = '3px';

  window.setTimeout(() => {
    if (highlightedPost === element) {
      element.style.outline = '';
      element.style.outlineOffset = '';
      highlightedPost = null;
    }
  }, 1800);
}

function describeTarget(element) {
  const rect = element.getBoundingClientRect();
  return {
    tag: element.tagName,
    role: element.getAttribute('role'),
    ariaLabel: element.getAttribute('aria-label'),
    className: String(element.className || '').slice(0, 240),
    markerSummary: POST_MARKERS.map(selector => ({
      selector,
      count: element.querySelectorAll(selector).length
    })),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  };
}

function matchesAny(element, selectors) {
  return selectors.some(selector => {
    try {
      return element.matches?.(selector);
    } catch {
      return false;
    }
  });
}
}
