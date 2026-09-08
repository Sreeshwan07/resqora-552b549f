/**
 * Shared reverse-geocoding helper.
 *
 * Primary source is Google Maps, called through a server function so the map
 * key stays on the server. If that is unavailable the free BigDataCloud
 * endpoint is tried as a fallback; when neither answers we return null rather
 * than guessing an address.
 */
import { reverseGeocodeFn } from "@/lib/geocode.functions";

async function fromGoogle(lat: number, lng: number) {
  try {
    const result = await reverseGeocodeFn({ data: { lat, lng } });
    return result.address ?? null;
  } catch {
    return null;
  }
}

async function fromBigDataCloud(lat: number, lng: number) {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      locality?: string;
      city?: string;
      principalSubdivision?: string;
      countryName?: string;
    };
    return (
      [data.locality || data.city, data.principalSubdivision, data.countryName]
        .filter(Boolean)
        .join(", ") || null
    );
  } catch {
    return null;
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  return (await fromGoogle(lat, lng)) ?? (await fromBigDataCloud(lat, lng));
}
