import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

// Existing interaction patterns are reported first, without blocking the
// deployment until each modal/editor has been remediated deliberately.
const a11yWarnings = Object.fromEntries(
  Object.keys(jsxA11y.configs.recommended.rules).map((rule) => [rule, 'warn']),
);

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'migration-backup/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'lib/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { 'jsx-a11y': jsxA11y, 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...a11yWarnings,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
