import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["main.js", "node_modules", "dist"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.mjs"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error"
    }
  },
  {
    files: ["scripts/**/*.mjs", "esbuild.config.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly"
      }
    }
  }
);
