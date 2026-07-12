(() => {
  const root = document.documentElement;
  const themeKey = 'micaTheme_v1';
  const animationKey = 'micaAnimStart_v1';
  const animationDuration = 90;

  root.classList.add('js');

  let theme = null;
  try {
    theme = JSON.parse(sessionStorage.getItem(themeKey) || 'null');
  } catch {}

  if (
    !theme ||
    !Number.isFinite(theme.h1) ||
    !Number.isFinite(theme.h2) ||
    !Number.isFinite(theme.s) ||
    !Number.isFinite(theme.l)
  ) {
    const h1 = Math.floor(Math.random() * 360);
    theme = {
      h1,
      h2: (h1 + 180) % 360,
      s: Math.floor(Math.random() * 80) + 20,
      l: Math.floor(Math.random() * 50) + 30,
    };

    try {
      sessionStorage.setItem(themeKey, JSON.stringify(theme));
    } catch {}
  }

  root.style.setProperty('--color-1', `hsla(${theme.h1}, ${theme.s}%, ${theme.l}%, 0.75)`);
  root.style.setProperty('--color-2', `hsla(${theme.h2}, ${theme.s}%, ${theme.l}%, 0.75)`);
  root.style.setProperty('--accent', `hsla(${theme.h1}, ${Math.min(theme.s + 10, 100)}%, ${Math.min(theme.l + 15, 72)}%, 1)`);
  root.style.setProperty('--accent-glow', `hsla(${theme.h1}, ${Math.min(theme.s + 10, 100)}%, ${Math.min(theme.l + 15, 72)}%, 0.22)`);

  let animationStart = null;
  try {
    animationStart = Number(sessionStorage.getItem(animationKey));
  } catch {}

  if (!animationStart) {
    animationStart = Date.now();
    try {
      sessionStorage.setItem(animationKey, String(animationStart));
    } catch {}
  }

  const elapsed = ((Date.now() - animationStart) / 1000) % animationDuration;
  root.style.setProperty('--bg-delay', `-${elapsed}s`);
})();
