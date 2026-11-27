import { shorelineEslint } from '@shoreline/config/eslint';

// pure TS: no browser or node globals in src (tests and configs may use node)
export default shorelineEslint({ node: true });
