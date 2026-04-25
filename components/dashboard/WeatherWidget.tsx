"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

// ── WMO weather code → icon + label ──────────────────────────────────────────

function wmoToIcon(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 3) return "🌤️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 95 && code <= 99) return "⛈️";
  return "🌡️";
}

function wmoToLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 95 && code <= 99) return "Storm";
  return "Unknown";
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface OpenMeteoResponse {
  current: {
    temperature_2m: number;
    weathercode: number;
  };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    weathercode: number[];
  };
}

interface WeatherData {
  current: {
    temp: number;
    code: number;
  };
  daily: Array<{
    date: string;
    maxTemp: number;
    minTemp: number;
    precip: number;
    code: number;
  }>;
  fetchedAt: number;
}

const CACHE_KEY = "farmtrack_weather_cache";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getDayName(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return DAY_NAMES[d.getDay()];
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function readCache(cacheKey: string): WeatherData | null {
  try {
    const raw = sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const data = JSON.parse(raw) as WeatherData;
    if (Date.now() - data.fetchedAt > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(cacheKey: string, data: WeatherData) {
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(data));
  } catch {
    // sessionStorage may be unavailable in some contexts
  }
}

// ── Main component ────────────────────────────────────────────────────────────

interface WeatherWidgetProps {
  latitude?: number | null;
  longitude?: number | null;
}

export default function WeatherWidget({ latitude, longitude }: WeatherWidgetProps) {
  const params = useParams();
  const farmSlug = typeof params?.farmSlug === "string" ? params.farmSlug : "";

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    latitude != null && longitude != null ? { lat: latitude, lng: longitude } : null
  );
  // Lazy initializer: if no coord props and geolocation is unavailable, mark as
  // failed immediately rather than in an effect body (avoids synchronous setState
  // in effect, which the lint rule flags as cascade-prone).
  const [geoFailed, setGeoFailed] = useState<boolean>(() => {
    const hasCoordProps = latitude != null && longitude != null;
    return !hasCoordProps && typeof navigator !== "undefined" && !navigator.geolocation;
  });

  // Combined weather result keyed by coord string — derives loading and error
  // purely in render so no synchronous setState in effect bodies.
  const coordKey = coords ? `${coords.lat.toFixed(4)}_${coords.lng.toFixed(4)}` : null;
  const [weatherResult, setWeatherResult] = useState<{
    key: string;
    data: WeatherData | null;
    error: string | null;
  } | null>(null);

  // Derived state — no setState needed in effects.
  const weather = weatherResult?.key === coordKey ? weatherResult.data : null;
  const error   = weatherResult?.key === coordKey ? weatherResult.error : null;
  // Loading: true while we're waiting for coords or for the weather fetch to settle.
  // False once geolocation failed (nothing more to wait for) or weather result arrived.
  const loading = !geoFailed && (coordKey === null || weatherResult?.key !== coordKey);

  // If no props and geolocation is available, attempt to get current position.
  // geoFailed is already true if geolocation is unavailable (lazy initializer).
  useEffect(() => {
    if (coords || geoFailed) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setGeoFailed(true);
      }
    );
  }, [coords, geoFailed]);

  useEffect(() => {
    if (!coords || !coordKey) return;

    const cacheKey = `${CACHE_KEY}_${coordKey}`;
    const controller = new AbortController();
    const key = coordKey;

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${coords.lat}` +
      `&longitude=${coords.lng}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode` +
      `&current=temperature_2m,weathercode` +
      `&timezone=auto` +
      `&forecast_days=5`;

    // Check cache asynchronously (via microtask) to avoid synchronous setState
    // in the effect body — resolves immediately if cached, fetches otherwise.
    Promise.resolve(readCache(cacheKey))
      .then((cached) => {
        if (cached) return cached;
        return fetch(url, { signal: controller.signal })
          .then((res) => {
            if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
            return res.json() as Promise<OpenMeteoResponse>;
          })
          .then((raw): WeatherData => {
            const data: WeatherData = {
              current: {
                temp: Math.round(raw.current.temperature_2m),
                code: raw.current.weathercode,
              },
              daily: raw.daily.time.slice(0, 5).map((date, i) => ({
                date,
                maxTemp: Math.round(raw.daily.temperature_2m_max[i]),
                minTemp: Math.round(raw.daily.temperature_2m_min[i]),
                precip: Math.round(raw.daily.precipitation_sum[i] * 10) / 10,
                code: raw.daily.weathercode[i],
              })),
              fetchedAt: Date.now(),
            };
            writeCache(cacheKey, data);
            return data;
          });
      })
      .then((data) => {
        setWeatherResult({ key, data, error: null });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setWeatherResult({ key, data: null, error: "Could not load weather data." });
      });

    return () => controller.abort();
  }, [coords, coordKey]);

  // ── No coordinates ─────────────────────────────────────────────────────────
  if (geoFailed || (!loading && !coords)) {
    return (
      <div
        className="rounded-xl px-4 py-3 flex items-center gap-3"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <span style={{ fontSize: 20 }}>🗺️</span>
        <div>
          <p className="text-xs font-medium" style={{ color: "#1C1815" }}>
            No location set
          </p>
          {farmSlug && (
            <Link
              href={`/${farmSlug}/admin/settings`}
              className="text-xs hover:underline"
              style={{ color: "#4A7C59" }}
            >
              Set farm location in Settings →
            </Link>
          )}
        </div>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="rounded-xl px-4 py-3 animate-pulse flex items-center gap-3"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <div className="w-8 h-8 rounded-full bg-zinc-200" />
        <div className="flex gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-10 h-8 rounded bg-zinc-100" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !weather) {
    return (
      <div
        className="rounded-xl px-4 py-3 flex items-center gap-2"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <span className="text-xs" style={{ color: "#9C8E7A" }}>
          {error ?? "Weather unavailable"}
        </span>
      </div>
    );
  }

  // ── Weather display ────────────────────────────────────────────────────────
  return (
    <div
      className="rounded-xl px-4 py-3 flex items-center gap-4 overflow-x-auto"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      {/* Current condition */}
      <div className="flex items-center gap-2 shrink-0 pr-4" style={{ borderRight: "1px solid #E0D5C8" }}>
        <span style={{ fontSize: 24, lineHeight: 1 }}>{wmoToIcon(weather.current.code)}</span>
        <div>
          <p
            style={{
              fontFamily: "var(--font-dm-serif)",
              fontSize: 20,
              lineHeight: 1,
              color: "#1C1815",
            }}
          >
            {weather.current.temp}°
          </p>
          <p className="text-[10px]" style={{ color: "#9C8E7A" }}>
            {wmoToLabel(weather.current.code)}
          </p>
        </div>
      </div>

      {/* 5-day forecast strip */}
      <div className="flex gap-3">
        {weather.daily.map((day) => (
          <div
            key={day.date}
            className="flex flex-col items-center gap-0.5"
            style={{ minWidth: 40 }}
          >
            <span className="text-[10px] font-medium uppercase" style={{ color: "#9C8E7A", letterSpacing: "0.05em" }}>
              {getDayName(day.date)}
            </span>
            <span style={{ fontSize: 16, lineHeight: 1 }}>{wmoToIcon(day.code)}</span>
            <span className="text-xs font-semibold font-mono" style={{ color: "#1C1815" }}>
              {day.maxTemp}°
            </span>
            <span className="text-[10px] font-mono" style={{ color: "#9C8E7A" }}>
              {day.minTemp}°
            </span>
            {day.precip > 0 && (
              <span className="text-[9px] font-mono" style={{ color: "#4A7C59" }}>
                {day.precip}mm
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
