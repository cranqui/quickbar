const input = document.getElementById('quick-input');
const resultsContainer = document.getElementById('results');

let appResults = [];
let selectedIdx = -1;
let searchDebounce = null;
let isAppSearchMode = false;

const BASE_WINDOW_HEIGHT = 104; // input + statusbar
const RESULT_HEIGHT = 44; // per result item

// --- Input Handling ---

input.addEventListener('keydown', (e) => {
  // Handle arrow keys for app results navigation
  if (appResults.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, appResults.length - 1);
      updateSelection();
      scrollIntoView();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      updateSelection();
      scrollIntoView();
      return;
    }
    if (e.key === 'Enter' && selectedIdx >= 0 && isAppSearchMode) {
      e.preventDefault();
      launchSelectedApp();
      return;
    }
    if (e.key === 'Tab' && selectedIdx >= 0 && isAppSearchMode) {
      e.preventDefault();
      // Tab completion — fill input with app name
      input.value = appResults[selectedIdx].name;
      // Clear results, let user confirm with Enter
      return;
    }
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) {
      quickBarAPI.hideWindow();
      return;
    }
    if (text.toLowerCase().startsWith('/ai ')) {
      quickBarAPI.dispatchCommand(text);
      input.value = '';
      clearResults();
      quickBarAPI.hideWindow();
    } else if (text.toLowerCase().startsWith('/do ')) {
      quickBarAPI.addToDoer(text);
      input.value = '';
      // Keep window open for chaining tasks
      clearResults();
    } else {
      // Not a slash command → check if an app is selected
      if (isAppSearchMode && selectedIdx >= 0 && appResults[selectedIdx]) {
        launchSelectedApp();
      } else {
        quickBarAPI.saveNote(text);
        input.value = '';
        clearResults();
        quickBarAPI.hideWindow();
      }
    }
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    input.value = '';
    clearResults();
    quickBarAPI.hideWindow();
  }
});

// --- App Search ---

input.addEventListener('input', () => {
  const text = input.value.trim();

  // If slash command, don't show app results
  if (text.toLowerCase().startsWith('/ai ') || text.toLowerCase().startsWith('/do ')) {
    clearResults();
    return;
  }

  // App search mode — any non-slash input triggers app search
  isAppSearchMode = true;

  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    searchApps(text);
  }, 30); // 30ms — feels instant
});

async function searchApps(query) {
  try {
    const results = await quickBarAPI.searchApps(query);
    appResults = results;
    selectedIdx = results.length > 0 ? 0 : -1;
    renderResults(results);
  } catch (e) {
    console.error('App search failed:', e);
  }
}

function renderResults(results) {
  if (results.length === 0) {
    clearResults();
    return;
  }

  // Build HTML
  resultsContainer.innerHTML = '';
  for (let i = 0; i < results.length; i++) {
    const app = results[i];
    const item = document.createElement('div');
    item.className = 'result-item' + (i === selectedIdx ? ' selected' : '');
    item.dataset.idx = i;

    const icon = document.createElement('img');
    icon.className = 'result-icon';
    icon.src = '';
    icon.alt = app.name;

    const name = document.createElement('span');
    name.className = 'result-name';
    name.textContent = app.name;

    item.appendChild(icon);
    item.appendChild(name);

    // Click to launch
    item.addEventListener('click', () => {
      selectedIdx = i;
      launchSelectedApp();
    });

    // Mouse hover updates selection
    item.addEventListener('mouseenter', () => {
      selectedIdx = i;
      updateSelection();
    });

    resultsContainer.appendChild(item);

    // Lazy-load icon (pass .app bundle path)
    if (app.path) {
      quickBarAPI.getAppIcon(app.path).then(dataURL => {
        if (dataURL) icon.src = dataURL;
      });
    }
  }

  resultsContainer.style.display = 'block';
  updateWindowHeight(results.length);
}

function updateSelection() {
  const items = resultsContainer.querySelectorAll('.result-item');
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === selectedIdx);
  });
}

function scrollIntoView() {
  const selected = resultsContainer.querySelector('.result-item.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest' });
  }
}

async function launchSelectedApp() {
  const app = appResults[selectedIdx];
  if (!app) return;

  await quickBarAPI.launchApp(app.path);
  input.value = '';
  clearResults();
  quickBarAPI.hideWindow();
}

function clearResults() {
  appResults = [];
  selectedIdx = -1;
  isAppSearchMode = false;
  resultsContainer.innerHTML = '';
  resultsContainer.style.display = 'none';
  updateWindowHeight(0);
}

function updateWindowHeight(resultCount) {
  const height = BASE_WINDOW_HEIGHT + (resultCount * RESULT_HEIGHT);
  quickBarAPI.resizeWindow(height);
}

// --- IPC Listeners ---

quickBarAPI.onClearInput(() => {
  input.value = '';
  clearResults();
  setTimeout(() => input.focus(), 50);
});

// --- Init ---

input.focus();