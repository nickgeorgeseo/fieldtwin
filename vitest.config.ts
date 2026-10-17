import { configDefaults, defineConfig } from "vitest/config";

// dashboard/ is a package of its own, with its own dependencies and tests: cd dashboard && npm test.
// .claude/ holds Claude Code's worktrees, each a whole checkout of another branch with tests of its own.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, "dashboard/**", ".claude/**"] } });
