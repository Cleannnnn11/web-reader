const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const FETCH_TIMEOUT = 10000;
const SHORT_CONTENT_THRESHOLD = 200;
// 正文超过此长度时始终使用 Readability，不触发短内容回退（验收12）
const NORMAL_CONTENT_THRESHOLD = 500;

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7',
};

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const REMOVE_KEYWORDS = {
  sidebarAd: [
    'sidebar',
    'aside',
    'ad',
    'ads',
    'advertisement',
    'recommend',
    'hot',
    'popular',
    'download-app',
    'app-download',
  ],
  comment: ['comment', 'comments', 'reply', 'discuss', 'social-section'],
  related: ['related', 'recommend-list', 'guess-you-like', 'also-read'],
};

const ALL_REMOVE_KEYWORDS = [
  ...REMOVE_KEYWORDS.sidebarAd,
  ...REMOVE_KEYWORDS.comment,
  ...REMOVE_KEYWORDS.related,
];

const SITE_ADAPTERS = [
  {
    name: 'sina',
    match: (url) => {
      const host = new URL(url).hostname;
      return host.includes('sina.com.cn') || host.includes('sina.cn');
    },
    selectors: ['#artibody', '.article', '.main-content'],
    titleSelectors: ['h1.main-title', 'h1.title', 'h1', '.article-title'],
    removeSelectors: ['.otherContent_01', '.appendQr_wrap', '.article-editor'],
  },
  {
    name: 'csdn',
    match: (url) => new URL(url).hostname.includes('csdn.net'),
    selectors: ['#article_content', '.article_content', '#content_views'],
    titleSelectors: ['.title-article', 'h1.title-article', 'h1'],
    removeSelectors: [
      '.hide-article-box',
      '.modal',
      '.mask',
      '.pay-mark',
      '.vip-mask',
      '.login-mark',
      '.follow-button',
      '.recommend-box',
      '.more-toolbox',
      '.tool-box',
      '[class*="popup"]',
      '[class*="modal"]',
      '[class*="pay"]',
      '[class*="vip-limit"]',
    ],
  },
  {
    name: 'sohu',
    match: (url) => new URL(url).hostname.includes('sohu.com'),
    selectors: ['.article', '.text', '#mp-editor', '.article-text'],
    titleSelectors: ['.text-title', 'h1', '.article-title'],
    removeSelectors: [
      '.article-list',
      '.god_header',
      '.business-recommend',
      '.recommend',
      '.footer-info',
      '.bottom-bar',
      '[class*="related"]',
      '[class*="advert"]',
      '[class*="copyright"]',
      '[class*="footer"]',
      '[id*="copyright"]',
      '[id*="footer"]',
      '[class*="jubao"]',
      '[id*="jubao"]',
    ],
  },
  {
    name: 'netease',
    match: (url) => new URL(url).hostname.includes('163.com'),
    selectors: ['.post_body', '.post_content', '.post_text'],
    titleSelectors: ['.post_title', 'h1', '.title'],
    removeSelectors: [
      '.post_tags',
      '.post_comment',
      '.post_topshare',
      '.post_recommend',
      '.ne-shares-pop',
      '.gg200x300',
    ],
  },
];

// 知乎适配层 —— 预留扩展，知乎作为问答平台非本项目核心场景
/*
function isZhihuUrl(url) {
  return typeof url === 'string' && url.includes('zhihu.com');
}

function parseZhihuInitialData(document) {
  const script =
    document.querySelector('script#js-initialData[type="text/json"]') ||
    document.querySelector('script#js-initialData');
  const raw = script?.textContent?.trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getZhihuEntities(data) {
  return data?.initialState?.entities || data?.entities || {};
}

function htmlToPlainText(html) {
  if (!html) return '';
  return cheerio.load(html).text().trim();
}

function wrapZhihuHtml(htmlContent) {
  return `<div class="article-content page zhihu-content">${htmlContent}</div>`;
}

function buildZhihuResult(title, htmlContent) {
  const plain = htmlToPlainText(htmlContent);
  if (!plain && !htmlContent?.trim()) return null;

  const content = wrapZhihuHtml(htmlContent);
  return {
    title: title?.trim() || '无标题',
    textContent: plain,
    content: cleanArticleContent(content),
    engine: 'zhihu-json',
  };
}

function pickZhihuAnswer(answers, pageUrl) {
  if (!answers || typeof answers !== 'object') return null;

  const answerMatch = pageUrl.match(/answer\/(\d+)/);
  if (answerMatch && answers[answerMatch[1]]) {
    return answers[answerMatch[1]];
  }

  const list = Object.values(answers);
  if (!list.length) return null;

  return list.sort(
    (a, b) => getContentLength(b.content || '') - getContentLength(a.content || '')
  )[0];
}

function pickZhihuArticle(articles, pageUrl) {
  if (!articles || typeof articles !== 'object') return null;

  const articleMatch = pageUrl.match(/\/p\/(\d+)/);
  if (articleMatch && articles[articleMatch[1]]) {
    return articles[articleMatch[1]];
  }

  const list = Object.values(articles);
  if (!list.length) return null;

  return list.sort(
    (a, b) => getContentLength(b.content || '') - getContentLength(a.content || '')
  )[0];
}

function resolveZhihuQuestionTitle(questions, answer) {
  if (!answer) return '';

  const questionRef = answer.question;
  if (questionRef && typeof questionRef === 'object' && questionRef.title) {
    return questionRef.title;
  }

  const questionId = String(
    answer.questionId || (typeof questionRef === 'string' ? questionRef : questionRef?.id) || ''
  );

  if (questionId && questions?.[questionId]?.title) {
    return questions[questionId].title;
  }

  return '';
}

function extractZhihuFromDocument(document, pageUrl) {
  if (!isZhihuUrl(pageUrl)) return null;

  try {
    const data = parseZhihuInitialData(document);
    if (!data) return null;

    const entities = getZhihuEntities(data);
    const answers = entities.answers || data.answers;
    const articles = entities.articles || data.article || data.articles;
    const questions = entities.questions || data.questions;
    const pageTitle = getPageTitle(document);

    if (pageUrl.includes('/p/') && articles) {
      const article = pickZhihuArticle(articles, pageUrl);
      const htmlContent = article?.content;
      if (htmlContent) {
        const title = article.title || pageTitle;
        return buildZhihuResult(title, htmlContent);
      }
    }

    if (answers) {
      const answer = pickZhihuAnswer(answers, pageUrl);
      const htmlContent = answer?.content;
      if (htmlContent) {
        const questionTitle = resolveZhihuQuestionTitle(questions, answer);
        const title = questionTitle || answer.title || pageTitle;
        return buildZhihuResult(title, htmlContent);
      }
    }

    if (articles && !pageUrl.includes('/answer/')) {
      const article = pickZhihuArticle(articles, pageUrl);
      const htmlContent = article?.content;
      if (htmlContent) {
        return buildZhihuResult(article.title || pageTitle, htmlContent);
      }
    }

    return null;
  } catch (err) {
    console.error('Zhihu extract error:', err.message);
    return null;
  }
}
*/

function getSiteAdapter(url) {
  try {
    return SITE_ADAPTERS.find((adapter) => adapter.match(url)) || null;
  } catch {
    return null;
  }
}

function removeBySelectors(root, selectors) {
  selectors.forEach((selector) => {
    root.querySelectorAll(selector).forEach((element) => element.remove());
  });
}

function applySiteCleanup(document, adapter) {
  if (adapter?.removeSelectors?.length) {
    removeBySelectors(document, adapter.removeSelectors);
  }
  if (adapter?.name === 'sohu') {
    applySohuRules(document.body);
  }
}

function applySohuRules(root) {
  if (!root) return;

  const idKeywords = ['copyright', 'footer', 'jubao'];
  const textKeywords = ['举报', '意见反馈', '客服热线', 'Copyright ©'];

  [...root.querySelectorAll('*')]
    .sort((a, b) => getDepth(b) - getDepth(a))
    .forEach((element) => {
      if (!element.parentNode) return;

      const identifier = getElementIdentifier(element);
      if (idKeywords.some((keyword) => identifier.includes(keyword))) {
        element.remove();
        return;
      }

      const text = element.textContent?.trim() || '';
      if (
        textKeywords.some((keyword) => text.includes(keyword)) &&
        getContentLength(text) < 300
      ) {
        element.remove();
      }
    });
}

function findContentElement(document, selectors) {
  let bestElement = null;
  let bestLength = 0;

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      const length = getContentLength(element.textContent);
      if (length > bestLength) {
        bestLength = length;
        bestElement = element;
      }
    });
  });

  return bestLength >= 50 ? bestElement : null;
}

function extractSiteTitle(document, adapter) {
  const selectors = adapter.titleSelectors || ['h1'];
  for (const selector of selectors) {
    const title = document.querySelector(selector)?.textContent?.trim();
    if (title) return title;
  }
  return null;
}

function extractBySiteAdapter(document, adapter, pageTitle) {
  const contentElement = findContentElement(document, adapter.selectors);
  if (!contentElement) return null;

  const clone = contentElement.cloneNode(true);
  if (adapter.removeSelectors?.length) {
    removeBySelectors(clone, adapter.removeSelectors);
  }
  if (adapter.name === 'sohu') {
    applySohuRules(clone);
  }
  cleanContentElement(clone);

  const textContent = clone.textContent.trim();
  if (!textContent) return null;

  const html = `<div class="article-content page">${clone.innerHTML}</div>`;
  return {
    title: extractSiteTitle(document, adapter) || pageTitle,
    textContent,
    content: cleanArticleContent(html),
    engine: `site-${adapter.name}`,
  };
}

function shouldUseExtractedContent(result) {
  return result && getContentLength(result.textContent) >= SHORT_CONTENT_THRESHOLD;
}

function getElementIdentifier(element) {
  const id = element.id || '';
  const className =
    typeof element.className === 'string'
      ? element.className
      : element.className?.baseVal || '';
  return `${id} ${className}`.toLowerCase();
}

function matchesRemoveKeyword(element) {
  const identifier = getElementIdentifier(element);
  return ALL_REMOVE_KEYWORDS.some((keyword) => identifier.includes(keyword));
}

function getDepth(element) {
  let depth = 0;
  let current = element;
  while (current.parentElement) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

function isArticleImage(img, contentRoot) {
  let parent = img.parentElement;
  while (parent && parent !== contentRoot) {
    if (matchesRemoveKeyword(parent)) {
      return false;
    }
    parent = parent.parentElement;
  }
  return contentRoot.contains(img);
}

function preserveArticleImages(contentRoot) {
  contentRoot.querySelectorAll('img').forEach((img) => {
    const src =
      img.getAttribute('src') ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-original');
    if (src) {
      img.setAttribute('src', src);
    }
  });
}

function cleanHtml(document, options = {}) {
  const scope = document.body;
  if (!scope) return;

  const { protectArticleImages = false } = options;
  let contentRoot = null;

  if (protectArticleImages) {
    contentRoot =
      scope.querySelector('.article-content') ||
      scope.querySelector('.page') ||
      scope.querySelector('[id^="readability-page"]') ||
      scope.firstElementChild;

    if (contentRoot && !contentRoot.classList.contains('article-content')) {
      contentRoot.classList.add('article-content');
    }
  }

  const matches = [...scope.querySelectorAll('*')].filter(matchesRemoveKeyword);
  matches.sort((a, b) => getDepth(b) - getDepth(a));

  for (const element of matches) {
    if (!element.parentNode) continue;

    if (protectArticleImages && contentRoot) {
      const hasProtectedImg = [...element.querySelectorAll('img')].some(
        (img) => contentRoot.contains(img) && isArticleImage(img, contentRoot)
      );
      if (hasProtectedImg) continue;
    }

    element.remove();
  }

  if (protectArticleImages && contentRoot) {
    preserveArticleImages(contentRoot);
  }
}

function cleanContentElement(element) {
  if (!element) return;

  element.classList.add('article-content');
  const matches = [...element.querySelectorAll('*')].filter(matchesRemoveKeyword);
  matches.sort((a, b) => getDepth(b) - getDepth(a));

  for (const node of matches) {
    if (!node.parentNode) continue;
    const hasProtectedImg = [...node.querySelectorAll('img')].some(
      (img) => element.contains(img) && isArticleImage(img, element)
    );
    if (hasProtectedImg) continue;
    node.remove();
  }

  preserveArticleImages(element);
}

function cleanArticleContent(html) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
  cleanHtml(dom.window.document, { protectArticleImages: true });
  const contentRoot =
    dom.window.document.querySelector('.article-content') ||
    dom.window.document.body.firstElementChild;
  if (contentRoot) contentRoot.removeAttribute('style');
  return contentRoot ? contentRoot.outerHTML : html;
}

const LAZY_SRC_ATTRS = [
  'data-original', 
  'data-src', 
  'data-lazy-src', 
  'data-real-src',
  'data-src-real',
  'data-src-original', 
  'data-original-src'
];

function fixLazyLoadImages(html) {
  if (!html) return html;

  const $ = cheerio.load(html, null, false);

  $('img').each(function () {
    const $img = $(this);
    let src = ($img.attr('src') || '').trim();
    
    // 如果 src 无效，尝试从各种属性取
    if (!src || src.startsWith('data:') || src === '') {
      for (const attr of LAZY_SRC_ATTRS) {
        const value = ($img.attr(attr) || '').trim();
        if (value && !value.startsWith('data:') && value !== '') {
          src = value;
          break;
        }
      }
      if (src) {
        $img.attr('src', src);
      }
    }
    
    // 移除所有懒加载属性
    LAZY_SRC_ATTRS.forEach((attr) => {
      $img.removeAttr(attr);
    });

    // 兜底方案：从 srcset 中提取最后一个 URL
    if (!$img.attr('src') || $img.attr('src').startsWith('data:')) {
      const srcset = ($img.attr('srcset') || '').trim();
      if (srcset) {
        const parts = srcset.split(',').map((s) => s.trim());
        if (parts.length > 0) {
          const lastPart = parts[parts.length - 1];
          const url = lastPart.split(/\s+/)[0];
          if (url && url.startsWith('http')) {
            $img.attr('src', url);
          }
        }
      }
    }
  });

  return $.html();
}

function fixImageUrls(html, baseUrl) {
  if (!html || !baseUrl) return html;

  const $ = cheerio.load(html, null, false);

  $('img').each(function () {
    const src = $(this).attr('src');
    if (!src || src.startsWith('http') || src.startsWith('data:')) return;

    try {
      const absoluteUrl = new URL(src, baseUrl).href;
      $(this).attr('src', absoluteUrl);
    } catch {
      // 保留无法解析的 src
    }
  });

  return $.html();
}

function getWordCount(text) {
  if (!text) return 0;
  return text.replace(/\s/g, '').length;
}

function getContentLength(text) {
  return getWordCount(text);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textToArticleHtml(text) {
  const paragraphs = text
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const body = paragraphs.length
    ? paragraphs.map((part) => `<p>${escapeHtml(part)}</p>`).join('')
    : `<p>${escapeHtml(text)}</p>`;
  return `<div class="article-content page">${body}</div>`;
}

function getPageTitle(document) {
  return (
    document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
    document.title?.trim() ||
    '无标题'
  );
}

function extractParagraphText(document) {
  return [...document.querySelectorAll('p')]
    .map((paragraph) => paragraph.textContent.trim())
    .filter(Boolean)
    .join('\n');
}

function extractMetaDescription(document) {
  const meta =
    document.querySelector('meta[name="description"]') ||
    document.querySelector('meta[property="og:description"]');
  return meta?.getAttribute('content')?.trim() || '';
}

function resolveShortContentFallback(document, title) {
  const paragraphText = extractParagraphText(document);
  if (paragraphText) {
    return {
      title,
      textContent: paragraphText,
      content: textToArticleHtml(paragraphText),
      engine: 'paragraphs',
    };
  }

  const description = extractMetaDescription(document);
  if (description) {
    return {
      title,
      textContent: description,
      content: textToArticleHtml(description),
      engine: 'meta-description',
    };
  }

  const stub = `${title}（短内容，无完整正文）`;
  return {
    title,
    textContent: stub,
    content: textToArticleHtml(stub),
    engine: 'title-stub',
  };
}

function shouldUseReadability(article) {
  if (!article?.textContent) return false;
  const length = getContentLength(article.textContent);
  if (length > NORMAL_CONTENT_THRESHOLD) return true;
  return length >= SHORT_CONTENT_THRESHOLD;
}

function extractWithFallback(document, pageUrl) {
  const pageTitle = getPageTitle(document);

  const adapter = pageUrl ? getSiteAdapter(pageUrl) : null;

  if (adapter) {
    applySiteCleanup(document, adapter);
    const siteResult = extractBySiteAdapter(document, adapter, pageTitle);
    if (shouldUseExtractedContent(siteResult)) {
      return siteResult;
    }
  }

  // ========== 懒加载图片修复 ==========
  // 在 Readability 提取之前，将懒加载图片的真实 URL 还原到 src 属性
  // 否则 Readability 会认为这些图片无效而丢弃它们
  document.querySelectorAll('img').forEach((img) => {
    const src = (img.getAttribute('src') || '').trim();

    const isPlaceholder =
      !src ||
      src.startsWith('data:') ||
      src.length < 10 ||
      src.includes('loading') ||
      src.includes('placeholder') ||
      src.includes('1x1');

    if (isPlaceholder) {
      const realSrc =
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-url') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('data-real-src');

      if (realSrc && realSrc.trim()) {
        img.setAttribute('src', realSrc.trim());
      }
    }
  });
  // ========== 懒加载图片修复结束 ==========

  const reader = new Readability(document);
  const article = reader.parse();

  if (article && shouldUseReadability(article)) {
    return {
      title: article.title || pageTitle,
      textContent: article.textContent,
      content: cleanArticleContent(article.content),
      engine: 'readability',
    };
  }

  if (adapter) {
    const siteResult = extractBySiteAdapter(document, adapter, pageTitle);
    if (siteResult && getContentLength(siteResult.textContent) > 0) {
      return siteResult;
    }
  }

  return resolveShortContentFallback(document, article?.title || pageTitle);
}

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function fetchPage(url) {
  let lastError;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await axios.get(url, {
        timeout: FETCH_TIMEOUT,
        responseType: 'text',
        headers: FETCH_HEADERS,
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400,
      });
    } catch (err) {
      lastError = err;
      if (attempt === 0) {
        continue;
      }
    }
  }

  throw lastError;
}

app.get('/api/extract', async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing required query parameter: url' });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid url parameter' });
  }

  try {
    const response = await fetchPage(url);

    const dom = new JSDOM(response.data, { url });
    const adapter = getSiteAdapter(url);
    if (adapter) {
      applySiteCleanup(dom.window.document, adapter);
    }
    cleanHtml(dom.window.document);

    const result = extractWithFallback(dom.window.document, url);
    const wordCount = getWordCount(result.textContent);
    const content = fixImageUrls(fixLazyLoadImages(result.content), url);

    res.json({
      success: true,
      title: result.title,
      content,
      wordCount,
    });
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      return res.status(504).json({ error: 'Request timed out after 10 seconds' });
    }

    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      return res.status(502).json({
        error: status
          ? `Failed to fetch page (HTTP ${status})`
          : `Failed to fetch page: ${err.message}`,
      });
    }

    console.error('Extract error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
