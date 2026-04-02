import { getFarmBySlug } from './meta-db';

/**
 * Generates a URL-safe slug from a farm name.
 * Handles Afrikaans characters (ë, ê, ï, ö, ü, etc.) by stripping diacritics.
 * Checks uniqueness against meta-db, appends random suffix on collision.
 */
export async function generateSlug(farmName: string): Promise<string> {
  const base = slugify(farmName);

  const existing = await getFarmBySlug(base);
  if (!existing) return base;

  // Collision — append 4-char random suffix
  const suffix = Math.random().toString(36).substring(2, 6);
  return `${base}-${suffix}`;
}

function slugify(input: string): string {
  return input
    .normalize('NFD')                     // decompose accented chars (ë → e + combining ¨)
    .replace(/[\u0300-\u036f]/g, '')      // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')         // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, '')             // trim leading/trailing hyphens
    .substring(0, 48);                    // cap length
}
