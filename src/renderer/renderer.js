const input = document.getElementById('quick-input');

// --- Input Handling ---

input.addEventListener('keydown', (e) => {
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
      quickBarAPI.hideWindow();
    } else if (text.toLowerCase().startsWith('/do ')) {
      quickBarAPI.addToDoer(text);
      input.value = '';
      // Keep window open for chaining tasks
    } else {
      quickBarAPI.saveNote(text);
      input.value = '';
      quickBarAPI.hideWindow();
    }
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    input.value = '';
    quickBarAPI.hideWindow();
  }
});

// --- IPC Listeners (attached once, no duplicates) ---

quickBarAPI.onClearInput(() => {
  input.value = '';
  // Focus after a tick — window might still be showing
  setTimeout(() => input.focus(), 50);
});

// Note: dispatch errors are handled via macOS Notification from main process,
// not inline toast (window is hidden by the time response arrives).

// --- Init ---

input.focus();