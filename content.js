/**
 * GPT Helper — content script
 * Injected into chat.openai.com / chatgpt.com
 */

// ─── Default settings (overridden by chrome.storage.sync) ────────────────────
const DEFAULTS = {
  codeBlockThreshold: 20,   // lines
  messageThreshold: 500,    // characters
  animationsEnabled: true,
};

let settings = { ...DEFAULTS };

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettings(cb) {
  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored };
    cb && cb(settings);
  });
}

chrome.storage.onChanged.addListener((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) {
    settings[key] = newValue;
  }
  applyAnimationClass();
});

function applyAnimationClass() {
  document.documentElement.classList.toggle(
    'gpt-helper-no-anim',
    !settings.animationsEnabled
  );
}

// ─── MutationObserver: detect streaming vs complete ───────────────────────────
let observer = null;
let isStreaming = false;

const SELECTORS = {
  messageList: 'main [class*="react-scroll-to-bottom"]',
  messageListFallback: 'main',
  // ChatGPT uses both article and div depending on version
  article: [
    'article[data-testid^="conversation-turn"]',
    'div[data-testid^="conversation-turn"]',
    '[data-message-author-role]',        // fallback: individual message bubbles
  ].join(', '),
  // Prose content inside a message
  prose: '.markdown.prose, .markdown, [class*="prose"], [class*="message-content"], [data-message-author-role] > div',
  streamingIndicator: '[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="停止生成"]',
  // CodeMirror-rendered code blocks (ChatGPT's current renderer)
  codeBlock: 'pre[class*="cm-"], pre.cm-content, pre:has(code)',
};

function getMessageList() {
  return (
    document.querySelector(SELECTORS.messageList) ||
    document.querySelector(SELECTORS.messageListFallback)
  );
}

function checkStreaming() {
  return !!document.querySelector(SELECTORS.streamingIndicator);
}

function onStreamingStart() {
  if (isStreaming) return;
  isStreaming = true;
  console.log('[GPT Helper] streaming started — auto-collapsing old messages');
  autoCollapseAll();
}

function onStreamingEnd() {
  if (!isStreaming) return;
  isStreaming = false;
  console.log('[GPT Helper] streaming ended');
}

function startObserver() {
  if (observer) observer.disconnect();

  const root = getMessageList();
  if (!root) return;

  observer = new MutationObserver(() => {
    const streaming = checkStreaming();
    if (streaming && !isStreaming) onStreamingStart();
    else if (!streaming && isStreaming) onStreamingEnd();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.log('[GPT Helper] MutationObserver active');
}

// Re-init on SPA navigation using history API interception (no MutationObserver polling)
let navTimer = null;
function onNavigate() {
  clearTimeout(navTimer);
  navTimer = setTimeout(() => {
    isStreaming = false;
    startObserver();
    // Only re-inject FAB if it was removed by the page transition
    if (!document.getElementById('gpt-helper-fab')) injectFAB();
  }, 600);
}

// Intercept pushState / replaceState (React Router / Next.js use these)
['pushState', 'replaceState'].forEach((method) => {
  const orig = history[method];
  history[method] = function (...args) {
    orig.apply(this, args);
    onNavigate();
  };
});
window.addEventListener('popstate', onNavigate);

// ─── Code block collapse ──────────────────────────────────────────────────────
function countCodeLines(pre) {
  // CodeMirror: lines are separated by <br> tags inside spans
  const brs = pre.querySelectorAll('br').length;
  if (brs > 0) return brs + 1;
  // Standard: count newlines in textContent
  return (pre.textContent || '').split('\n').filter((l, i, a) =>
    !(i === a.length - 1 && l === '')
  ).length;
}

function detectLanguage(pre) {
  // CodeMirror puts language in a sibling/parent element or data attribute
  const container = pre.closest('[class*="language-"], [data-lang], [class*="lang-"]');
  if (container) {
    const cls = [...container.classList].find(c => c.startsWith('language-') || c.startsWith('lang-'));
    if (cls) return cls.replace(/^(language-|lang-)/, '');
    if (container.dataset.lang) return container.dataset.lang;
  }
  // Try the pre itself or its code child
  const code = pre.querySelector('code');
  const target = code || pre;
  const cls = [...(target.classList || [])].find(c =>
    c.startsWith('language-') || c.startsWith('lang-')
  );
  return cls ? cls.replace(/^(language-|lang-)/, '') : 'code';
}

function collapseCodeBlock(pre) {
  if (pre.dataset.gptCollapsed) return;

  const lines = countCodeLines(pre);
  if (lines <= settings.codeBlockThreshold) return;

  const lang = detectLanguage(pre);

  pre.dataset.gptCollapsed = 'true';
  pre.dataset.gptLines = lines;

  const wrapper = document.createElement('div');
  wrapper.className = 'gpt-collapse-wrapper gpt-code-wrapper collapsed';
  pre.parentNode.insertBefore(wrapper, pre);
  wrapper.appendChild(pre);

  const header = document.createElement('div');
  header.className = 'gpt-collapse-header';
  header.innerHTML = `
    <span class="gpt-lang-tag">${lang}</span>
    <span class="gpt-line-count">${lines} lines</span>
    <button class="gpt-toggle-btn" aria-expanded="false">Show code ▼</button>
  `;
  wrapper.insertBefore(header, pre);

  header.querySelector('.gpt-toggle-btn').addEventListener('click', () => {
    toggleBlock(wrapper);
  });
}

function expandCodeBlock(wrapper) {
  wrapper.classList.remove('collapsed');
  const btn = wrapper.querySelector('.gpt-toggle-btn');
  if (btn) { btn.textContent = 'Hide code ▲'; btn.setAttribute('aria-expanded', 'true'); }
}

function collapseCodeBlockWrapper(wrapper) {
  wrapper.classList.add('collapsed');
  const btn = wrapper.querySelector('.gpt-toggle-btn');
  if (btn) { btn.textContent = 'Show code ▼'; btn.setAttribute('aria-expanded', 'false'); }
}

function toggleBlock(wrapper) {
  if (wrapper.classList.contains('collapsed')) expandCodeBlock(wrapper);
  else collapseCodeBlockWrapper(wrapper);
}

// ─── Long message collapse ────────────────────────────────────────────────────
function collapseMessage(article, force = false) {
  // Only collapse completed (non-streaming) messages
  if (article.dataset.gptMsgCollapsed) return;

  // Find the prose container (ChatGPT wraps message text in a div.markdown)
  const prose = article.querySelector(SELECTORS.prose);
  if (!prose) return;

  const text = prose.textContent || '';
  if (text.length <= settings.messageThreshold) return;

  // Skip the latest message unless forced (e.g. from FAB "Collapse all")
  if (!force) {
    const articles = [...document.querySelectorAll(SELECTORS.article)];
    const isLatest = articles[articles.length - 1] === article;
    if (isLatest) return;
  }

  article.dataset.gptMsgCollapsed = 'true';

  const wrapper = document.createElement('div');
  wrapper.className = 'gpt-collapse-wrapper gpt-msg-wrapper collapsed';
  prose.parentNode.insertBefore(wrapper, prose);
  wrapper.appendChild(prose);

  const footer = document.createElement('div');
  footer.className = 'gpt-msg-footer';
  footer.innerHTML = `<button class="gpt-toggle-btn" aria-expanded="false">Show more ↓</button>`;
  wrapper.appendChild(footer);

  footer.querySelector('.gpt-toggle-btn').addEventListener('click', () => {
    toggleBlock(wrapper);
  });
}

// ─── Auto-collapse all eligible old messages ──────────────────────────────────
function autoCollapseAll() {
  const articles = [...document.querySelectorAll(SELECTORS.article)];
  if (articles.length > 0) {
    // Leave the last two (user prompt + streaming AI reply) untouched
    articles.slice(0, -2).forEach((article) => {
      article.querySelectorAll(SELECTORS.codeBlock).forEach(collapseCodeBlock);
      collapseMessage(article, false);
    });
  } else {
    // Fallback: no article selector matched, collapse all code blocks on page
    document.querySelectorAll(SELECTORS.codeBlock).forEach(collapseCodeBlock);
  }
}

// Collapse every message in the conversation (called from FAB "Collapse all")
function collapseAllNow() {
  const articles = [...document.querySelectorAll(SELECTORS.article)];
  if (articles.length > 0) {
    articles.forEach((article) => {
      article.querySelectorAll(SELECTORS.codeBlock).forEach(collapseCodeBlock);
      collapseMessage(article, true);
    });
  } else {
    // Fallback: collapse all code blocks on page directly
    document.querySelectorAll(SELECTORS.codeBlock).forEach(collapseCodeBlock);
  }
  document.querySelectorAll('.gpt-collapse-wrapper:not(.collapsed)').forEach(collapseCodeBlockWrapper);
}

// ─── FAB (Floating Action Button) ────────────────────────────────────────────
function injectFAB() {
  document.getElementById('gpt-helper-fab')?.remove();

  const fab = document.createElement('div');
  fab.id = 'gpt-helper-fab';
  fab.setAttribute('role', 'toolbar');
  fab.setAttribute('aria-label', 'GPT Helper controls');
  fab.innerHTML = `
    <button id="gpt-fab-icon" aria-label="GPT Helper" title="GPT Helper">⚡</button>
    <div id="gpt-fab-menu">
      <button id="gpt-collapse-all">Collapse all</button>
      <button id="gpt-expand-all">Expand all</button>
    </div>
  `;
  document.body.appendChild(fab);

  document.getElementById('gpt-fab-icon').addEventListener('click', () => {
    fab.classList.toggle('open');
  });

  document.getElementById('gpt-collapse-all').addEventListener('click', () => {
    collapseAllNow();
    fab.classList.remove('open');
  });

  document.getElementById('gpt-expand-all').addEventListener('click', () => {
    document.querySelectorAll('.gpt-collapse-wrapper.collapsed').forEach(expandCodeBlock);
    fab.classList.remove('open');
  });

  // Close FAB menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!fab.contains(e.target)) fab.classList.remove('open');
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
loadSettings(() => {
  applyAnimationClass();
  startObserver();
  injectFAB();
  const articleCount = document.querySelectorAll(SELECTORS.article).length;
  const codeBlockCount = document.querySelectorAll(SELECTORS.codeBlock).length;
  console.log(`[GPT Helper] v0.1 loaded ⚡ — ${articleCount} turn(s), ${codeBlockCount} code block(s)`, settings);
});
