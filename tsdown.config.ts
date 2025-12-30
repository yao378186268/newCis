import { defineConfig } from 'tsdown/config'

export default defineConfig([
  {
    // ESM配置
    entry: ['src/**/*.ts', '!src/service/**/*'],
    format: 'esm',
    target: 'ESNext',
    outDir: 'lib/esm',
    dts: true,
  },
  {
    // CJS配置
    entry: ['src/**/*.ts', '!src/service/**/*'],
    format: 'cjs',
    target: 'node18',
    outDir: 'lib/cjs',
    dts: false,
  },
])