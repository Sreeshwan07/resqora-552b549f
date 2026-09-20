import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { History, IdCard, QrCode, Users } from "lucide-react";

/** The four emergency tools — each feature lives here and nowhere else on Home. */
const TOOLS = [
  { to: "/resqr-id" as const, icon: QrCode, title: "RESQR ID", subtitle: "Emergency QR" },
  {
    to: "/medical-id" as const,
    icon: IdCard,
    title: "Medical Profile",
    subtitle: "Health details",
  },
  { to: "/contacts" as const, icon: Users, title: "Guardian & Contacts", subtitle: "Who we alert" },
  {
    to: "/history" as const,
    icon: History,
    title: "Emergency History",
    subtitle: "Past incidents",
  },
];

export function EmergencyTools() {
  return (
    <section aria-label="Emergency tools" className="space-y-3">
      <h2 className="font-display text-lg font-extrabold text-foreground sm:text-xl">
        Emergency Tools
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {TOOLS.map((tool, index) => (
          <motion.li
            key={tool.to}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: index * 0.04 }}
          >
            <Link
              to={tool.to}
              className="soft-card group flex h-full min-h-24 items-center gap-3 rounded-2xl p-3.5 transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:min-h-28 sm:flex-col sm:items-start sm:justify-between sm:p-4"
            >
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal transition-colors group-hover:bg-teal/15 sm:size-11"
              >
                <tool.icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-sm font-bold leading-tight text-foreground sm:text-base">
                  {tool.title}
                </span>
                <span className="mt-0.5 block text-xs leading-tight text-muted-foreground">
                  {tool.subtitle}
                </span>
              </span>
            </Link>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
