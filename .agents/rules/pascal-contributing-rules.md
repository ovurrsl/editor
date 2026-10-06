---
name: pascal-contributing-rules
description: Strict package isolation rules between viewer and editor, and test execution rules based on CONTRIBUTING.md.
trigger: always_on
---

# Learned Behavior: Pascal Contribution Rules

## 1. Package Isolation (Viewer vs. Editor)
- **Rule:** Code inside `packages/viewer` MUST NEVER import from `apps/editor`.
- **Why:** The viewer is a standalone, agnostic 3D component. Any editor-specific behavior (like UI states or specific tools) must be injected from the outside via props or children. Leaking editor dependencies into the viewer breaks the architectural boundary (E-001).

## 2. Test Execution
- **Rule:** Never use the bare command `bun test`. Always use `bun run test`.
- **Why:** `bun test` is Bun's built-in collector and will scan every file (including compiled copies inside `dist/`), causing double-execution and inflated test counts. `bun run test` correctly routes through Turborepo to build workspace dependencies first and run scoped test scripts.
