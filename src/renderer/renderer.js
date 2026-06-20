const input = document.getElementById('quick-input');
const resultsContainer = document.getElementById('results');

let appResults = [];
let selectedIdx = -1;
let searchDebounce = null;
let isAppSearchMode = false;
let currentMode = 'apps'; // 'apps', 'calc', 'currency', 'window'
let calcResult = null;
let fxResult = null;

const BASE_WINDOW_HEIGHT = 104; // input + statusbar
const RESULT_HEIGHT = 44; // per result item

// --- Pattern Detectors ---

// Math expression: starts with digit or ( and contains operators
function isMathExpression(text) {
  if (!text) return false;
  // Must start with digit, decimal, or opening paren
  if (!/^[0-9(.\s]/.test(text)) return false;
  // Must contain at least one operator
  if (!/[+\-*/%]/.test(text)) return false;
  // Must end with digit or closing paren
  if (!/[0-9)%\s]$/.test(text)) return false;
  return true;
}

// Currency conversion: "3600 cop to usd" or "100 usd to eur"
function parseCurrency(text) {
  const m = text.match(/^([\d.,]+)\s+([a-zA-Z]{3})\s+to\s+([a-zA-Z]{3})$/i);
  if (!m) return null;
  return { amount: m[1].replace(/,/g, ''), from: m[2], to: m[3] };
}

// Window management: "/left", "/right", "/full"
function isWindowCommand(text) {
  return /^(left|right|full)$/i.test(text.trim());
}

// --- Input Handling ---

input.addEventListener('keydown', (e) => {
  // Handle arrow keys for app results navigation
  if (appResults.length > 0 && currentMode === 'apps') {
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
      input.value = appResults[selectedIdx].name;
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
      clearResults();
    } else if (currentMode === 'calc' && calcResult !== null) {
      // Copy calc result to clipboard
      copyToClipboard(String(calcResult));
      input.value = '';
      clearResults();
      quickBarAPI.hideWindow();
    } else if (currentMode === 'currency' && fxResult && fxResult.ok) {
      copyToClipboard(String(fxResult.result));
      input.value = '';
      clearResults();
      quickBarAPI.hideWindow();
    } else if (currentMode === 'window') {
      const action = text.trim().toLowerCase();
      if (['left', 'right', 'full'].includes(action)) {
        quickBarAPI.windowManage(action);
        input.value = '';
        clearResults();
        quickBarAPI.hideWindow();
      }
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

// --- Input Router ---

input.addEventListener('input', () => {
  const text = input.value.trim();

  // Slash commands
  if (text.toLowerCase().startsWith('/ai ') || text.toLowerCase().startsWith('/do ')) {
    clearResults();
    return;
  }

  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    routeInput(text);
  }, 30);
});

function routeInput(text) {
  // 1. Window management: "left", "right", "full"
  if (isWindowCommand(text)) {
    currentMode = 'window';
    renderWindowResult(text.trim().toLowerCase());
    return;
  }

  // 2. Currency conversion: "3600 cop to usd"
  const fx = parseCurrency(text);
  if (fx) {
    currentMode = 'currency';
    doCurrencyConversion(fx);
    return;
  }

  // 3. Calculator: math expression
  if (isMathExpression(text)) {
    currentMode = 'calc';
    doCalc(text);
    return;
  }

  // 4. Default: app search
  currentMode = 'apps';
  isAppSearchMode = true;
  searchApps(text);
}

// --- Calculator ---

async function doCalc(expr) {
  try {
    const result = await quickBarAPI.calc(expr);
    calcResult = result;
    if (result !== null) {
      renderInlineResult(`= ${result}`, 'calc');
    } else {
      clearResults();
    }
  } catch (e) {
    clearResults();
  }
}

// --- Currency Conversion ---

async function doCurrencyConversion(fx) {
  try {
    const result = await quickBarAPI.convertCurrency(fx.amount, fx.from, fx.to);
    fxResult = result;
    if (result.ok) {
      const formatted = formatCurrency(result.result, result.to);
      renderInlineResult(`${fx.amount} ${result.from} = ${formatted}`, 'currency');
    } else {
      renderInlineResult(`Error: ${result.error}`, 'error');
    }
  } catch (e) {
    renderInlineResult(`Error: ${e.message}`, 'error');
  }
}

function formatCurrency(amount, currency) {
  // Simple formatting — enough for display
  const parts = amount.toFixed(2).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${intPart}.${parts[1]} ${currency}`;
}

// --- Window Management ---

function renderWindowResult(action) {
  const labels = { left: '← Left Half', right: 'Right Half →', full: '⤢ Full Screen' };
  resultsContainer.innerHTML = '';
  const item = document.createElement('div');
  item.className = 'result-item selected';
  item.innerHTML = `<span class="result-name" style="font-size: 15px;">${labels[action] || action}</span>`;
  resultsContainer.appendChild(item);
  resultsContainer.style.display = 'block';
  updateWindowHeight(1);
}

// --- Inline Result (calculator / currency) ---

function renderInlineResult(text, type) {
  appResults = [];
  selectedIdx = -1;
  isAppSearchMode = false;
  resultsContainer.innerHTML = '';
  const item = document.createElement('div');
  item.className = 'result-item selected';
  const icon = document.createElement('span');
  icon.className = 'inline-result-icon';
  icon.textContent = type === 'currency' ? '💱' : type === 'error' ? '⚠' : '=';
  const span = document.createElement('span');
  span.className = 'result-name';
  span.style.fontFamily = '"SF Mono", Menlo, monospace';
  span.textContent = text;
  item.appendChild(icon);
  item.appendChild(span);
  resultsContainer.appendChild(item);
  resultsContainer.style.display = 'block';
  updateWindowHeight(1);
}

// --- App Search ---

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

    item.addEventListener('click', () => {
      selectedIdx = i;
      launchSelectedApp();
    });

    item.addEventListener('mouseenter', () => {
      selectedIdx = i;
      updateSelection();
    });

    resultsContainer.appendChild(item);

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
  currentMode = 'apps';
  calcResult = null;
  fxResult = null;
  resultsContainer.innerHTML = '';
  resultsContainer.style.display = 'none';
  updateWindowHeight(0);
}

function updateWindowHeight(resultCount) {
  const height = BASE_WINDOW_HEIGHT + (resultCount * RESULT_HEIGHT);
  quickBarAPI.resizeWindow(height);
}

// --- Clipboard ---

function copyToClipboard(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

// --- IPC Listeners ---

quickBarAPI.onClearInput(() => {
  input.value = '';
  clearResults();
  setTimeout(() => input.focus(), 50);
});

// --- Init ---

input.focus();