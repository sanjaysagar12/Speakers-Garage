/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        grass: '#7FA85C',
        moss: '#4F7A42',
        pine: '#2E4A35',
        bark: '#4A3A2C',
        timber: '#8A6440',
        lake: '#2C5A74',
        shallow: '#6FB3BE',
        snow: '#F2F4F6',
        wheat: '#C8B45E',
      },
      fontFamily: { display: ['"Baloo 2"', '"Trebuchet MS"', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
