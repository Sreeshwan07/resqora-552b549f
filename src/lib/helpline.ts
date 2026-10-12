/** Tele-MANAS (Govt. of India mental-health helpline). RESQORA only offers a
 * call button; it is not connected to Tele-MANAS in any other way. */
export const TELE_MANAS = {
  name: "Tele-MANAS",
  primary: "14416",
  alternate: "1-800-891-4416",
} as const;

export const telHref = (n: string) => `tel:${n.replace(/[^\d+]/g, "")}`;
