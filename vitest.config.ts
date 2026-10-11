import { configDefaults, defineConfig } from "vitest/config";

// dashboard/ is a package of its own, with its own dependencies and tests: cd dashboard && npm test.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, "dashboard/**"] } });
