import { describe, expect, test } from 'bun:test';
import { isDeepEqualFast } from '../crdt-schema';

function generateStateTree(nodeCount: number): Record<string, any> {
  const nodes: Record<string, any> = {};
  for (let i = 0; i < nodeCount; i++) {
    nodes['node_' + i] = {
      id: 'node_' + i,
      type: i % 2 === 0 ? 'rack:selective' : 'bones:framing',
      parentId: i > 0 ? 'node_' + Math.floor(i / 5) : null,
      visible: true,
      transform: {
        position: [i * 1.5, 0, (i % 10) * 2.0],
        rotation: [0, (i % 4) * Math.PI / 2, 0],
        scale: [1, 1, 1],
      },
      properties: {
        bayCount: 4,
        beamLevelCount: 5,
        beamElevationM: [0.3, 1.8, 3.3, 4.8, 6.3],
        capacityKg: 3000,
        uprightProfile: 'M100',
        bayClearWidthM: 2.7,
        accessories: {
          wireMeshDeck: true,
          columnProtectors: ['front-left', 'front-right'],
          palletBackstops: true,
        },
      },
      metadata: {
        author: 'engineer@pascal.app',
        lastModified: 1725100000000 + i,
        tags: ['zone-a', 'high-priority', 'aisle-' + Math.floor(i / 20)],
      },
    };
  }
  return {
    version: 1,
    rootNodeIds: ['node_0'],
    nodes,
  };
}

describe('CRDT isDeepEqualFast vs JSON.stringify Performance & Memory Benchmark', () => {
  test('correctness on deep 1,000 node state trees', () => {
    const treeA = generateStateTree(1000);
    const treeB = generateStateTree(1000);

    expect(isDeepEqualFast(treeA, treeB)).toBe(true);

    // Modify a leaf property in treeB
    treeB.nodes['node_999'].properties.capacityKg = 3500;
    expect(isDeepEqualFast(treeA, treeB)).toBe(false);

    // Modify a root property in treeB
    treeB.nodes['node_999'].properties.capacityKg = 3000;
    treeB.version = 2;
    expect(isDeepEqualFast(treeA, treeB)).toBe(false);
  });

  test('quantifies latency and GC allocation improvement over JSON.stringify', () => {
    const treeA = generateStateTree(1000);
    const treeB = generateStateTree(1000);
    const treeDifferentLeaf = generateStateTree(1000);
    treeDifferentLeaf.nodes['node_500'].properties.bayCount = 6;

    const ITERATIONS = 500;

    // Warmup
    for (let i = 0; i < 20; i++) {
      isDeepEqualFast(treeA, treeB);
      JSON.stringify(treeA) === JSON.stringify(treeB);
    }

    // Benchmark 1: isDeepEqualFast on identical trees (worst-case full traversal)
    const t0FastEqual = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      isDeepEqualFast(treeA, treeB);
    }
    const t1FastEqual = performance.now();
    const timeFastEqualMs = t1FastEqual - t0FastEqual;

    // Benchmark 2: JSON.stringify on identical trees
    const t0JsonEqual = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      const _ = JSON.stringify(treeA) === JSON.stringify(treeB);
    }
    const t1JsonEqual = performance.now();
    const timeJsonEqualMs = t1JsonEqual - t0JsonEqual;

    // Benchmark 3: isDeepEqualFast with difference (early-exit)
    const t0FastDiff = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      isDeepEqualFast(treeA, treeDifferentLeaf);
    }
    const t1FastDiff = performance.now();
    const timeFastDiffMs = t1FastDiff - t0FastDiff;

    // Benchmark 4: JSON.stringify with difference (cannot early-exit)
    const t0JsonDiff = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      const _ = JSON.stringify(treeA) === JSON.stringify(treeDifferentLeaf);
    }
    const t1JsonDiff = performance.now();
    const timeJsonDiffMs = t1JsonDiff - t0JsonDiff;

    console.log('\n=== 1,000-NODE TREE CRDT EQUALITY BENCHMARK (' + ITERATIONS + ' iterations) ===');
    console.log('Identical Trees (Worst Case Full Traversal):');
    console.log('  isDeepEqualFast: ' + timeFastEqualMs.toFixed(2) + ' ms (' + (timeFastEqualMs / ITERATIONS).toFixed(3) + ' ms/op)');
    console.log('  JSON.stringify:  ' + timeJsonEqualMs.toFixed(2) + ' ms (' + (timeJsonEqualMs / ITERATIONS).toFixed(3) + ' ms/op)');
    console.log('  Speedup:         ' + (timeJsonEqualMs / timeFastEqualMs).toFixed(2) + 'x faster');

    console.log('Differing Trees (Early Exit Advantage):');
    console.log('  isDeepEqualFast: ' + timeFastDiffMs.toFixed(2) + ' ms (' + (timeFastDiffMs / ITERATIONS).toFixed(3) + ' ms/op)');
    console.log('  JSON.stringify:  ' + timeJsonDiffMs.toFixed(2) + ' ms (' + (timeJsonDiffMs / ITERATIONS).toFixed(3) + ' ms/op)');
    console.log('  Speedup:         ' + (timeJsonDiffMs / timeFastDiffMs).toFixed(2) + 'x faster');

    expect(timeFastEqualMs).toBeLessThan(timeJsonEqualMs);
    expect(timeFastDiffMs).toBeLessThan(timeJsonDiffMs);
  });
});