import {
  Home,
  Siren,
  MapPinned,
  History,
  UserRound,
  Settings,
  Bot,
  Bell,
  Radar,
  Gauge,
  AlarmClock,
  NotebookPen,
  Droplets,
  Activity,
  Info,
  Camera,
  Users,
  IdCard,
  FileText,
  Share2,
  MailCheck,
  Stethoscope,
  QrCode,
  ScanLine,
  LifeBuoy,
  Cpu,
  Menu,
  LayoutDashboard,
  ShieldCheck,
  HeartPulse,
  Radio,
  ClipboardCheck,
  ClipboardList,
  HandHeart,
} from "lucide-react";
import type { NavSection, NavItem } from "@/types";

export const primaryNav: NavItem[] = [
  { label: "Home", to: "/", icon: Home, description: "Main dashboard" },
  { label: "Emergency SOS", to: "/emergency", icon: Siren, description: "Emergency activation" },
  { label: "Nearby", to: "/nearby", icon: MapPinned, description: "Responders around you" },
  { label: "History", to: "/history", icon: History, description: "Previous SOS and reports" },
  { label: "Profile", to: "/profile", icon: UserRound, description: "Your safety identity" },
  { label: "About", to: "/about", icon: Info, description: "Platform information" },
  { label: "Settings", to: "/settings", icon: Settings, description: "Preferences" },
];

export const assistantNav: NavItem = {
  label: "AI Assistant",
  to: "/assistant",
  icon: Bot,
  description: "Triage & first aid",
};

export const resqAiNav: NavItem = {
  label: "RESQ AI",
  to: "/resq-ai",
  icon: Stethoscope,
  description: "AI emergency medical assistant",
};

export const medAiNav: NavItem = {
  label: "AI Medical Assistant",
  to: "/medai",
  icon: Stethoscope,
  description: "MedAI symptoms & first aid",
};

export const liveLocationNav: NavItem = {
  label: "Live Location",
  to: "/live",
  icon: Radar,
  description: "Active emergency tracking",
};

export const notificationsNav: NavItem = {
  label: "Notifications",
  to: "/notifications",
  icon: Bell,
  description: "Alerts & updates",
};

export const adminNav: NavItem = {
  label: "Admin",
  to: "/admin",
  icon: Gauge,
  description: "Approvals, reports & analytics",
};

export const supportPageNav: NavItem = {
  label: "Contact support",
  to: "/support",
  icon: LifeBuoy,
  description: "Approval help & account questions",
};

export const coreNav: NavItem = {
  label: "RESQORA CORE",
  to: "/core",
  icon: Cpu,
  description: "AI emergency coordination system",
};

export const commandCentreNav: NavItem = {
  label: "Command Centre",
  to: "/command-center",
  icon: LayoutDashboard,
  description: "Coordinate, dispatch & hand over",
};

export const responderNav: NavItem = {
  label: "Responder inbox",
  to: "/responder",
  icon: Radio,
  description: "Your assignments & availability",
};

export const triageNav: NavItem = {
  label: "Triage board",
  to: "/triage",
  icon: HeartPulse,
  description: "People involved, most urgent first",
};

export const debriefNav: NavItem = {
  label: "Recovery & report",
  to: "/debrief",
  icon: ClipboardCheck,
  description: "After-action report & follow-up",
};

export const samaritanNav: NavItem = {
  label: "Good Samaritan",
  to: "/samaritan",
  icon: HandHeart,
  description: "Volunteer nearby & accept requests",
};

export const smsTestNav: NavItem = {
  label: "SMS SOS test plan",
  to: "/sms-test",
  icon: ClipboardList,
  description: "Run the feature-phone emergency end to end",
};

export const prepareNav: NavItem = {
  label: "Prepare",
  to: "/prepare",
  icon: ShieldCheck,
  description: "Readiness plan & hazard advisories",
};

export const digitalTwinNav: NavItem = {
  label: "Digital Twin",
  to: "/digital-twin",
  icon: Radar,
  description: "Live emergency workspace",
};

export const checkinsNav: NavItem = {
  label: "Check-ins",
  to: "/checkins",
  icon: AlarmClock,
  description: "Timed safety confirmations",
};

export const notesNav: NavItem = {
  label: "Emergency notes",
  to: "/notes",
  icon: NotebookPen,
  description: "Responder instructions",
};

export const donorsNav: NavItem = {
  label: "Blood donors",
  to: "/donors",
  icon: Droplets,
  description: "Directory & availability",
};

export const activityNav: NavItem = {
  label: "Activity",
  to: "/activity",
  icon: Activity,
  description: "Audit trail & exports",
};

export const reportNav: NavItem = {
  label: "Report accident",
  to: "/report",
  icon: Camera,
  description: "AI photo & video triage",
};

export const contactsNav: NavItem = {
  label: "Emergency contacts",
  to: "/contacts",
  icon: Users,
  description: "Who we alert",
};

export const medicalIdNav: NavItem = {
  label: "Medical ID",
  to: "/medical-id",
  icon: IdCard,
  description: "Responder medical card",
};

export const resqrIdNav: NavItem = {
  label: "My RESQR ID",
  to: "/resqr-id",
  icon: QrCode,
  description: "Emergency QR & wallet card",
};

export const scanNav: NavItem = {
  label: "Scan RESQR ID",
  to: "/scan",
  icon: ScanLine,
  description: "Open someone's emergency summary",
};

export const documentsNav: NavItem = {
  label: "Documents",
  to: "/documents",
  icon: FileText,
  description: "Downloadable PDFs",
};

export const shareCenterNav: NavItem = {
  label: "Share centre",
  to: "/share-center",
  icon: Share2,
  description: "Email, WhatsApp, links & QR",
};

export const emailDiagnosticsNav: NavItem = {
  label: "Email diagnostics",
  to: "/email-diagnostics",
  icon: MailCheck,
  description: "Alert delivery health",
};

/**
 * The signed-in member menu. Deliberately short and role-neutral: nothing in
 * here is an operator tool, and the admin entry is appended separately for the
 * super-admin account only.
 */
export const navSections: NavSection[] = [
  {
    title: "Emergency",
    items: [
      { label: "Home", to: "/", icon: Home, description: "Main dashboard" },
      coreNav,
      { label: "RESQ AI", to: "/resq-ai", icon: Stethoscope, description: "AI medical assistant" },
      {
        label: "Emergency SOS",
        to: "/emergency",
        icon: Siren,
        description: "Emergency activation",
      },
      digitalTwinNav,
      commandCentreNav,
      triageNav,
      responderNav,
      prepareNav,
      samaritanNav,
      smsTestNav,
      debriefNav,
      {
        label: "Report accident",
        to: "/report",
        icon: Camera,
        description: "Report with AI analysis",
      },
      {
        label: "Nearby services",
        to: "/nearby",
        icon: MapPinned,
        description: "Hospitals, police, fire, blood banks",
      },
    ],
  },
  {
    title: "My records",
    items: [
      {
        label: "RESQR ID",
        to: "/resqr-id",
        icon: QrCode,
        description: "Emergency QR & medical ID",
      },
      {
        label: "Medical profile",
        to: "/medical-id",
        icon: IdCard,
        description: "Medical information",
      },
      {
        label: "Emergency contacts",
        to: "/contacts",
        icon: Users,
        description: "Guardian management",
      },
      {
        label: "Emergency history",
        to: "/history",
        icon: History,
        description: "Previous SOS and reports",
      },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "My profile", to: "/profile", icon: UserRound, description: "Account details" },
      { label: "Settings", to: "/settings", icon: Settings, description: "Preferences" },
      { label: "About", to: "/about", icon: Info, description: "Platform information" },
      supportPageNav,
    ],
  },
];

export const mobileNav: NavItem[] = [
  { label: "Home", to: "/", icon: Home, description: "Emergency dashboard" },
  { label: "Nearby", to: "/nearby", icon: MapPinned, description: "Emergency services near you" },
  { label: "SOS", to: "/emergency", icon: Siren, description: "Trigger assistance" },
  { label: "RESQ AI", to: "/resq-ai", icon: Stethoscope, description: "AI medical assistant" },
  { label: "Menu", to: "/menu", icon: Menu, description: "All RESQORA features" },
];

/**
 * The mobile Menu screen. Bottom navigation stays at five entries; everything
 * else lives here, grouped the way a user thinks about an emergency.
 */
export const mobileMenuSections: NavSection[] = [
  {
    title: "Emergency",
    items: [
      reportNav,
      liveLocationNav,
      digitalTwinNav,
      commandCentreNav,
      triageNav,
      responderNav,
      prepareNav,
      samaritanNav,
      smsTestNav,
      debriefNav,
      activityNav,
    ],
  },
  {
    title: "My safety",
    items: [
      resqrIdNav,
      medicalIdNav,
      contactsNav,
      checkinsNav,
      {
        label: "Emergency history",
        to: "/history",
        icon: History,
        description: "Previous SOS and reports",
      },
    ],
  },
  {
    title: "Tools",
    items: [
      {
        label: "Nearby services",
        to: "/nearby",
        icon: MapPinned,
        description: "Hospitals, police, fire, blood banks",
      },
      donorsNav,
      coreNav,
      notesNav,
      documentsNav,
    ],
  },
  {
    title: "Account",
    items: [
      { label: "Profile", to: "/profile", icon: UserRound, description: "Account details" },
      { label: "Settings", to: "/settings", icon: Settings, description: "Preferences & privacy" },
      { label: "About", to: "/about", icon: Info, description: "Platform information" },
      supportPageNav,
    ],
  },
];
