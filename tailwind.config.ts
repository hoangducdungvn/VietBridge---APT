import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        meeting: {
          canvas: '#f5f7fa',
          surface: '#ffffff',
          ink: '#10243e',
          muted: '#5d6b7c',
          line: '#dce3eb',
          accent: '#1e3a5f',
          accentStrong: '#152d4b',
          live: '#239a57',
          danger: '#c83f3f',
          warning: '#b77816'
        }
      },
      spacing: {
        safe: 'max(1rem, env(safe-area-inset-bottom))'
      },
      boxShadow: {
        panel: '0 20px 50px rgb(30 58 95 / 0.10)'
      }
    }
  },
  plugins: []
} satisfies Config;
