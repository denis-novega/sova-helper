/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#eef3ff',
          100: '#dce9ff',
          200: '#bcd2ff',
          300: '#90b4ff',
          400: '#5c8cff',
          500: '#376df7',
          600: '#2b59d9',
          700: '#2349b3',
          800: '#1e3e94',
          900: '#162b66',
        },
        surface: {
          DEFAULT: '#ffffff',
          subtle: '#f6f8fb',
          border: '#e5e9f2',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Apple Color Emoji', 'Noto Color Emoji'],
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        soft: '0 4px 20px 0 rgba(22, 43, 102, 0.06)',
      },
    },
  },
  plugins: [],
}
