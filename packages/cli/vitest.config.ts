import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['test/**/*.test.ts']},resolve:{alias:{'@opikey/sdk':new URL('../sdk/src/index.ts',import.meta.url).pathname}}});
