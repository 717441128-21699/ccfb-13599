import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
