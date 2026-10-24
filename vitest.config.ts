import { defineConfig } from 'vitest/config';
export default defineConfig({test: {include: ['tests/unit/**/*.test.ts', 'tests/store/**/*.test.ts'], environment: 'node', testTimeout: 15000, reporters: ['default'], restoreMocks: true}});
