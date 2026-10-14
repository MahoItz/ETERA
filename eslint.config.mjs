import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'migration-backup/**'] },
  { files: ['src/**/*.{ts,tsx}', 'lib/**/*.ts'], languageOptions: { parser: tseslint.parser } },
);
