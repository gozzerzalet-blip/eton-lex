import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        // Semánticos: cambian con el tema (claro por defecto, oscuro con `.dark`).
        // Toda la paleta es monocromática: blanco, negro, gris perla y plata.
        fg: 'rgb(var(--fg) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        graphite: {
          50: '#f6f6f7',
          100: '#ededee',
          200: '#dcdcdf',
          300: '#c2c2c6',
          400: '#9a9aa0',
          500: '#74747a',
          600: '#55555b',
          700: '#3d3d42',
          800: '#26262a',
          900: '#141416',
          950: '#0a0a0b',
        },
        pearl: '#f1f1f3',
        silver: '#d9d9dc',
        ink: '#0a0a0b',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'Times New Roman', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(10,10,10,.03), 0 18px 40px -32px rgba(10,10,10,.35)',
        lift: '0 30px 70px -40px rgba(10,10,10,.45)',
        ring: 'inset 0 1px 0 rgba(255,255,255,.7)',
        glass:
          'inset 0 1px 0 rgba(255,255,255,.92), 0 0 0 1px rgba(10,10,10,.05), 0 22px 44px -34px rgba(10,10,10,.35)',
      },
      borderRadius: {
        '2.5xl': '1.25rem',
        '4xl': '1.75rem',
      },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.45' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
        fadeUp: 'fadeUp .35s ease-out both',
        pulseSoft: 'pulseSoft 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
