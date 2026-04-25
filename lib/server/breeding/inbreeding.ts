// lib/server/breeding/inbreeding.ts
// Inbreeding risk detection + COI (coefficient of inbreeding) calculation
// using Wright's path method up to MAX_PEDIGREE_DEPTH.

import type { AnimalRow, InbreedingRisk } from "./types";
import { MAX_PEDIGREE_DEPTH } from "./constants";

export function detectInbreedingRisk(animals: AnimalRow[]): InbreedingRisk[] {
  const risks: InbreedingRisk[] = [];
  const animalMap = new Map(animals.map((a) => [a.id, a]));

  for (let i = 0; i < animals.length; i++) {
    const a = animals[i];
    for (let j = i + 1; j < animals.length; j++) {
      const b = animals[j];

      if (
        (a.motherId && a.motherId === b.id) ||
        (a.fatherId && a.fatherId === b.id) ||
        (b.motherId && b.motherId === a.id) ||
        (b.fatherId && b.fatherId === a.id)
      ) {
        risks.push({
          animalId: a.id,
          tag: a.animalId,
          riskType: "parent_offspring",
          relatedAnimalId: b.id,
          relatedTag: b.animalId,
        });
        continue;
      }

      if (
        a.motherId &&
        a.fatherId &&
        a.motherId === b.motherId &&
        a.fatherId === b.fatherId
      ) {
        risks.push({
          animalId: a.id,
          tag: a.animalId,
          riskType: "sibling",
          relatedAnimalId: b.id,
          relatedTag: b.animalId,
        });
        continue;
      }

      const aParents = [a.motherId, a.fatherId].filter(Boolean) as string[];
      const bParents = [b.motherId, b.fatherId].filter(Boolean) as string[];

      const aGrandparents = new Set<string>();
      for (const pid of aParents) {
        const p = animalMap.get(pid);
        if (p?.motherId) aGrandparents.add(p.motherId);
        if (p?.fatherId) aGrandparents.add(p.fatherId);
      }

      let hasShared = false;
      for (const pid of bParents) {
        if (hasShared) break;
        const p = animalMap.get(pid);
        const bGrandparents = [p?.motherId, p?.fatherId].filter(Boolean) as string[];
        for (const gp of bGrandparents) {
          if (aGrandparents.has(gp)) {
            risks.push({
              animalId: a.id,
              tag: a.animalId,
              riskType: "shared_grandparent",
              relatedAnimalId: b.id,
              relatedTag: b.animalId,
            });
            hasShared = true;
            break;
          }
        }
      }
    }
  }

  return risks;
}

/**
 * Calculate coefficient of inbreeding for a hypothetical offspring of animalA x animalB.
 * Uses Wright's path method, tracing all paths through common ancestors up to MAX_PEDIGREE_DEPTH.
 */
export function calculateCOI(
  animalA: AnimalRow,
  animalB: AnimalRow,
  allAnimals: AnimalRow[],
): number {
  const animalMap = new Map(allAnimals.map((a) => [a.id, a]));

  // Build ancestor maps: id -> set of paths (each path = list of IDs from animal to ancestor)
  function getAncestors(
    animalId: string,
    depth: number,
    currentPath: string[],
  ): Map<string, string[][]> {
    const result = new Map<string, string[][]>();
    if (depth === 0) return result;

    const animal = animalMap.get(animalId);
    if (!animal) return result;

    const parentIds = [animal.motherId, animal.fatherId].filter(Boolean) as string[];

    for (const parentId of parentIds) {
      const newPath = [...currentPath, parentId];

      // Add this parent as an ancestor
      const existing = result.get(parentId) ?? [];
      result.set(parentId, [...existing, newPath]);

      // Recurse for deeper ancestors
      const deeper = getAncestors(parentId, depth - 1, newPath);
      for (const [ancestorId, paths] of deeper.entries()) {
        const existingPaths = result.get(ancestorId) ?? [];
        result.set(ancestorId, [...existingPaths, ...paths]);
      }
    }

    return result;
  }

  // Get ancestors from both sides (from the perspective of a hypothetical offspring)
  const sireAncestors = getAncestors(animalA.id, MAX_PEDIGREE_DEPTH, [animalA.id]);
  const damAncestors = getAncestors(animalB.id, MAX_PEDIGREE_DEPTH, [animalB.id]);

  // Also include the parents themselves as ancestors of the offspring
  sireAncestors.set(animalA.id, [[animalA.id]]);
  damAncestors.set(animalB.id, [[animalB.id]]);

  // Find common ancestors
  let coi = 0;
  for (const [ancestorId, sirePaths] of sireAncestors.entries()) {
    const damPaths = damAncestors.get(ancestorId);
    if (!damPaths) continue;

    // For each pair of paths through a common ancestor, add (1/2)^(n1+n2+1)
    // where n1 = steps from sire to ancestor, n2 = steps from dam to ancestor
    for (const sirePath of sirePaths) {
      for (const damPath of damPaths) {
        const n1 = sirePath.length; // includes the starting animal
        const n2 = damPath.length;
        const pathLength = n1 + n2 - 1; // -1 because ancestor counted in both
        coi += Math.pow(0.5, pathLength);
      }
    }
  }

  return coi;
}
