const STORAGE_THEME = 'web-reader-theme';
const STORAGE_HISTORY = 'web-reader-history';
const STORAGE_FONT_SIZE = 'web-reader-font-size';
const STORAGE_FAVORITES = 'web-reader-favorites';
const STORAGE_MARKS = 'web-reader-marks';
const MAX_HISTORY_STORE = 200;
const MAX_HISTORY_DISPLAY = 10;
const READ_SPEED = 300;

const MSG_TIMEOUT =
  '【提示】连接超时，可能是目标网站（如维基百科）在国内访问不稳定，建议更换其他网址。';
const MSG_PARSE_FAIL =
  '【提示】当前网址无法被阅读器解析。建议使用阮一峰博客（ruanyifeng.com）、博客园（cnblogs.com）或CSDN等个人技术博客进行测试。';

const FONT_SIZES = {
  small: '16px',
  medium: '20px',
  large: '24px',
};

let currentArticle = null;
let currentSelection = null;
let currentMarks = {};
let currentMarkElement = null;

const $ = (sel) => document.querySelector(sel);

const viewWelcome = $('#viewWelcome');
const viewReading = $('#viewReading');
const urlInput = $('#urlInput');
const btnStart = $('#btnStart');
const btnBack = $('#btnBack');
const btnTheme = $('#btnTheme');
const btnExport = $('#btnExport');
const btnFocus = $('#btnFocus');
const btnFocusExit = $('#btnFocusExit');
const btnLinks = $('#btnLinks');
const btnClear = $('#btnClear');
const errorMsg = $('#errorMsg');
const loadingOverlay = $('#loadingOverlay');
const readingInner = $('#readingInner');
const articleTitle = $('#articleTitle');
const articleContent = $('#articleContent');
const metaWordCount = $('#metaWordCount');
const metaReadTime = $('#metaReadTime');
const historyList = $('#historyList');
const themeIcon = $('#themeIcon');
const fontControls = $('#fontControls');
const linkModal = $('#linkModal');
const linkModalBody = $('#linkModalBody');
const btnCloseLinks = $('#btnCloseLinks');
const btnFavorite = $('#btnFavorite');
const favoritesList = $('#favoritesList');
const btnClearFavorites = $('#btnClearFavorites');
const markToolbar = $('#markToolbar');
const btnMark = $('#btnMark');
const annotationModal = $('#annotationModal');
const annotationInput = $('#annotationInput');
const btnSaveAnnotation = $('#btnSaveAnnotation');
const btnDeleteMark = $('#btnDeleteMark');
const btnCancelAnnotation = $('#btnCancelAnnotation');
const fontButtons = document.querySelectorAll('.font-btn');

function getPublicOrigin() {
  return location.origin + location.pathname;
}

function initTheme() {
  const saved = localStorage.getItem(STORAGE_THEME);
  if (saved === 'dark') {
    document.body.classList.add('dark-theme');
  }
  updateThemeIcon();
}

function toggleTheme() {
  document.body.classList.toggle('dark-theme');
  const isDark = document.body.classList.contains('dark-theme');
  localStorage.setItem(STORAGE_THEME, isDark ? 'dark' : 'light');
  updateThemeIcon();
}

function updateThemeIcon() {
  if (!themeIcon) return;
  const isDark = document.body.classList.contains('dark-theme');
  themeIcon.textContent = isDark ? '☀️' : '🌙';
  btnTheme.title = isDark ? '切换为浅色模式' : '切换为深色模式';
}

function setFontSize(size) {
  const key = FONT_SIZES[size] ? size : 'medium';
  articleContent.style.setProperty('--reader-font-size', FONT_SIZES[key]);
  localStorage.setItem(STORAGE_FONT_SIZE, key);
  updateFontSizeButtons(key);
}

function updateFontSizeButtons(activeSize) {
  fontButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.size === activeSize);
  });
}

function initFontSize() {
  const saved = localStorage.getItem(STORAGE_FONT_SIZE) || 'medium';
  setFontSize(saved);
}

function showView(name) {
  const isReading = name === 'reading';
  viewWelcome.classList.toggle('active', !isReading);
  viewReading.classList.toggle('active', isReading);
  btnBack.classList.toggle('hidden', !isReading);
  btnExport.classList.toggle('hidden', !isReading);
  btnFocus.classList.toggle('hidden', !isReading);
  btnLinks.classList.toggle('hidden', !isReading);
  fontControls.classList.toggle('hidden', !isReading);
  if (!isReading) {
    exitFocusMode();
    closeLinkModal();
  }
}

function enterFocusMode() {
  document.body.classList.add('focus-mode');
  btnFocusExit.classList.remove('hidden');
}

function exitFocusMode() {
  document.body.classList.remove('focus-mode');
  btnFocusExit.classList.add('hidden');
}

function openLinkModal() {
  if (!articleContent) return;

  const seen = new Set();
  const links = [...articleContent.querySelectorAll('a')]
    .map((anchor) => ({
      href: anchor.href,
      text: anchor.textContent.trim() || anchor.href,
    }))
    .filter((link) => link.href && !link.href.startsWith('javascript:'))
    .filter((link) => {
      if (seen.has(link.href)) return false;
      seen.add(link.href);
      return true;
    });

  if (links.length === 0) {
    linkModalBody.innerHTML = '<p class="link-empty">正文中没有提取到链接</p>';
  } else {
    linkModalBody.innerHTML = `<ul class="link-list">${links
      .map(
        (link) =>
          `<li class="link-item"><a href="${escapeAttr(link.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.text)}（${escapeHtml(link.href)}）</a></li>`
      )
      .join('')}</ul>`;
  }

  linkModal.classList.remove('hidden');
}

function closeLinkModal() {
  linkModal.classList.add('hidden');
}

function showLoading() {
  loadingOverlay.classList.add('visible');
}

function hideLoading() {
  loadingOverlay.classList.remove('visible');
}

function clearReadingView() {
  currentArticle = null;
  articleTitle.textContent = '';
  articleContent.innerHTML = '';
  metaWordCount.textContent = '';
  metaReadTime.textContent = '';
  readingInner.classList.add('is-hidden');
  hideLoading();
  hideMarkToolbar();
  closeAnnotationModal();
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.add('visible');
}

function hideError() {
  errorMsg.classList.remove('visible');
}

function mapErrorMessage(err, response) {
  const raw = String(err?.message || '');
  const status = response?.status;

  if (
    status === 504 ||
    raw.includes('timed out') ||
    raw.includes('10 seconds')
  ) {
    return MSG_TIMEOUT;
  }

  return MSG_PARSE_FAIL;
}

function calcReadTime(wordCount) {
  return Math.max(1, Math.ceil(wordCount / READ_SPEED));
}

function renderArticle(data) {
  articleTitle.textContent = data.title || '无标题';
  articleContent.innerHTML = data.content || '';
  loadMarks();
  restoreMarks();
  metaWordCount.textContent = `${data.wordCount} 字`;
  metaReadTime.textContent = `约 ${calcReadTime(data.wordCount)} 分钟`;
  initFontSize();
  readingInner.classList.remove('is-hidden');
  updateFavoriteButton();
  hideLoading();
}

async function extractArticle(url) {
  hideError();
  showView('reading');
  readingInner.classList.add('is-hidden');
  showLoading();

  try {
    const res = await fetch(`/api/extract?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!res.ok) {
      throw Object.assign(new Error(data.error || '提取失败'), { response: res });
    }
    if (!data.success) {
      throw Object.assign(new Error('提取失败'), { response: res });
    }

    currentArticle = { ...data, url };
    renderArticle(data);
    addHistory({
      title: data.title || '无标题',
      url,
      time: Date.now(),
    });
  } catch (err) {
    hideLoading();
    showView('welcome');
    clearReadingView();
    showError(mapErrorMessage(err, err.response));
  }
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_HISTORY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(list) {
  localStorage.setItem(STORAGE_HISTORY, JSON.stringify(list));
}

function addHistory(item) {
  let list = getHistory().filter((h) => h.url !== item.url);
  list.unshift(item);
  if (list.length > MAX_HISTORY_STORE) {
    list = list.slice(0, MAX_HISTORY_STORE);
  }
  saveHistory(list);
  renderHistory();
}

function renderHistory() {
  const list = getHistory();
  const displayList = list.slice(0, MAX_HISTORY_DISPLAY);
  btnClear.disabled = list.length === 0;

  if (list.length === 0) {
    historyList.innerHTML = '<span class="history-empty">暂无记录</span>';
    return;
  }

  historyList.innerHTML = displayList
    .map(
      (h, i) =>
        `<button class="history-item" data-index="${i}" title="${escapeAttr(h.url)}">${escapeHtml(h.title || h.url)}</button>`
    )
    .join('');

  historyList.querySelectorAll('.history-item').forEach((el) => {
    el.addEventListener('click', () => {
      const item = displayList[Number(el.dataset.index)];
      urlInput.value = item.url;
      extractArticle(item.url);
    });
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function exportMarkdown() {
  if (!currentArticle) return;
  const title = currentArticle.title || 'article';
  const text = articleContent.innerText || '';
  const markdown = `# ${title}\n\n${text}`;
  const blob = new Blob([markdown], {
    type: 'text/markdown;charset=utf-8',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_FAVORITES)) || [];
  } catch {
    return [];
  }
}

function saveFavorites(list) {
  localStorage.setItem(STORAGE_FAVORITES, JSON.stringify(list));
}

function isFavorited(url) {
  return getFavorites().some((f) => f.url === url);
}

function toggleFavorite() {
  if (!currentArticle) return;
  const favs = getFavorites();
  const exists = favs.findIndex((f) => f.url === currentArticle.url);
  if (exists >= 0) {
    favs.splice(exists, 1);
  } else {
    favs.unshift({
      title: currentArticle.title || '无标题',
      url: currentArticle.url,
      time: Date.now(),
    });
  }
  saveFavorites(favs);
  updateFavoriteButton();
  renderFavorites();
}

function updateFavoriteButton() {
  if (!btnFavorite || !currentArticle) return;
  const favorited = isFavorited(currentArticle.url);
  btnFavorite.textContent = favorited ? '★' : '☆';
  btnFavorite.title = favorited ? '取消收藏' : '收藏';
  btnFavorite.classList.toggle('favorited', favorited);
}

function renderFavorites() {
  const list = getFavorites();
  btnClearFavorites.disabled = list.length === 0;

  if (list.length === 0) {
    favoritesList.innerHTML = '<span class="history-empty">暂无收藏</span>';
    return;
  }

  favoritesList.innerHTML = list
    .map(
      (f, i) =>
        `<button class="history-item" data-index="${i}" title="${escapeAttr(f.url)}">${escapeHtml(f.title)}</button>`
    )
    .join('');

  favoritesList.querySelectorAll('.history-item').forEach((el) => {
    el.addEventListener('click', () => {
      const item = list[Number(el.dataset.index)];
      urlInput.value = item.url;
      extractArticle(item.url);
    });
  });
}

function loadMarks() {
  const key = currentArticle?.url || 'unknown';
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_MARKS)) || {};
    currentMarks = all[key] || {};
  } catch {
    currentMarks = {};
  }
}

function saveMarks() {
  const key = currentArticle?.url || 'unknown';
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_MARKS)) || {};
    all[key] = currentMarks;
    localStorage.setItem(STORAGE_MARKS, JSON.stringify(all));
  } catch {
    // ignore storage errors
  }
}

function hideMarkToolbar() {
  if (markToolbar) markToolbar.classList.add('hidden');
}

function initMarkEvents() {
  document.addEventListener('mouseup', (e) => {
    if (!articleContent || !markToolbar) return;

    const selection = window.getSelection();
    const text = selection.toString().trim();
    if (
      text.length > 0 &&
      selection.rangeCount > 0 &&
      articleContent.contains(e.target)
    ) {
      currentSelection = selection;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      markToolbar.style.left = `${rect.left + rect.width / 2 - 30}px`;
      markToolbar.style.top = `${rect.top - 35}px`;
      markToolbar.classList.remove('hidden');
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (markToolbar && !markToolbar.contains(e.target)) {
      markToolbar.classList.add('hidden');
    }
  });

  btnMark.addEventListener('click', () => {
    if (!currentSelection || currentSelection.rangeCount === 0) return;

    const range = currentSelection.getRangeAt(0);
    const text = currentSelection.toString().trim();
    const markId = `m${Date.now()}`;

    const markEl = document.createElement('mark');
    markEl.classList.add('reader-mark');
    markEl.dataset.markId = markId;

    try {
      range.surroundContents(markEl);
    } catch {
      markToolbar.classList.add('hidden');
      currentSelection.removeAllRanges();
      return;
    }

    currentMarks[markId] = { text, note: '', time: Date.now() };
    markEl.title = '点击编辑批注';
    saveMarks();
    markToolbar.classList.add('hidden');
    currentSelection.removeAllRanges();
    currentSelection = null;
  });
}

function closeAnnotationModal() {
  if (annotationModal) annotationModal.classList.add('hidden');
  currentMarkElement = null;
}

function restoreMarks() {
  if (!articleContent || Object.keys(currentMarks).length === 0) return;

  Object.entries(currentMarks).forEach(([markId, data]) => {
    if (!data.text) return;
    if (articleContent.querySelector(`[data-mark-id="${markId}"]`)) return;

    const walker = document.createTreeWalker(articleContent, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('mark.reader-mark')) continue;

      const idx = node.textContent.indexOf(data.text);
      if (idx >= 0) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + data.text.length);
        const markEl = document.createElement('mark');
        markEl.classList.add('reader-mark');
        markEl.dataset.markId = markId;
        if (data.note) {
          markEl.classList.add('has-note');
          markEl.title = data.note;
        } else {
          markEl.title = '点击编辑批注';
        }
        try {
          range.surroundContents(markEl);
          break;
        } catch {
          // skip if range crosses element boundaries
        }
      }
    }
  });
}

function initAnnotationEvents() {
  document.addEventListener('click', (e) => {
    if (e.target.tagName === 'MARK' && e.target.classList.contains('reader-mark')) {
      currentMarkElement = e.target;
      const markId = e.target.dataset.markId;
      const data = currentMarks[markId] || {};
      annotationInput.value = data.note || '';
      annotationModal.classList.remove('hidden');
      hideMarkToolbar();
    }
  });

  btnSaveAnnotation.addEventListener('click', () => {
    if (!currentMarkElement) return;
    const markId = currentMarkElement.dataset.markId;
    const note = annotationInput.value.trim();

    if (!currentMarks[markId]) {
      currentMarks[markId] = {
        text: currentMarkElement.textContent.trim(),
        note: '',
        time: Date.now(),
      };
    }
    currentMarks[markId].note = note;
    currentMarks[markId].time = Date.now();
    saveMarks();

    if (note) {
      currentMarkElement.classList.add('has-note');
      currentMarkElement.title = note;
    } else {
      currentMarkElement.classList.remove('has-note');
      currentMarkElement.title = '点击编辑批注';
    }
    closeAnnotationModal();
  });

  btnDeleteMark.addEventListener('click', () => {
    if (!currentMarkElement) return;
    const markId = currentMarkElement.dataset.markId;
    const parent = currentMarkElement.parentNode;
    while (currentMarkElement.firstChild) {
      parent.insertBefore(currentMarkElement.firstChild, currentMarkElement);
    }
    parent.removeChild(currentMarkElement);
    delete currentMarks[markId];
    saveMarks();
    closeAnnotationModal();
  });

  btnCancelAnnotation.addEventListener('click', () => {
    closeAnnotationModal();
  });

  annotationModal.addEventListener('click', (e) => {
    if (e.target === annotationModal) closeAnnotationModal();
  });
}

function buildBookmarkCode() {
  const origin = getPublicOrigin();
  return `javascript:(function(){window.open('${origin}?url='+encodeURIComponent(location.href),'_blank');})();`;
}

async function copyText(text, onSuccess, onFail) {
  try {
    await navigator.clipboard.writeText(text);
    onSuccess();
  } catch {
    onFail();
  }
}

function initBookmarklet() {
  const code = buildBookmarkCode();
  const link = $('#bookmarklet');
  const codeEl = $('#bookmarkCode');

  link.href = code;
  codeEl.textContent = code;
  link.addEventListener('click', (e) => e.preventDefault());

  codeEl.addEventListener('click', () => {
    copyText(
      code,
      () => {
        codeEl.classList.add('copied');
        codeEl.title = '已复制！';
        setTimeout(() => {
          codeEl.classList.remove('copied');
          codeEl.title = '点击复制书签代码';
        }, 2000);
      },
      () => {
        codeEl.title = '复制失败，请手动选择复制';
      }
    );
  });
}

function initUrlParam() {
  const params = new URLSearchParams(location.search);
  const urlParam = params.get('url');
  if (!urlParam) return;

  urlInput.value = urlParam;
  history.replaceState(null, '', location.pathname);
  extractArticle(urlParam);
}

function bindEvents() {
  btnStart.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) {
      showError('请先粘贴文章链接');
      urlInput.focus();
      return;
    }
    btnStart.disabled = true;
    extractArticle(url).finally(() => {
      btnStart.disabled = false;
    });
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnStart.click();
  });

  urlInput.addEventListener('input', hideError);

  btnBack.addEventListener('click', () => {
    exitFocusMode();
    showView('welcome');
    clearReadingView();
  });

  btnTheme.addEventListener('click', toggleTheme);
  btnExport.addEventListener('click', exportMarkdown);
  btnFocus.addEventListener('click', enterFocusMode);
  btnFocusExit.addEventListener('click', exitFocusMode);
  btnLinks.addEventListener('click', openLinkModal);
  btnCloseLinks.addEventListener('click', closeLinkModal);

  linkModal.addEventListener('click', (e) => {
    if (e.target === linkModal) closeLinkModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!linkModal.classList.contains('hidden')) {
      closeLinkModal();
      return;
    }
    if (document.body.classList.contains('focus-mode')) {
      exitFocusMode();
    }
  });

  btnClear.addEventListener('click', () => {
    saveHistory([]);
    renderHistory();
  });

  btnFavorite.addEventListener('click', toggleFavorite);
  btnClearFavorites.addEventListener('click', () => {
    saveFavorites([]);
    renderFavorites();
    updateFavoriteButton();
  });

  fontButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setFontSize(btn.dataset.size);
    });
  });
}

function init() {
  initTheme();
  initFontSize();
  initBookmarklet();
  initMarkEvents();
  initAnnotationEvents();
  bindEvents();
  renderHistory();
  renderFavorites();
  initUrlParam();
}

const styleEl = document.createElement('style');
styleEl.textContent = `
  #articleContent, #articleContent * {
    font-size: var(--reader-font-size, 20px) !important;
  }
`;
document.head.appendChild(styleEl);

init();
