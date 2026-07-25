/**
 * Stamps data-theme on <html> before first paint.
 *
 * Everything in the stylesheet keys off [data-theme] alone, so the toggle always
 * wins over the OS setting. Running this synchronously in <head> is what keeps
 * a dark-mode user from getting a white flash on every navigation.
 */
export const THEME_STORAGE_KEY = "ledgr.theme";

const script = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
