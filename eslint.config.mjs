import { defineConfig, globalIgnores } from "eslint/config";
import { fixupConfigRules } from "@eslint/compat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// eslint-plugin-react (приезжает с eslint-config-next) ещё зовёт
// context.getFilename(), которого в ESLint 10 нет. fixupConfigRules
// оборачивает его правила совместимостной прослойкой; снять обёртку, когда
// eslint-config-next подтянет eslint-plugin-react с поддержкой ESLint 10.
const eslintConfig = defineConfig([
  ...fixupConfigRules(nextVitals),
  ...fixupConfigRules(nextTs),
  globalIgnores([".next/**", "out/**", "next-env.d.ts"]),
]);

export default eslintConfig;
