import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "storage/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "src/generated/**",
    ],
  },
  {
    rules: {
      // Unused variables are an error, but conventional throwaway prefixes are allowed.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // `any` defeats the strictness the rest of the codebase relies on.
      "@typescript-eslint/no-explicit-any": "error",
      // Prisma JSON columns require targeted casts; those are annotated at the call site.
      "@typescript-eslint/no-empty-object-type": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Seed and test files may use looser typing against fixture data.
    files: ["prisma/**/*.ts", "tests/**/*.ts", "e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
