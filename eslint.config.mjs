import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Non-application code: Superpowers skill helper scripts (.cjs/.js that
    // legitimately use require()) and generated Drizzle SQL are not app source.
    ".claude/**",
    "drizzle/**",
    // Local investigation artifacts and downloaded vendor bundles.
    "work/**",
  ]),
]);

export default eslintConfig;
