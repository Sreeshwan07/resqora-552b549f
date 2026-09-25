/**
 * Reverse geocoding through Google Maps, proxied on the server so the map key
 * never reaches the browser. Input is strictly bounded to a coordinate pair.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

async function google(lat: number, lng: number) {
  const key = process.env["GOOGLE_MAPS_API_KEY"];
  if (!key) return null;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      status?: string;
      results?: Array<{ formatted_address?: string }>;
    };
    if (body.status !== "OK") return null;
    return body.results?.[0]?.formatted_address ?? null;
  } catch {
    return null;
  }
}

/** OpenStreetMap fallback — no key needed, requires an identifying user agent. */
async function openStreetMap(lat: number, lng: number) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
      { headers: { "User-Agent": "RESQORA emergency response (reverse geocoding)" } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { display_name?: string };
    return body.display_name ?? null;
  } catch {
    return null;
  }
}

export const reverseGeocodeFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }): Promise<{ address: string | null }> => {
    const address = (await google(data.lat, data.lng)) ?? (await openStreetMap(data.lat, data.lng));
    return { address };
  });

/* ------------------------- forward geocoding (search) ---------------------- */

const searchSchema = z.object({ query: z.string().trim().min(3).max(160) });

export type PlaceMatch = { address: string; latitude: number; longitude: number };

async function googleSearch(query: string): Promise<PlaceMatch[]> {
  const key = process.env["GOOGLE_MAPS_API_KEY"];
  if (!key) return [];
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as {
      status?: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };
    if (body.status !== "OK") return [];
    return (body.results ?? [])
      .slice(0, 5)
      .map((result) => ({
        address: result.formatted_address ?? query,
        latitude: result.geometry?.location?.lat,
        longitude: result.geometry?.location?.lng,
      }))
      .filter(
        (match): match is PlaceMatch =>
          typeof match.latitude === "number" && typeof match.longitude === "number",
      );
  } catch {
    return [];
  }
}

async function openStreetMapSearch(query: string): Promise<PlaceMatch[]> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`,
      { headers: { "User-Agent": "RESQORA emergency response (place search)" } },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as Array<{
      display_name?: string;
      lat?: string;
      lon?: string;
    }>;
    return body
      .map((row) => ({
        address: row.display_name ?? query,
        latitude: Number(row.lat),
        longitude: Number(row.lon),
      }))
      .filter((match) => Number.isFinite(match.latitude) && Number.isFinite(match.longitude));
  } catch {
    return [];
  }
}

/** Destination search for Safe Journey. Real providers only — never invented. */
export const searchPlacesFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => searchSchema.parse(data))
  .handler(async ({ data }): Promise<{ matches: PlaceMatch[] }> => {
    const google = await googleSearch(data.query);
    if (google.length > 0) return { matches: google };
    return { matches: await openStreetMapSearch(data.query) };
  });
