const input = document.getElementById('quick-input');
const resultsContainer = document.getElementById('results');

let appResults = [];
let selectedIdx = -1;
let searchDebounce = null;
let currentMode = 'apps'; // 'apps', 'calc', 'currency', 'commands'
let calcResult = null;
let fxResult = null;

const BASE_WINDOW_HEIGHT = 84; // fixed input (52) + statusbar (32) + 12px margin
const RESULT_HEIGHT = 44; // per result item

// --- Built-in Commands (fuzzy searchable, with icons) ---

const BUILTIN_COMMANDS = [
  { id: 'win-left',   name: 'Left Half',     icon: '⬅', subtitle: 'Snap window to left',  type: 'command', action: 'left' },
  { id: 'win-right',  name: 'Right Half',    icon: '➡', subtitle: 'Snap window to right', type: 'command', action: 'right' },
  { id: 'win-full',    name: 'Full Screen',   icon: '⤢', subtitle: 'Maximize window',     type: 'command', action: 'full' },
  { id: 'kill-proc',   name: 'Kill Process',  icon: '💀', subtitle: 'Select and kill a running process', type: 'command', action: 'kill' },
];

let killProcessMode = false; // when true, results list shows running processes

// Simple fuzzy match: checks if all chars of query appear in order in target
function fuzzyMatch(query, target) {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function searchCommands(query) {
  if (!query) return BUILTIN_COMMANDS;
  return BUILTIN_COMMANDS.filter(cmd =>
    fuzzyMatch(query, cmd.name) || fuzzyMatch(query, cmd.id)
  );
}

// --- Pattern Detectors ---

// Math expression: starts with digit or ( and contains operators
function isMathExpression(text) {
  if (!text) return false;
  if (!/^[0-9(.\s]/.test(text)) return false;
  if (!/[+\-*/%]/.test(text)) return false;
  if (!/[0-9)%\s]$/.test(text)) return false;
  return true;
}

// Currency conversion: "3600 cop to usd" or "100 usd to eur"
function parseCurrency(text) {
  const m = text.match(/^([\d.,]+)\s+([a-zA-Z]{3})\s+to\s+([a-zA-Z]{3})$/i);
  if (!m) return null;
  return { amount: m[1].replace(/,/g, ''), from: m[2], to: m[3] };
}

// Quick crypto/fiat lookup: "btc", "0.5 btc", "2 eth"
const QUICK_CRYPTO_CODES = ['btc','eth','sol','usdt','usdc','bnb','xrp','ada','doge','dot','matic','avax','link','ltc','bch','uni','atom','xlm','icp','fil','cop','usd','eur','gbp','jpy','cad','aud','chf','cny','mxn','brl','ars','clp','pen'];
function parseQuickCurrency(text) {
  // Just a currency code: "btc" → 1 BTC to USD
  const codeOnly = text.match(/^([a-zA-Z]{3})$/i);
  if (codeOnly && QUICK_CRYPTO_CODES.includes(codeOnly[1].toLowerCase())) {
    return { amount: '1', from: codeOnly[1], to: 'usd' };
  }
  // Amount + code: "0.5 btc" → 0.5 BTC to USD
  const amountCode = text.match(/^([\d.,]+)\s+([a-zA-Z]{3})$/i);
  if (amountCode && QUICK_CRYPTO_CODES.includes(amountCode[2].toLowerCase())) {
    return { amount: amountCode[1].replace(/,/g, ''), from: amountCode[2], to: 'usd' };
  }
  // Code to code without amount: "btc to eur" → 1 BTC to EUR
  const codeToCode = text.match(/^([a-zA-Z]{3})\s+to\s+([a-zA-Z]{3})$/i);
  if (codeToCode && QUICK_CRYPTO_CODES.includes(codeToCode[1].toLowerCase()) && QUICK_CRYPTO_CODES.includes(codeToCode[2].toLowerCase())) {
    return { amount: '1', from: codeToCode[1], to: codeToCode[2] };
  }
  return null;
}

// Unit conversion: "10 km in miles", "72 f to c", "1 tb to gb"
function isUnitConversion(text) {
  return /^[\d.,]+\s+[a-zA-Z/]+\s+(to|in|as)\s+[a-zA-Z/]+$/i.test(text);
}

// Distinguish unit from currency: currencies are 3-letter codes (cop, usd, eur)
// units include non-3-letter codes (km, lb, f, gb, etc.) or units in same category
function isCurrencyConversion(text) {
  const m = text.match(/^([\d.,]+)\s+([a-zA-Z]{3})\s+to\s+([a-zA-Z]{3})$/i);
  if (!m) return false;
  const knownCurrencies = ['cop','usd','eur','gbp','jpy','cad','aud','chf','cny','mxn','brl','ars','clp','pen'];
  const knownCrypto = ['btc','eth','sol','usdt','usdc','bnb','xrp','ada','doge','dot','matic','avax','link','ltc','bch','uni','atom','xlm','icp','fil'];
  const allCurrencies = [...knownCurrencies, ...knownCrypto];
  const from = m[2].toLowerCase();
  const to = m[3].toLowerCase();
  return allCurrencies.includes(from) && allCurrencies.includes(to);
}

// --- Input Handling ---

input.addEventListener('keydown', (e) => {
  // Arrow navigation for all result types
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
    if (e.key === 'Enter' && selectedIdx >= 0) {
      e.preventDefault();
      executeSelected();
      return;
    }
    if (e.key === 'Tab' && selectedIdx >= 0) {
      e.preventDefault();
      const item = appResults[selectedIdx];
      if (item.type === 'app') input.value = item.name;
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
      copyToClipboard(String(calcResult));
      input.value = '';
      clearResults();
      quickBarAPI.hideWindow();
    } else if (currentMode === 'currency' && fxResult && fxResult.ok) {
      copyToClipboard(String(fxResult.result));
      input.value = '';
      clearResults();
      quickBarAPI.hideWindow();
    } else {
      quickBarAPI.saveNote(text);
      input.value = '';
      clearResults();
      quickBarAPI.hideWindow();
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
  // Kill process by name: "kill notion", "kill chrome"
  const killMatch = text.match(/^kill\s+(.+)$/i);
  if (killMatch) {
    doKillByName(killMatch[1].trim());
    return;
  }

  // Kill process mode: typing filters process list (from two-step flow)
  if (killProcessMode) {
    showProcessList(text);
    return;
  }

  // 0. Quick currency: "btc", "0.5 btc", "2 eth" → value in USD
  const quick = parseQuickCurrency(text);
  if (quick) {
    currentMode = 'currency';
    doCurrencyConversion(quick);
    return;
  }

  // 1. Currency conversion: "3600 cop to usd" (known currency codes only)
  if (isCurrencyConversion(text)) {
    const fx = parseCurrency(text);
    if (fx) {
      currentMode = 'currency';
      doCurrencyConversion(fx);
      return;
    }
  }

  // 2. Unit conversion: "10 km in miles", "72 f to c", "1 tb to gb"
  if (isUnitConversion(text)) {
    currentMode = 'currency'; // reuse currency display mode
    doUnitConversion(text);
    return;
  }

  // 3. Calculator: math expression
  if (isMathExpression(text)) {
    currentMode = 'calc';
    doCalc(text);
    return;
  }

  // 4. App search + built-in commands (unified results)
  currentMode = 'apps';
  unifiedSearch(text);
}

// --- Unified Search (apps + commands) ---

async function unifiedSearch(query) {
  // Get command results first (instant, no IPC)
  const cmds = searchCommands(query);

  // Get app results via IPC
  let apps = [];
  try {
    apps = await quickBarAPI.searchApps(query);
  } catch (e) {
    // ignore — show commands only
  }

  // Merge: commands first, then apps
  const combined = [
    ...cmds.map(c => ({ ...c, type: 'command' })),
    ...apps.map(a => ({ ...a, type: 'app' })),
  ];

  appResults = combined;
  selectedIdx = combined.length > 0 ? 0 : -1;
  renderUnifiedResults(combined);
}

function renderUnifiedResults(results) {
  if (results.length === 0) {
    clearResults();
    return;
  }

  resultsContainer.innerHTML = '';
  for (let i = 0; i < results.length; i++) {
    const item_data = results[i];
    const item = document.createElement('div');
    item.className = 'result-item' + (i === selectedIdx ? ' selected' : '');
    item.dataset.idx = i;

    if (item_data.type === 'command') {
      const icon = document.createElement('span');
      icon.className = 'result-icon-emoji';
      icon.textContent = item_data.icon;
      item.appendChild(icon);
    } else if (item_data.type === 'process') {
      if (item_data.appPath) {
        // Use real app icon
        const icon = document.createElement('img');
        icon.className = 'result-icon';
        icon.src = '';
        icon.alt = item_data.name;
        item.appendChild(icon);
        quickBarAPI.getAppIcon(item_data.appPath).then(dataURL => {
          if (dataURL) icon.src = dataURL;
        });
      } else {
        // System process — use emoji
        const icon = document.createElement('span');
        icon.className = 'result-icon-emoji';
        icon.textContent = '⚙';
        item.appendChild(icon);
      }
    } else {
      const icon = document.createElement('img');
      icon.className = 'result-icon';
      icon.src = '';
      icon.alt = item_data.name;
      item.appendChild(icon);
      if (item_data.path) {
        quickBarAPI.getAppIcon(item_data.path).then(dataURL => {
          if (dataURL) icon.src = dataURL;
        });
      }
    }

    const name = document.createElement('span');
    name.className = 'result-name';
    name.textContent = item_data.name;
    item.appendChild(name);

    if (item_data.subtitle) {
      const sub = document.createElement('span');
      sub.className = 'result-subtitle';
      sub.textContent = item_data.subtitle;
      item.appendChild(sub);
    }

    item.addEventListener('click', () => {
      selectedIdx = i;
      executeSelected();
    });

    item.addEventListener('mouseenter', () => {
      selectedIdx = i;
      updateSelection();
    });

    resultsContainer.appendChild(item);
  }

  resultsContainer.style.display = 'block';
  updateWindowHeight(results.length);
}

async function executeSelected() {
  const item = appResults[selectedIdx];
  if (!item) return;

  if (item.type === 'command') {
    if (item.action === 'kill') {
      // Switch to process list mode
      killProcessMode = true;
      input.value = '';
      input.placeholder = 'Select process to kill...';
      await showProcessList();
      return;
    }
    await quickBarAPI.windowManage(item.action);
    input.value = '';
    clearResults();
    quickBarAPI.hideWindow();
  } else if (item.type === 'process') {
    // Kill the selected process
    const result = await quickBarAPI.killProcess(item.pid);
    if (result.ok) {
      input.value = '';
      input.placeholder = 'Search apps, calc, 3600 cop to usd, /ai, /do…';
      killProcessMode = false;
      clearResults();
      quickBarAPI.hideWindow();
    } else {
      // Show error inline
      renderInlineResult(`Error: ${result.error}`, 'error');
    }
  } else if (item.type === 'app') {
    await quickBarAPI.launchApp(item.path);
    input.value = '';
    clearResults();
    quickBarAPI.hideWindow();
  }
}

async function showProcessList(filter) {
  try {
    const procs = await quickBarAPI.listProcesses();
    if (procs && procs.error) {
      renderInlineResult(`Error: ${procs.error}`, 'error');
      return;
    }
    let filtered = procs;
    if (filter) {
      filtered = procs.filter(p =>
        fuzzyMatch(filter, p.name) || fuzzyMatch(filter, String(p.pid))
      );
    }
    appResults = filtered.map(p => ({
      ...p,
      type: 'process',
      name: p.name,
      subtitle: `PID ${p.pid} · ${p.memory}`,
      icon: '⚙',
    }));
    selectedIdx = appResults.length > 0 ? 0 : -1;
    renderUnifiedResults(appResults);
  } catch (e) {
    renderInlineResult(`Error: ${e.message}`, 'error');
  }
}

async function doKillByName(name) {
  try {
    const procs = await quickBarAPI.listProcesses();
    if (procs && procs.error) {
      renderInlineResult(`Error: ${procs.error}`, 'error');
      return;
    }

    // Match by name (case-insensitive contains)
    const matches = procs.filter(p =>
      p.name.toLowerCase().includes(name.toLowerCase())
    );

    if (matches.length === 0) {
      renderInlineResult(`No process found for "${name}"`, 'error');
    } else if (matches.length === 1) {
      // Single match — kill directly
      const result = await quickBarAPI.killProcess(matches[0].pid);
      if (result.ok) {
        renderInlineResult(`Killed ${matches[0].name} (PID ${matches[0].pid})`, 'kill');
        setTimeout(() => {
          input.value = '';
          clearResults();
          quickBarAPI.hideWindow();
        }, 800);
      } else {
        renderInlineResult(`Error: ${result.error}`, 'error');
      }
    } else {
      // Multiple matches — sort main apps first, then by memory
      matches.sort((a, b) => {
        if (a.isMainApp !== b.isMainApp) return a.isMainApp ? -1 : 1;
        return b.memoryMB - a.memoryMB;
      });
      killProcessMode = true;
      appResults = matches.map(p => ({
        ...p,
        type: 'process',
        name: p.name,
        subtitle: `PID ${p.pid} · ${p.memory}`,
        icon: '⚙',
      }));
      selectedIdx = 0;
      renderUnifiedResults(appResults);
    }
  } catch (e) {
    renderInlineResult(`Error: ${e.message}`, 'error');
  }
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
  const parts = amount.toFixed(2).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${intPart}.${parts[1]} ${currency}`;
}

// --- Unit Conversion ---

async function doUnitConversion(text) {
  try {
    const result = await quickBarAPI.convertUnit(text);
    if (result && result.ok) {
      renderInlineResult(result.label, 'unit');
    } else {
      clearResults();
    }
  } catch (e) {
    clearResults();
  }
}

// --- Inline Result (calculator / currency) ---

function renderInlineResult(text, type) {
  appResults = [];
  selectedIdx = -1;
  resultsContainer.innerHTML = '';
  const item = document.createElement('div');
  item.className = 'result-item selected';
  const icon = document.createElement('span');
  icon.className = 'inline-result-icon';
  icon.textContent = type === 'currency' ? '💱' : type === 'unit' ? '📏' : type === 'error' ? '⚠' : type === 'kill' ? '💀' : '=';
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

// --- Helpers ---

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

function clearResults() {
  appResults = [];
  selectedIdx = -1;
  currentMode = 'apps';
  calcResult = null;
  fxResult = null;
  if (killProcessMode) {
    killProcessMode = false;
    input.placeholder = 'Search apps, calc, 3600 cop to usd, /ai, /do…';
  }
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