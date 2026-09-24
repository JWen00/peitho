// Flat config (ESLint 9). Expo's rules for the RN app; Prettier last so it turns
// off any stylistic rules that would fight the formatter. supabase/functions is
// Deno, linted separately via `deno lint` (see deno.json) — ignored here.
const expoConfig = require('eslint-config-expo/flat');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = [
  ...expoConfig,
  eslintConfigPrettier,
  {
    rules: {
      // Newly adopted rule flags legitimate patterns already in the codebase
      // (data fetch on mount, per-tick animation state). Surface as a warning
      // to be revisited rather than blocking CI on a rewrite. See LevelMeter
      // and PracticeHeatmap.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    ignores: [
      'dist/*',
      'ios/*',
      'android/*',
      '.expo/*',
      'node_modules/*',
      'supabase/functions/*',
    ],
  },
];
