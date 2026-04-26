/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['SFMono-Regular', 'ui-monospace', 'monospace'],
      },
      colors: {
        accent: '#93c5fd',
      },
      animation: {
        blob:         'blob 7s ease infinite',
        float:        'float 6s ease-in-out infinite',
        gradient:     'gradient 15s ease infinite',
        'border-anim':'border-animation 4s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 3s ease-in-out infinite',
      },
      keyframes: {
        blob: {
          '0%, 100%': { transform: 'translate(0px) scale(1)' },
          '33%':       { transform: 'translate(30px, -50px) scale(1.1)' },
          '66%':       { transform: 'translate(-20px, 20px) scale(0.9)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-20px)' },
        },
        gradient: {
          '0%':   { backgroundPositionX: '0%',   backgroundPositionY: '50%' },
          '50%':  { backgroundPositionX: '100%', backgroundPositionY: '50%' },
          '100%': { backgroundPositionX: '0%',   backgroundPositionY: '50%' },
        },
        'border-animation': {
          '0%, 100%': { borderColor: 'rgba(59, 130, 246, 0.4)' },
          '50%':      { borderColor: 'rgba(168, 85, 247, 0.4)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.15', transform: 'scale(1)' },
          '50%':      { opacity: '0.3',  transform: 'scale(1.08)' },
        },
      },
      boxShadow: {
        'blue-glow':   'rgba(0,0,0,0) 0 0 0 0,rgba(0,0,0,0) 0 0 0 0,rgba(59,130,246,0.3) 0 10px 15px -3px,rgba(59,130,246,0.3) 0 4px 6px -4px',
        'purple-glow': 'rgba(0,0,0,0) 0 0 0 0,rgba(0,0,0,0) 0 0 0 0,rgba(168,85,247,0.3) 0 10px 15px -3px,rgba(168,85,247,0.3) 0 4px 6px -4px',
        'purple-xl':   'rgba(0,0,0,0) 0 0 0 0,rgba(0,0,0,0) 0 0 0 0,rgba(168,85,247,0.5) 0 25px 50px -12px',
      },
    },
  },
  plugins: [],
};
