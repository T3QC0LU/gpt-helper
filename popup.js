const DEFAULTS = {
  codeBlockThreshold: 20,
  messageThreshold: 500,
  animationsEnabled: true,
};

const fields = ['codeBlockThreshold', 'messageThreshold', 'animationsEnabled'];
const statusEl = document.getElementById('status');

// Load current settings into inputs
chrome.storage.sync.get(DEFAULTS, (stored) => {
  document.getElementById('codeBlockThreshold').value = stored.codeBlockThreshold;
  document.getElementById('messageThreshold').value = stored.messageThreshold;
  document.getElementById('animationsEnabled').checked = stored.animationsEnabled;
});

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

function save() {
  const updates = {
    codeBlockThreshold: parseInt(document.getElementById('codeBlockThreshold').value, 10),
    messageThreshold: parseInt(document.getElementById('messageThreshold').value, 10),
    animationsEnabled: document.getElementById('animationsEnabled').checked,
  };
  chrome.storage.sync.set(updates, () => {
    statusEl.textContent = 'Saved ✓';
    setTimeout(() => { statusEl.textContent = ''; }, 1500);
  });
}

fields.forEach((id) => {
  document.getElementById(id).addEventListener('change', scheduleSave);
});
