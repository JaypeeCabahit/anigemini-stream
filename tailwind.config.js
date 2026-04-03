/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './**/*.{ts,tsx}',
    '!./node_modules/**',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          900: '#1a1a2e',
          800: '#16213e',
          700: '#0f3460',
          600: '#c73652',
          500: '#e94560',
          400: '#ff6b81',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  safelist: [
    'bg-white/90', 'text-black',
    'bg-brand-600', 'bg-brand-500', 'bg-brand-900/50',
    'text-brand-300', 'border-brand-500/20',
  ],
  plugins: [],
};
