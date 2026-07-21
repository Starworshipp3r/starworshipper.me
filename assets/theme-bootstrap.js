(() => {
  const root = document.documentElement;
  const themeKey = 'micaTheme_v2';
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
    theme = generateTheme();

    try {
      sessionStorage.setItem(themeKey, JSON.stringify(theme));
    } catch {}
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function generateTheme() {
    const h1 = randomInt(0, 359);
    const roll = Math.random();
    let mode;
    let saturation;
    let lightness;

    if (roll < 0.6) {
      mode = 'rich';
      saturation = randomInt(55, 85);
      lightness = randomInt(45, 65);
    } else if (roll < 0.85) {
      mode = 'pastel';
      saturation = randomInt(50, 75);
      lightness = randomInt(72, 84);
    } else {
      mode = 'moody';
      saturation = randomInt(38, 60);
      lightness = randomInt(35, 52);
    }

    return {
      h1,
      h2: (h1 + 180) % 360,
      s: saturation,
      l: lightness,
      mode,
    };
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
