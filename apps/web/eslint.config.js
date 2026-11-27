import { speakersGarageEslint } from '@speakersgarage/config/eslint';

export default speakersGarageEslint({ browser: true, node: true, react: true, ignores: ['scripts/*.mjs'] });
