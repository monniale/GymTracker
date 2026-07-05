/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0B0F14',
        surface: '#141B24',
        card: '#1B2431',
        muted: '#37414F',
        edge: '#2A3442',
        ink: '#F8FAFC',
        sub: '#94A3B8',
        primary: '#F97316',
        primary2: '#FB923C',
        accent: '#22C55E',
        danger: '#EF4444',
      },
      fontFamily: {
        body: ['Barlow', 'system-ui', 'sans-serif'],
        display: ['"Barlow Condensed"', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'slide-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        'slide-up': 'slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fade-in 150ms ease-out',
      },
    },
  },
  plugins: [],
}
