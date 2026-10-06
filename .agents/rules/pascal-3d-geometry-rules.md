---
name: pascal-3d-geometry-rules
description: Rules for modifying Three.js geometry in Pascal to ensure CSG, bounding boxes, and children work correctly, plus a strict rule against committing personal files.
trigger: model_decision
---

# Learned Behavior: Pascal 3D Geometry & CSG Rules

## 1. Geometry Mutation for CSG and Platforms
When applying a shear (or non-uniform transform) to a wall or node:
- **Rule:** Always apply geometric mutations (like shear) directly to the `BufferGeometry` itself (using `applyMatrix4`) rather than to the `mesh.matrix`.
- **Why:** Auxiliary systems (like `wall-platform`, roofs, envelopes) rely on reading the raw geometry vertices and `boundingBox` to generate CSG booleans (via `three-bvh-csg`). If you shear the `mesh.matrix` but leave the geometry upright, these systems will crash or produce catastrophic boolean mismatches because they read the un-sheared bounds.

## 2. Child Transforms (Doors, Windows)
If child nodes (like windows or doors on a wall) need to inherit a transform that you baked into the base geometry:
- **Rule:** Wrap the children in a `<group matrixAutoUpdate={false}>` and apply the same transform to `group.matrix`.
- **Why:** Since the parent wall's `mesh.matrix` stays identity/un-sheared (to avoid double-shearing the geometry), the children won't automatically inherit the shear. Wrapping them ensures they match the geometry.

## 3. UV Double-Shear Prevention
- **Rule:** Do NOT apply the shear to the `wallWorldMatrix` used for UV projection (`applyWorldPlanarWallUVs`) if the underlying `builtGeo` vertices have already been sheared.
- **Why:** Projecting from a sheared world matrix onto sheared vertices results in double-shearing the texture.

## 4. No Personal Files
- **Rule:** Before running `git add .`, explicitly verify `git status` to ensure `profile-showcase`, `portfolio-assets`, or `.patch` files at the root are NOT staged. Never commit personal portfolio files to the OSS repository.
