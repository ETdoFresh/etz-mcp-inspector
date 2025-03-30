const themeToggleBtn = document.getElementById('theme-toggle');
const htmlElement = document.documentElement; // Get the <html> element
const storageKey = 'theme-preference';

const applyTheme = (theme: string) => {
    htmlElement.setAttribute('data-theme', theme);
    // Optional: Update button text/icon if needed, though CSS handles this via --toggle-icon
    // if (themeToggleBtn) {
    //     themeToggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
    // }
};

const toggleTheme = () => {
    const currentTheme = htmlElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem(storageKey, newTheme);
    applyTheme(newTheme);
};

// Check local storage on load
const storedTheme = localStorage.getItem(storageKey);

// Check system preference if no stored theme
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
const systemTheme = prefersDark.matches ? 'dark' : 'light';

// Apply theme: stored > system > default (light)
const initialTheme = storedTheme || systemTheme;
applyTheme(initialTheme);

// Add event listener to the button
if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
}

// Optional: Listen for system preference changes
// prefersDark.addEventListener('change', (e) => {
//     // Only update if no user preference is explicitly set
//     if (!localStorage.getItem(storageKey)) {
//         applyTheme(e.matches ? 'dark' : 'light');
//     }
// }); 