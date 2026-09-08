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

export const reverseGeocodeFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }): Promise<{ address: string | null }> => {
    const key = process.env["GOOGLE_MAPS_API_KEY"];
    if (!key) return { address: null };
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${data.lat},${data.lng}&key=${key}`;
      const res = await fetch(url);
      if (!res.ok) return { address: null };
      const body = (await res.json()) as {
        status?: string;
        results?: Array<{ formatted_address?: string }>;
      };
      if (body.status !== "OK") return { address: null };
      return { address: body.results?.[0]?.formatted_address ?? null };
    } catch {
      return { address: null };
    }
  });
