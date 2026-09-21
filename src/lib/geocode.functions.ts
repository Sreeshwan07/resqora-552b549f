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
