import { defineConfig } from 'tsup';

export default defineConfig({
    entry: [
        'src/index.ts'
    ],
    dts: true,
    format: [ 'cjs', 'esm' ],
    target: 'node16',
    splitting: false,
    clean: true,
    tsconfig: 'tsconfig.build.json'
});
