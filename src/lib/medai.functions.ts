import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MedAiAssessment } from "@/lib/medai.server";

const Input = z.object({
  language: z.enum(["en", "hi", "te"]),
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(24)
    .default([]),
  imageDataUrl: z
    .string()
    .regex(
      /^data:image\/(jpeg|jpg|png|webp|heic);base64,[A-Za-z0-9+/=\s]+$/,
      "Unsupported image format",
    )
    .max(6_000_000)
    .nullish(),
  medicalContext: z.string().max(2000).nullish(),
});

/** Authenticated medical-assistant turn: triage, first aid and specialist advice. */
export const askMedAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<MedAiAssessment> => {
    const { enforceLimit } = await import("@/lib/rate-limit.server");
    enforceLimit(getRequest(), "medai", 20, 60_000);
    const { runMedAi } = await import("@/lib/medai.server");
    return runMedAi(data);
  });
