import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const THEME_STORAGE_KEY = "paperclip.theme";
const DARK_THEME_COLOR = "#18181b";
const LIGHT_THEME_COLOR = "#ffffff";
const COGNI_OS_BRAND_TOKEN = "cogni-os-v1";
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function resolveThemeFromDocument(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const isDark = theme === "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta instanceof HTMLMetaElement) {
    themeColorMeta.setAttribute("content", isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
  }
}

// COG-124 Pixel v1 brand layer.
// Two activation paths, both honoured at boot:
//   - VITE_THEME_COGNI_OS=1 baked at Vite build time (build-time flip).
//   - <meta name="paperclip-theme" content="cogni-os-v1"> injected by the
//     server's ui-branding pipeline when THEME_COGNI_OS=1 is set in the
//     deployment env (runtime flip — COG-117 packaging surface).
// Either signal activates the v1 token layer in cogni-os-v1.css. Default
// off — COG-114 interim tokens remain live until packaging flips the flag.
function applyBrandLayer() {
  if (typeof document === "undefined") return;
  const buildFlag = import.meta.env.VITE_THEME_COGNI_OS;
  const buildEnabled = buildFlag === "1" || buildFlag === "true";
  const runtimeMeta = document
    .querySelector<HTMLMetaElement>('meta[name="paperclip-theme"]')
    ?.getAttribute("content");
  const runtimeEnabled = runtimeMeta === COGNI_OS_BRAND_TOKEN;
  if (buildEnabled || runtimeEnabled) {
    document.documentElement.setAttribute("data-theme", COGNI_OS_BRAND_TOKEN);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => resolveThemeFromDocument());

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  useEffect(() => {
    applyBrandLayer();
  }, []);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore local storage write failures in restricted environments.
    }
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
    }),
    [theme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
