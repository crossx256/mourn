(() => {
  const feedback = document.querySelector('#tray-feedback');
  const internals = window.__TAURI_INTERNALS__;

  const setError = (message) => {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.dataset.error = 'true';
  };

  const invoke = async (command, args = {}) => {
    if (!internals?.invoke) {
      setError('native bridge unavailable');
      return;
    }

    try {
      await internals.invoke(command, args);
    } catch (error) {
      console.error(`[Tray] ${command} failed:`, error);
      setError('action failed');
    }
  };

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target) return;

    const route = target.dataset.route;
    if (route) {
      void invoke('tray_navigate', { route });
      return;
    }

    const command = target.dataset.command;
    if (command) void invoke(command);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') void invoke('tray_dismiss');
  });

  document.addEventListener('contextmenu', (event) => event.preventDefault());
})();
