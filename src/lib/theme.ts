export type Theme = "dark" | "light";

export function loadTheme(): Theme {
  return (localStorage.getItem("theme") as Theme) ?? "dark";
}

export function applyTheme(theme: Theme) {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  localStorage.setItem("theme", theme);
}
