/** Design tokens from PROMPT §4 — the reference pastel dashboard. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: '#D6F0E3',
        surface: '#FBF8F4',
        'surface-2': '#F4EEE7',
        'card-pink': '#F9DCDC',
        'card-yellow': '#FCEBCB',
        'card-purple': '#E6DDF8',
        'card-green': '#D2ECDB',
        'card-blue': '#D9E7F7',
        ink: '#1A1A1A',
        'ink-soft': '#6B6B6B',
        accent: '#111111',
        'accent-on': '#FFFFFF',
      },
      borderRadius: {
        card: '24px',
        pill: '999px',
      },
      boxShadow: {
        soft: '0 8px 24px rgba(0,0,0,.05)',
      },
      fontFamily: {
        sans: ['Poppins', 'IBM Plex Sans Arabic', 'system-ui', 'sans-serif'],
        arabic: ['IBM Plex Sans Arabic', 'Cairo', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
