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

    prepareFullCaptureTarget(target, message)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
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
    showCaptureResultModal(message.dataUrl, message.filename, message.postUrl);
    sendResponse({ ok: true, action: 'menu-shown' });
    return true;
  }

  if (message?.type === 'DEBUG_FACEBOOK_CAPTURE_TARGET') {
    const target = getCaptureTarget();
    if (target) flashTarget(target);
    Promise.resolve(target ? findPostLinkResult(target) : null)
      .then(postLinkResult => sendResponse({
        ok: Boolean(target),
        debug: target ? describeTarget(target) : null,
        postUrl: postLinkResult?.url || null,
        postUrlCase: postLinkResult?.caseName || null,
        point: lastContextPoint
      }))
      .catch(error => sendResponse({
        ok: Boolean(target),
        debug: target ? describeTarget(target) : null,
        postUrl: null,
        point: lastContextPoint,
        error: error?.message || String(error)
      }));
    return true;
  }
});

function getCaptureTarget() {
  const point = lastContextPoint || {
    x: Math.round(window.innerWidth / 2),
    y: Math.round(window.innerHeight / 2)
  };

  const target = document.elementFromPoint(point.x, point.y);
  const activeDialog = getActiveDialog(point);

  if (activeDialog) {
    if (target && activeDialog.contains(target)) {
      const dialogPost = findPostContainer(target, activeDialog);
      if (dialogPost) return dialogPost;
    }

    return findBestVisiblePost(activeDialog) || activeDialog;
  }

  if (!target) return null;

  const dialog = target.closest('[role="dialog"]');
  if (dialog) {
    const dialogPost = findPostContainer(target, dialog);
    return dialogPost || dialog;
  }

  return findPostContainer(target, document.body);
}

function getActiveDialog(point) {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    .filter(dialog => isVisibleElement(dialog));

  if (!dialogs.length) return null;

  const pointDialog = dialogs.find(dialog => {
    const rect = dialog.getBoundingClientRect();
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  });
  if (pointDialog) return pointDialog;

  return dialogs
    .map(dialog => ({ dialog, score: getVisibleArea(dialog) }))
    .sort((a, b) => b.score - a.score)[0]?.dialog || null;
}

function findBestVisiblePost(root) {
  const posts = [...root.querySelectorAll('[aria-label^="Hành động đối với bài viết này"], [aria-label^="Actions for this post"]')]
    .map(marker => findPostContainer(marker, root))
    .filter(Boolean);
  const uniquePosts = [...new Set(posts)];

  return uniquePosts
    .map(post => ({ post, score: getVisibleArea(post) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.post || null;
}

function isVisibleElement(element) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && rect.width > 0
    && rect.height > 0
    && rect.right > 0
    && rect.bottom > 0
    && rect.left < window.innerWidth
    && rect.top < window.innerHeight;
}

function getVisibleArea(element) {
  const rect = element.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
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

async function prepareFullCaptureTarget(target, message) {
  const expandedSeeMoreCount = Boolean(message.expandSeeMore)
    ? await expandSeeMoreInElement(target)
    : 0;
  const postLink = Boolean(message.attachPostQr) ? await findPostLink(target) : null;

  activeCapture = createCaptureSession(target, {
    blurOwnerName: Boolean(message.blurOwnerName),
    blurGroupName: Boolean(message.blurGroupName),
    postLink
  });
  if (postLink) await waitForQrImages(target);
  flashTarget(target);

  return {
    ok: true,
    session: getCaptureSessionInfo(activeCapture),
    debug: {
      ...describeTarget(target),
      expandedSeeMoreCount,
      postLink
    }
  };
}

async function findPostLink(root) {
  return (await findPostLinkResult(root))?.url || null;
}

async function findPostLinkResult(root) {
  const currentUrl = normalizeFacebookUrl(window.location.href);
  const currentGroupPostUrl = deriveGroupPostUrl([currentUrl].filter(Boolean));
  if (currentGroupPostUrl) return { url: currentGroupPostUrl, caseName: 'current-group-derived' };
  if (isUsablePostUrl(currentUrl)) return { url: currentUrl, caseName: `current-${getPostUrlCaseName(currentUrl)}` };

  const links = collectPostUrlCandidates(root);
  const directLink = pickBestPostLinkResult(links);
  if (directLink) return { ...directLink, caseName: `direct-${directLink.caseName}` };

  await hydratePostTimestampLinks(root);
  const hoverLink = pickBestPostLinkResult(collectPostUrlCandidates(root));
  return hoverLink ? { ...hoverLink, caseName: `hover-${hoverLink.caseName}` } : null;
}

function pickBestPostLink(links) {
  return pickBestPostLinkResult(links)?.url || null;
}

function pickBestPostLinkResult(links) {
  const pfbidPost = links.find(url => /\/posts\/pfbid/i.test(url));
  if (pfbidPost) return { url: pfbidPost, caseName: 'pfbid-post' };

  const post = links.find(url => /\/posts\//i.test(url) && !/\/photo\//i.test(url) && !/\/videos?\//i.test(url));
  if (post) return { url: post, caseName: getPostUrlCaseName(post) };

  const permalink = links.find(url => /\/permalink\.php/i.test(url));
  if (permalink) return { url: permalink, caseName: 'permalink' };

  const storyFbid = links.find(url => /story_fbid=/i.test(url));
  if (storyFbid) return { url: storyFbid, caseName: 'story-fbid' };

  const groupPost = deriveGroupPostUrl(links);
  if (groupPost) return { url: groupPost, caseName: 'group-derived' };

  const sharePost = links.find(url => /\/share\/p\//i.test(url));
  if (sharePost) return { url: sharePost, caseName: 'share-p' };

  const shareVideo = links.find(url => /\/share\/v\//i.test(url));
  if (shareVideo) return { url: shareVideo, caseName: 'share-v' };

  const watch = links.find(url => /\/watch\//i.test(url) && /\bv=/.test(url));
  if (watch) return { url: watch, caseName: 'watch' };

  const fbid = links.find(url => /fbid=/i.test(url) && !/\/photo\//i.test(url));
  if (fbid) return { url: fbid, caseName: 'fbid' };

  return null;
}

function getPostUrlCaseName(postUrl) {
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

async function hydratePostTimestampLinks(root) {
  const scopes = [];
  const postContainer = findPostContainer(root, document.body);
  if (postContainer) scopes.push(postContainer);
  if (!scopes.includes(root)) scopes.push(root);

  const links = [...new Set(scopes.flatMap(scope => findLikelyTimestampLinks(scope)))].slice(0, 4);
  for (const link of links) {
    syntheticHover(link);
    await delay(80);
    syntheticUnhover(link);
    await waitForHoverTooltipToClose();
  }
}

function findLikelyTimestampLinks(scope) {
  const profileLink = scope.querySelector?.('[data-ad-rendering-role="profile_name"] a[href], h4 a[href]');
  const allLinks = [...scope.querySelectorAll?.('a[href]') || []];

  return allLinks.filter(link => {
    if (!isVisibleElement(link)) return false;
    if (link === profileLink || link.contains(profileLink) || profileLink?.contains(link)) return false;

    const href = link.getAttribute('href') || '';
    const text = normalizeText(link.innerText || link.textContent || '');
    if (/\/stories\//i.test(href) || /\/groups\/[^/]+\/user\//i.test(href)) return false;
    if (/\/posts\//i.test(href) || /multi_permalinks=|story_fbid=|__tn__=.*O/i.test(href)) return true;
    return /(?:\d+\s*(?:giây|phút|giờ|ngày|tuần|tháng|năm)|vừa xong|yesterday|yesterday at|\d+\s*(?:s|m|h|d|w|mo|y)\b)/i.test(text);
  });
}

function syntheticHover(element) {
  const rect = element.getBoundingClientRect();
  const clientX = Math.round(rect.left + rect.width / 2);
  const clientY = Math.round(rect.top + rect.height / 2);
  const eventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX,
    clientY,
    screenX: clientX,
    screenY: clientY,
    buttons: 0
  };

  for (const eventName of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) {
    const EventCtor = eventName.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
    element.dispatchEvent(new EventCtor(eventName, eventInit));
  }
}

function syntheticUnhover(element) {
  const rect = element.getBoundingClientRect();
  const fromX = Math.round(rect.left + rect.width / 2);
  const fromY = Math.round(rect.top + rect.height / 2);
  const toElement = document.body;
  const eventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: fromX,
    clientY: fromY,
    screenX: fromX,
    screenY: fromY,
    buttons: 0,
    relatedTarget: toElement
  };

  for (const eventName of ['pointerout', 'pointerleave', 'mouseout', 'mouseleave']) {
    const EventCtor = eventName.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
    element.dispatchEvent(new EventCtor(eventName, eventInit));
  }

  const clearInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: 1,
    clientY: 1,
    screenX: 1,
    screenY: 1,
    buttons: 0,
    relatedTarget: element
  };
  for (const eventName of ['pointerover', 'mouseover', 'mousemove']) {
    const EventCtor = eventName.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
    toElement.dispatchEvent(new EventCtor(eventName, clearInit));
  }
}

async function waitForHoverTooltipToClose() {
  for (let index = 0; index < 8; index += 1) {
    await delay(40);
    if (!document.querySelector('[role="tooltip"]')) return;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function deriveGroupPostUrl(urls) {
  const permalinkGroupPostUrl = deriveGroupPostUrlFromPermalink(urls);
  if (permalinkGroupPostUrl) return permalinkGroupPostUrl;

  const groupPostMediaUrl = urls.find(url => /[?&]set=gm\.\d+/i.test(url) || /[?&]idorvanity=\d+/i.test(url));
  if (!groupPostMediaUrl) return null;

  try {
    const media = new URL(groupPostMediaUrl);
    const groupId = media.searchParams.get('idorvanity')
      || findGroupIdFromUrls(urls);
    const postId = media.searchParams.get('set')?.match(/^gm\.(\d+)/i)?.[1]
      || media.searchParams.get('fbid');

    if (!groupId || !postId) return null;
    return `https://www.facebook.com/groups/${groupId}/posts/${postId}/`;
  } catch {
    return null;
  }
}

function deriveGroupPostUrlFromPermalink(urls) {
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      const groupId = parsed.pathname.match(/\/groups\/(\d+)/i)?.[1];
      const postId = parsed.searchParams.get('multi_permalinks');
      if (groupId && postId) {
        return `https://www.facebook.com/groups/${groupId}/posts/${postId}/`;
      }
    } catch {
      // Ignore malformed candidates.
    }
  }
  return null;
}

function findGroupIdFromUrls(urls) {
  for (const url of urls) {
    try {
      const groupId = new URL(url).pathname.match(/\/groups\/(\d+)/i)?.[1];
      if (groupId) return groupId;
    } catch {
      // Ignore malformed candidates.
    }
  }
  return null;
}

function collectPostUrlCandidates(root) {
  const scopes = [];
  const postContainer = findPostContainer(root, document.body);
  if (postContainer) scopes.push(postContainer);

  let current = root;

  while (current && current !== document.body.parentElement) {
    if (!scopes.includes(current)) scopes.push(current);
    if (current.getAttribute?.('role') === 'article') break;
    if (current.querySelector?.('[aria-label^="Hành động đối với bài viết này"], [aria-label^="Actions for this post"]')
      && current.querySelector?.('[data-ad-rendering-role="profile_name"]')
      && isLikelyPostContainer(current)) {
      break;
    }
    current = current.parentElement;
  }

  const activeDialog = getActiveDialog(lastContextPoint || {
    x: Math.round(window.innerWidth / 2),
    y: Math.round(window.innerHeight / 2)
  });
  if (activeDialog && !scopes.includes(activeDialog)) scopes.push(activeDialog);

  const urls = [];
  for (const scope of scopes) {
    for (const link of scope.querySelectorAll?.('a[href]') || []) {
      const normalized = normalizeFacebookUrl(link.href || link.getAttribute('href'));
      if (normalized && !urls.includes(normalized)) urls.push(normalized);
    }
  }

  return urls;
}

function normalizeFacebookUrl(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return null;

    const allowedParams = ['story_fbid', 'fbid', 'id', 'set', 'v', 'idorvanity', 'multi_permalinks'];
    const normalized = new URL(`${parsed.origin}${parsed.pathname}`);
    for (const param of allowedParams) {
      const value = parsed.searchParams.get(param);
      if (value) normalized.searchParams.set(param, value);
    }
    return normalized.toString();
  } catch {
    return null;
  }
}

function isUsablePostUrl(url) {
  return Boolean(url && (/\/share\/p\//i.test(url)
    || /\/share\/v\//i.test(url)
    || /\/posts\//i.test(url)
    || /\/permalink\.php/i.test(url)
    || /\/watch\//i.test(url)
    || /story_fbid=|fbid=|multi_permalinks=/i.test(url)));
}

async function expandSeeMoreInElement(root) {
  let clickedCount = 0;
  const maxRounds = 8;

  for (let round = 0; round < maxRounds; round += 1) {
    const button = findSeeMoreButton(root);
    if (!button) break;

    clickElement(button);
    clickedCount += 1;
    await waitForStableFrame();
  }

  return clickedCount;
}

function findSeeMoreButton(root) {
  const candidates = [...root.querySelectorAll('div[role="button"], span[role="button"], a[role="button"], button, span, a')];

  return candidates.find(element => {
    if (!isVisibleElement(element)) return false;
    if (element.closest('[data-facebook-post-capture-modal], [data-facebook-post-capture-toast]')) return false;

    const text = normalizeText(element.innerText || element.textContent || '');
    if (!isSeeMoreText(text)) return false;

    const clickable = getClickableElement(element);
    return clickable && root.contains(clickable) && isVisibleElement(clickable);
  }) || null;
}

function isSeeMoreText(text) {
  const normalized = normalizeText(text).toLowerCase();
  return normalized === 'xem thêm'
    || normalized === 'see more'
    || normalized === 'xem them';
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function getClickableElement(element) {
  return element.closest('div[role="button"], span[role="button"], a[role="button"], button, a') || element;
}

function clickElement(element) {
  const clickable = getClickableElement(element);
  clickable.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
  clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  clickable.click();
}

function waitForStableFrame() {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

function createCaptureSession(element, options = {}) {
  restoreCaptureSession(activeCapture);

  const originalWindowScroll = { x: window.scrollX, y: window.scrollY };
  const scrollParent = findScrollableParent(element);
  const originalParentScrollTop = scrollParent ? scrollParent.scrollTop : null;
  const originalParentScrollLeft = scrollParent ? scrollParent.scrollLeft : null;

  normalizeCaptureStartPosition(element, scrollParent);

  const rect = element.getBoundingClientRect();
  const parentRect = scrollParent?.getBoundingClientRect();
  const targetParentTop = scrollParent ? rect.top - parentRect.top + scrollParent.scrollTop : null;
  const targetParentLeft = scrollParent ? rect.left - parentRect.left + scrollParent.scrollLeft : null;
  const qrRecords = options.postLink ? attachQrToPostHeader(element, options.postLink) : [];
  const finalRect = element.getBoundingClientRect();
  const contentHeight = Math.max(finalRect.height, element.scrollHeight || finalRect.height);
  const contentWidth = Math.max(finalRect.width, element.scrollWidth || finalRect.width);
  const maskedElements = options.blurOwnerName || options.blurGroupName
    ? maskNamesInElement(element, options)
    : [];
  const hiddenFloatingElements = hideFloatingCaptureObstructions(element);

  return {
    element,
    scrollParent,
    maskedElements,
    qrRecords,
    hiddenFloatingElements,
    originalWindowScroll,
    originalParentScrollTop,
    originalParentScrollLeft,
    targetParentTop,
    targetParentLeft,
    targetDocumentTop: rect.top + window.scrollY,
    targetDocumentLeft: rect.left + window.scrollX,
    width: Math.ceil(contentWidth),
    height: Math.ceil(contentHeight),
    dpr: window.devicePixelRatio || 1,
    mode: scrollParent ? 'element-scroll' : 'window-scroll'
  };
}

function attachQrToPostHeader(element, postLink) {
  const header = findPostHeaderForQr(element);
  if (!header || !postLink) return [];

  const previousPosition = header.style.position;
  const previousMinHeight = header.style.minHeight;
  const qr = document.createElement('img');
  const headerHeight = header.getBoundingClientRect().height;
  const size = Math.max(62, Math.min(86, Math.floor(headerHeight * 1.55) || 72));

  qr.setAttribute('data-facebook-post-capture-qr', 'true');
  qr.alt = 'QR link bài viết';
  qr.src = `https://quickchart.io/qr?text=${encodeURIComponent(postLink)}&margin=0&size=120`;
  Object.assign(qr.style, {
    position: 'absolute',
    top: '4px',
    right: '92px',
    width: `${size}px`,
    height: `${size}px`,
    boxSizing: 'border-box',
    border: '2px solid #ff2d55',
    borderRadius: '2px',
    background: '#ffffff',
    padding: '1px',
    objectFit: 'contain',
    zIndex: '2147483640',
    pointerEvents: 'none'
  });

  if (window.getComputedStyle(header).position === 'static') {
    header.style.position = 'relative';
  }
  header.style.minHeight = `${Math.max(headerHeight, size + 8)}px`;
  header.append(qr);

  return [{ header, qr, previousPosition, previousMinHeight }];
}

async function waitForQrImages(root) {
  const images = [...root.querySelectorAll('img[data-facebook-post-capture-qr="true"]')];
  await Promise.all(images.map(image => {
    if (image.complete && image.naturalWidth > 0) return Promise.resolve();
    return new Promise(resolve => {
      const timeout = window.setTimeout(resolve, 2500);
      image.addEventListener('load', () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
      image.addEventListener('error', () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }));
  await waitForStableFrame();
}

function findPostHeaderForQr(element) {
  const owner = collectNameMaskCandidates(element).owner.values().next().value;
  const ownerRow = owner?.closest('h2, h3, h4, [data-ad-rendering-role="profile_name"], div');
  const actionButton = element.querySelector('[aria-label^="Hành động đối với bài viết này"], [aria-label^="Actions for this post"]');
  const actionRow = actionButton?.closest('div');

  if (ownerRow && actionRow) {
    let current = ownerRow;
    while (current && current !== element) {
      if (current.contains(actionRow)) return current;
      current = current.parentElement;
    }
  }

  if (ownerRow) {
    let current = ownerRow;
    for (let depth = 0; current && current !== element && depth < 5; depth += 1) {
      const rect = current.getBoundingClientRect();
      if (rect.width > 220 && rect.height >= 36 && rect.height <= 120) return current;
      current = current.parentElement;
    }
  }

  return element;
}

function normalizeCaptureStartPosition(element, scrollParent) {
  const topPadding = 10;

  if (scrollParent) {
    const parentRect = scrollParent.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const targetTop = rect.top - parentRect.top + scrollParent.scrollTop;
    const maxScrollTop = Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight);
    scrollParent.scrollTop = Math.max(0, Math.min(maxScrollTop, targetTop - topPadding));
    return;
  }

  const rect = element.getBoundingClientRect();
  const targetTop = rect.top + window.scrollY;
  const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  window.scrollTo(window.scrollX, Math.max(0, Math.min(maxScrollY, targetTop - topPadding)));
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
  maskNamesInElement(clone, options);
}

function maskNamesInElement(element, options) {
  const candidates = collectNameMaskCandidates(element);
  const masked = [];

  if (options.blurOwnerName) {
    masked.push(...maskElements(candidates.owner, 'owner-name'));
  }

  if (options.blurGroupName) {
    masked.push(...maskElements(candidates.group, 'group-name'));
  }

  return masked;
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
  const masked = [];

  for (const element of elements) {
    masked.push({
      element,
      style: element.style.cssText,
      previousMask: element.getAttribute('data-facebook-post-capture-masked')
    });
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

  return masked;
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

function showCaptureResultModal(dataUrl, filename, postUrl) {
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

  const postLink = document.createElement('a');
  postLink.href = postUrl || '#';
  postLink.target = '_blank';
  postLink.rel = 'noopener noreferrer';
  postLink.textContent = postUrl || '';
  Object.assign(postLink.style, {
    display: postUrl ? 'block' : 'none',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'center',
    color: '#6b7280',
    opacity: '0.82',
    fontSize: '12px',
    fontStyle: 'italic',
    lineHeight: '18px',
    textDecoration: 'none'
  });

  const status = document.createElement('div');
  status.textContent = 'Chọn Copy hoặc Download';
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
  modal.append(image, actions, postLink, status);
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
  const scrollRect = session.scrollParent?.getBoundingClientRect();
  const captureViewportHeight = scrollRect
    ? Math.min(window.innerHeight, Math.max(1, scrollRect.height))
    : window.innerHeight;

  return {
    width: Math.ceil(session.width),
    height: Math.ceil(session.height),
    dpr: session.dpr,
    viewport: {
      width: window.innerWidth,
      height: captureViewportHeight
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
  const clipRect = session.scrollParent
    ? intersectRects(rectToPlain(session.scrollParent.getBoundingClientRect()), {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight
    })
    : {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight
    };

  const visibleLeft = Math.max(clipRect.left, rect.left);
  const visibleTop = Math.max(clipRect.top, rect.top);
  const visibleRight = Math.min(clipRect.right, rect.right);
  const visibleBottom = Math.min(clipRect.bottom, rect.bottom);

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

function rectToPlain(rect) {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom
  };
}

function intersectRects(a, b) {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom)
  };
}

function restoreCaptureSession(session) {
  if (!session) return;

  restoreMaskedElements(session.maskedElements);
  restoreQrRecords(session.qrRecords);
  restoreHiddenElements(session.hiddenFloatingElements);

  if (session.scrollParent) {
    session.scrollParent.scrollTop = session.originalParentScrollTop;
    session.scrollParent.scrollLeft = session.originalParentScrollLeft;
  }

  window.scrollTo(session.originalWindowScroll.x, session.originalWindowScroll.y);
}

function restoreQrRecords(records = []) {
  for (const record of records.reverse()) {
    record.qr.remove();
    record.header.style.position = record.previousPosition;
    record.header.style.minHeight = record.previousMinHeight;
  }
}

function restoreMaskedElements(maskedElements = []) {
  for (const record of maskedElements.reverse()) {
    record.element.style.cssText = record.style;
    if (record.previousMask === null) {
      record.element.removeAttribute('data-facebook-post-capture-masked');
    } else {
      record.element.setAttribute('data-facebook-post-capture-masked', record.previousMask);
    }
  }
}

function hideFloatingCaptureObstructions(target) {
  const records = [];
  const targetRect = target.getBoundingClientRect();
  const targetArea = Math.max(1, targetRect.width * targetRect.height);
  const candidates = [...document.body.querySelectorAll('*')];

  for (const element of candidates) {
    if (element === target || target.contains(element) || element.contains(target)) continue;

    const style = window.getComputedStyle(element);
    if (style.position !== 'fixed' && style.position !== 'sticky') continue;
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

    const rect = element.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) continue;
    if (!rectsOverlap(rectToPlain(rect), rectToPlain(targetRect))) continue;

    const area = rect.width * rect.height;
    const isTooltip = element.matches('[role="tooltip"]') || element.querySelector('[role="tooltip"]');
    const isNavigationLike = element.matches('[role="navigation"], [role="banner"], [aria-label*="Facebook"], [aria-label*="Home"], [aria-label*="Trang chủ"]')
      || element.querySelector('[role="navigation"], [aria-label*="Home"], [aria-label*="Trang chủ"]');
    const isLargeOverlay = area / targetArea > 0.02 || rect.width > window.innerWidth * 0.45;

    if (!isTooltip && !isNavigationLike && !isLargeOverlay) continue;

    records.push({ element, visibility: element.style.visibility });
    element.style.setProperty('visibility', 'hidden', 'important');
  }

  return records;
}

function restoreHiddenElements(records = []) {
  for (const record of records.reverse()) {
    record.element.style.visibility = record.visibility;
  }
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
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
