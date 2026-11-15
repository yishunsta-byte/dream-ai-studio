import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["**/*.{ts,tsx}"], plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs["core-web-vitals"].rules, ...reactHooks.configs.recommended.rules } },
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly" } } },
  globalIgnores([".next/**", "next-env.d.ts", "coverage/**", "docs/**", "data/**", "storage/**", "backups/**", "tmp/**"]),
]);
