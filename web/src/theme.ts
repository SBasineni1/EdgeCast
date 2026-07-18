export type ColorMode = "day" | "night";

const STORAGE_KEY = "edgecast-color-mode";

export function initialColorMode(): ColorMode {
  const documentMode = document.documentElement.dataset.theme;
  if (documentMode === "day" || documentMode === "night") return documentMode;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "day" || stored === "night") return stored;
  } catch {
    // Storage can be unavailable in privacy-restricted browsers.
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

export function applyColorMode(mode: ColorMode) {
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode === "night" ? "dark" : "light";
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // The selected mode still applies for the current page when storage is unavailable.
  }
}
