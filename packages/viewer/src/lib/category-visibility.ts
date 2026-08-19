import { categoryOf } from '@pascal-app/core'

/**
 * Non-destructive category visibility, as one function rather than a rule
 * repeated at each call site.
 *
 * Containers (site / building / level) resolve to `null` in `categoryOf`, so
 * hiding a category never removes the hierarchy that hosts the rest of the
 * scene — only genuine content nodes are gated.
 *
 * Extracted so the guard test can assert the SHIPPED predicate. It previously
 * declared its own copy under a comment reading "mirrors the gate in
 * node-renderer.tsx exactly", which meant the renderer could lose the gate in
 * an upstream merge and the test would stay green — a fork divergence that
 * disappears silently is exactly the failure this package is trying to avoid.
 */
export function isHiddenByCategory(kind: string, hiddenCategories: ReadonlySet<string>): boolean {
  const category = categoryOf(kind)
  return category !== null && hiddenCategories.has(category)
}
