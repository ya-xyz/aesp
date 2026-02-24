import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: (await import('typescript-eslint')).parser,
    },
    rules: {
      'no-unused-vars': 'off', // handled by tsc noUnusedLocals
      'no-undef': 'off',       // handled by tsc
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'wasm/', 'tests/', 'coverage/'],
  },
];
