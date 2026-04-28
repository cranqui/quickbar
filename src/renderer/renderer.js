const input = document.getElementById('quick-input');
const statusToast = document.getElementById('status-toast');
let statusTimeout = null;

// --- Input Handling ---

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) {
      quickBarAPI.hideWindow();
      return;
    }
    if (text.toLowerCase().startsWith('/do ')) {
      quickBarAPI.dispatchCommand(text);
    } else {
      quickBarAPI.saveNote(text);
    }
    input.value = '';
    quickBarAPI.hideWindow();
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    input.value = '';
    hideStatus();
    quickBarAPI.hideWindow();
  }
});

// --- IPC Listeners ---

quickBarAPI.onClearInput(() => {
  input.value = '';
  hideStatus();
  // Focus after a tick — window might still be showing
  setTimeout(() => input.focus(), 50);
});

quickBarAPI.onDispatchStatus((data) => {
  if (!data.ok) {
    showStatus(data.message, 'error');
  }
});

// --- Status Toast ---

function showStatus(message, type = 'error') {
  statusToast.textContent = message;
  statusToast.className = `status-toast visible ${type}`;
  if (statusTimeout) clearTimeout(statusTimeout);
  statusTimeout = setTimeout(hideStatus, 2500);
}

function hideStatus() {
  statusToast.className = 'status-toast';
  if (statusTimeout) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }
}

// --- Init ---

// Auto-focus on load
input.focus();