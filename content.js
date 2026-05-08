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
  // ChatGPT renders messages in article elements inside a main scroll container
  messageList: 'main [class*="react-scroll-to-bottom"]',
  messageListFallback: 'main',
  // Each turn is an article
  article: 'article[data-testid^="conversation-turn"]',
  // The streaming indicator SVG that appears while AI is typing
  streamingIndicator: '[data-testid="stop-button"], button[aria-label="Stop streaming"]',
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
function collapseCodeBlock(pre) {
  if (pre.dataset.gptCollapsed) return;
  const code = pre.querySelector('code');
  if (!code) return;

  const lines = code.textContent.split('\n').length;
  if (lines <= settings.codeBlockThreshold) return;

  // Detect language from class (e.g. "language-python")
  const langMatch = [...(code.classList || [])].find((c) =>
    c.startsWith('language-')
  );
  const lang = langMatch ? langMatch.replace('language-', '') : 'code';

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
    <button class="gpt-toggle-btn" aria-expanded="false">Expand ▼</button>
  `;
  wrapper.insertBefore(header, pre);

  header.querySelector('.gpt-toggle-btn').addEventListener('click', () => {
    toggleBlock(wrapper);
  });
}

function expandCodeBlock(wrapper) {
  wrapper.classList.remove('collapsed');
  const btn = wrapper.querySelector('.gpt-toggle-btn');
  if (btn) { btn.textContent = 'Collapse ▲'; btn.setAttribute('aria-expanded', 'true'); }
}

function collapseCodeBlockWrapper(wrapper) {
  wrapper.classList.add('collapsed');
  const btn = wrapper.querySelector('.gpt-toggle-btn');
  if (btn) { btn.textContent = 'Expand ▼'; btn.setAttribute('aria-expanded', 'false'); }
}

function toggleBlock(wrapper) {
  if (wrapper.classList.contains('collapsed')) expandCodeBlock(wrapper);
  else collapseCodeBlockWrapper(wrapper);
}

// ─── Long message collapse ────────────────────────────────────────────────────
function collapseMessage(article) {
  // Only collapse completed (non-streaming) messages
  if (article.dataset.gptMsgCollapsed) return;

  // Find the prose container (ChatGPT wraps message text in a div.markdown)
  const prose = article.querySelector('.markdown, [class*="prose"]');
  if (!prose) return;

  const text = prose.textContent || '';
  if (text.length <= settings.messageThreshold) return;

  // Skip the latest message (the one currently being answered)
  const articles = [...document.querySelectorAll(SELECTORS.article)];
  const isLatest = articles[articles.length - 1] === article;
  if (isLatest) return;

  article.dataset.gptMsgCollapsed = 'true';

  const wrapper = document.createElement('div');
  wrapper.className = 'gpt-collapse-wrapper gpt-msg-wrapper collapsed';
  prose.parentNode.insertBefore(wrapper, prose);
  wrapper.appendChild(prose);

  const footer = document.createElement('div');
  footer.className = 'gpt-msg-footer';
  footer.innerHTML = `<button class="gpt-toggle-btn" aria-expanded="false">Expand ▼</button>`;
  wrapper.appendChild(footer);

  footer.querySelector('.gpt-toggle-btn').addEventListener('click', () => {
    toggleBlock(wrapper);
  });
}

// ─── Auto-collapse all eligible old messages ──────────────────────────────────
function autoCollapseAll() {
  const articles = [...document.querySelectorAll(SELECTORS.article)];
  // Leave the last two (user prompt + streaming AI reply) untouched
  const toCollapse = articles.slice(0, -2);

  toCollapse.forEach((article) => {
    // Collapse oversized code blocks inside this message
    article.querySelectorAll('pre').forEach(collapseCodeBlock);
    // Collapse the message itself if it's long
    collapseMessage(article);
  });
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
    document.querySelectorAll('.gpt-collapse-wrapper:not(.collapsed)').forEach(collapseCodeBlockWrapper);
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
  console.log('[GPT Helper] v0.1 loaded ⚡', settings);
});
