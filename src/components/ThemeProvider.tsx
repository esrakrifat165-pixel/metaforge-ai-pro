"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light";

// Must match the key used in the inline script in src/app/layout.tsx.
const STORAGE_KEY = "metaforge-theme";
const CHANGE_EVENT = "metaforge-theme-change";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSnapshot(): Theme {
  if (typeof document === "undefined") {
    return "dark";
  }

  return document.documentElement.dataset.theme === "light"
    ? "light"
    : "dark";
}

export function ThemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  // Keep the server and initial client render consistent.
  // The actual browser theme is synchronized after mounting.
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    function syncTheme() {
      setThemeState(getSnapshot());
    }

    // Respect the theme applied by the inline script in layout.tsx.
    syncTheme();

    window.addEventListener(CHANGE_EVENT, syncTheme);

    return () => {
      window.removeEventListener(CHANGE_EVENT, syncTheme);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    // Update the document immediately so existing CSS responds.
    document.documentElement.dataset.theme = next;

    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be blocked. The theme still works for this visit.
    }

    setThemeState(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(getSnapshot() === "light" ? "dark" : "light");
  }, [setTheme]);

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

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside <ThemeProvider>.");
  }

  return context;
}