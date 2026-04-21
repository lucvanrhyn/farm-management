/**
 * Response shape for the breeding AI analyser. Lives alongside the route
 * because Next.js 16 disallows non-route-handler exports from route.ts.
 */

export interface BreedingAIResponse {
  summary: string;
  bullRecommendations: string[];
  calvingAlerts: string[];
  breedingWindowSuggestion: string;
  riskFlags: string[];
}
