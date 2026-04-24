import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { getBreedingSnapshot, suggestPairings } from "@/lib/server/breeding-analytics";
import { checkRateLimit } from "@/lib/rate-limit";
import { getFarmCreds } from "@/lib/meta-db";

export const dynamic = "force-dynamic";

export interface BreedingAIResponse {
  summary: string;
  bullRecommendations: string[];
  calvingAlerts: string[];
  breedingWindowSuggestion: string;
  riskFlags: string[];
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Live tier check — JWT tier can be stale after subscription changes
  const creds = await getFarmCreds(farmSlug);
  if (!creds || creds.tier === "basic") {
    return NextResponse.json({ error: "Breeding AI requires an Advanced plan" }, { status: 403 });
  }

  const { allowed, retryAfterMs } = checkRateLimit(`breeding:${farmSlug}`, 5, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const prisma = ctx.prisma;

  // Gather herd data in parallel
  const [snapshot, pairings, settings, recentReproObs, recentCalvingObs] = await Promise.all([
    getBreedingSnapshot(prisma, farmSlug),
    suggestPairings(prisma, farmSlug),
    prisma.farmSettings.findFirst(),
    prisma.observation.findMany({
      where: {
        type: { in: ["pregnancy_scan", "insemination", "heat_detection"] },
        observedAt: { gte: new Date(Date.now() - 90 * 86_400_000) },
      },
      orderBy: { observedAt: "desc" },
      select: { type: true, animalId: true, details: true, observedAt: true },
    }),
    prisma.observation.findMany({
      where: {
        type: "calving",
        observedAt: { gte: new Date(Date.now() - 365 * 86_400_000) },
      },
      orderBy: { observedAt: "desc" },
      select: { animalId: true, details: true, observedAt: true },
    }),
  ]);

  const apiKey = settings?.openaiApiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    return NextResponse.json(
      { error: "OpenAI API key not configured. Add it in Settings or set OPENAI_API_KEY." },
      { status: 400 },
    );
  }

  // Parse recent repro obs for summary counts
  const parseDetails = (raw: string): Record<string, string> => {
    try { return JSON.parse(raw) as Record<string, string>; } catch { return {}; }
  };

  const scanResults = { pregnant: 0, empty: 0, uncertain: 0 };
  for (const obs of recentReproObs.filter((o) => o.type === "pregnancy_scan")) {
    const d = parseDetails(obs.details);
    const r = (d.result ?? "uncertain") as keyof typeof scanResults;
    if (r in scanResults) scanResults[r]++;
  }

  const liveCalvings = recentCalvingObs.filter(
    (o) => parseDetails(o.details).calf_status === "live",
  ).length;

  const herdData = {
    breedingSeasonStart: settings?.breedingSeasonStart ?? null,
    breedingSeasonEnd: settings?.breedingSeasonEnd ?? null,
    bullsInService: snapshot.bullsInService,
    pregnantCows: snapshot.pregnantCows,
    openCows: snapshot.openCows,
    expectedCalvingsThisMonth: snapshot.expectedCalvingsThisMonth,
    upcomingCalvings: snapshot.calendarEntries.slice(0, 10),
    scanResults,
    liveCalvingsLast12Months: liveCalvings,
    inseminations90d: recentReproObs.filter((o) => o.type === "insemination").length,
    heatDetections90d: recentReproObs.filter((o) => o.type === "heat_detection").length,
    suggestedPairingsCount: pairings.pairings.length,
    todayDate: new Date().toISOString().slice(0, 10),
  };

  const systemPrompt = `You are a livestock breeding advisor for South African cattle farms.
Analyze the herd data and provide structured recommendations for the upcoming breeding season.
Be concise and practical. Respond with valid JSON only — no markdown, no prose outside JSON.
The JSON must have these exact keys: summary, bullRecommendations, calvingAlerts, breedingWindowSuggestion, riskFlags.
- summary: string (2-3 sentences)
- bullRecommendations: array of strings (1-4 practical bullet points)
- calvingAlerts: array of strings (highlight any calvings in the next 30 days or overdue risks)
- breedingWindowSuggestion: string (1-2 sentences about optimal breeding timing)
- riskFlags: array of strings (empty array if no concerns)`;

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(herdData) },
      ],
      max_tokens: 800,
      temperature: 0.4,
    }),
  });

  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    console.error("[breeding/analyze] OpenAI error:", openaiRes.status, errText);
    return NextResponse.json(
      { error: `OpenAI request failed: ${openaiRes.status}` },
      { status: 502 },
    );
  }

  const openaiData = await openaiRes.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = openaiData.choices?.[0]?.message?.content ?? "{}";

  let parsed: BreedingAIResponse;
  try {
    parsed = JSON.parse(content) as BreedingAIResponse;
  } catch {
    return NextResponse.json({ error: "Failed to parse AI response" }, { status: 502 });
  }

  return NextResponse.json(parsed);
}
