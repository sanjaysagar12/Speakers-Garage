import { shorelineEslint } from '@shoreline/config/eslint';

export default shorelineEslint({ browser: true, node: true, react: true, ignores: ['scripts/*.mjs'] });
