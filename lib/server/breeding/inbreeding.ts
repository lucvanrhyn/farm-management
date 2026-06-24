// lib/server/breeding/inbreeding.ts
// Inbreeding risk detection + COI (coefficient of inbreeding) calculation
// using Wright's path method up to MAX_PEDIGREE_DEPTH.

import type { AnimalRow, InbreedingRisk } from "./types";
import { MAX_PEDIGREE_DEPTH } from "./constants";

export function detectInbreedingRisk(animals: AnimalRow[]): InbreedingRisk[] {
  const risks: InbreedingRisk[] = [];
  // Animal.motherId / Animal.fatherId store the parent's TAG (Animal.animalId),
  // NOT the cuid Animal.id — so the pedigree map and every parent-link comparison
  // must key on the tag, else parent_offspring / shared_grandparent never match
  // (see gotcha-observation-animalid-is-tag-not-cuid).
  const animalMap = new Map(animals.map((a) => [a.animalId, a]));

  for (let i = 0; i < animals.length; i++) {
    const a = animals[i];
    for (let j = i + 1; j < animals.length; j++) {
      const b = animals[j];

      if (
        (a.motherId && a.motherId === b.animalId) ||
        (a.fatherId && a.fatherId === b.animalId) ||
        (b.motherId && b.motherId === a.animalId) ||
        (b.fatherId && b.fatherId === a.animalId)
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
  // Pedigree is linked by TAG: Animal.motherId / Animal.fatherId hold the
  // parent's Animal.animalId (tag), not the cuid Animal.id. Key the map by tag
  // and traverse by tag, else getAncestors dead-ends after depth 1 (the parent
  // tags never resolve in a cuid-keyed map) and COI collapses to ~0 — silently
  // recommending inbred matings as "safe".
  const animalMap = new Map(allAnimals.map((a) => [a.animalId, a]));

  // Build ancestor maps: tag -> set of paths (each path = list of TAGs from animal to ancestor)
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

  // Get ancestors from both sides (from the perspective of a hypothetical
  // offspring). Seed with the animal's TAG so the parent-tag links resolve.
  const sireAncestors = getAncestors(animalA.animalId, MAX_PEDIGREE_DEPTH, [animalA.animalId]);
  const damAncestors = getAncestors(animalB.animalId, MAX_PEDIGREE_DEPTH, [animalB.animalId]);

  // Also include the parents themselves as ancestors of the offspring
  sireAncestors.set(animalA.animalId, [[animalA.animalId]]);
  damAncestors.set(animalB.animalId, [[animalB.animalId]]);

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
