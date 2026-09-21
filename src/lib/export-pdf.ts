import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Emergency, EmergencyContact, Profile } from "@/lib/api";
import type { EmergencyNote } from "@/lib/resqora-data";
import { statusLabel, formatDuration } from "@/lib/emergency";

function header(doc: jsPDF, title: string, subtitle: string) {
  doc.setFillColor(220, 38, 38);
  doc.rect(0, 0, 210, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.text("RESQORA", 14, 12);
  doc.setFontSize(10);
  doc.text(title, 14, 20);
  doc.setTextColor(90, 90, 90);
  doc.setFontSize(9);
  doc.text(subtitle, 14, 34);
  doc.setTextColor(0, 0, 0);
}

export function exportMedicalProfilePdf(input: {
  profile: Profile | null | undefined;
  contacts: EmergencyContact[];
  notes: EmergencyNote[];
}) {
  const { profile, contacts, notes } = input;
  const doc = new jsPDF();
  header(
    doc,
    "Emergency medical profile",
    `Generated ${new Date().toLocaleString()} — present to first responders`,
  );

  autoTable(doc, {
    startY: 40,
    head: [["Field", "Value"]],
    body: [
      ["Full name", profile?.full_name || "—"],
      ["Date of birth", profile?.date_of_birth || "—"],
      ["Gender", profile?.gender || "—"],
      ["Blood group", profile?.blood_group || "—"],
      ["Phone", profile?.phone || "—"],
      ["Email", profile?.email || "—"],
      ["Allergies", profile?.allergies || "None recorded"],
      ["Medical conditions", profile?.medical_conditions || "None recorded"],
      ["Medications", profile?.medications || "None recorded"],
      ["Home address", profile?.home_address || "—"],
      ["Current city", profile?.current_city || "—"],
    ],
    theme: "striped",
    headStyles: { fillColor: [37, 99, 235] },
    styles: { fontSize: 9, cellPadding: 2.5 },
  });

  autoTable(doc, {
    head: [["Emergency contact", "Relationship", "Phone"]],
    body: contacts.length
      ? contacts.map((c) => [c.name, c.relationship, c.phone])
      : [["No contacts saved", "—", "—"]],
    theme: "striped",
    headStyles: { fillColor: [220, 38, 38] },
    styles: { fontSize: 9, cellPadding: 2.5 },
  });

  if (notes.length) {
    autoTable(doc, {
      head: [["Emergency note", "Category", "Details"]],
      body: notes.map((n) => [n.title, n.category, n.content]),
      theme: "striped",
      headStyles: { fillColor: [15, 23, 42] },
      styles: { fontSize: 9, cellPadding: 2.5 },
    });
  }

  doc.save(`resqora-medical-profile-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function exportEmergencyHistoryPdf(input: {
  profile: Profile | null | undefined;
  emergencies: Emergency[];
}) {
  const { profile, emergencies } = input;
  const doc = new jsPDF();
  header(
    doc,
    "Emergency history",
    `${profile?.full_name || "RESQORA user"} — ${emergencies.length} recorded incident${emergencies.length === 1 ? "" : "s"}`,
  );

  autoTable(doc, {
    startY: 40,
    head: [["Date", "Type", "Severity", "Status", "Duration", "Location"]],
    body: emergencies.length
      ? emergencies.map((e) => [
          new Date(e.started_at).toLocaleString(),
          e.type,
          e.severity,
          statusLabel(e.status),
          formatDuration(e.duration_seconds),
          e.latitude != null && e.longitude != null
            ? `${e.latitude.toFixed(4)}, ${e.longitude.toFixed(4)}`
            : e.address || "—",
        ])
      : [["No incidents recorded", "—", "—", "—", "—", "—"]],
    theme: "striped",
    headStyles: { fillColor: [220, 38, 38] },
    styles: { fontSize: 8, cellPadding: 2 },
  });

  doc.save(`resqora-emergency-history-${new Date().toISOString().slice(0, 10)}.pdf`);
}

/**
 * After-action report for a single incident: what happened, how quickly, who
 * responded, where care was handed over and what recovery work remains.
 */
export function exportIncidentReportPdf(input: {
  incident: {
    public_code: string | null;
    incident_type: string;
    severity: string;
    phase: string;
    started_at: string;
    resolved_at: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    incident_description: string | null;
    ai_summary: string | null;
    victim_count: number;
    is_mass_casualty: boolean;
    is_simulation: boolean;
  };
  phaseLabel: string;
  metrics: Array<[string, string]>;
  units: Array<[string, string, string]>;
  people: Array<[string, string, string, string]>;
  handover: Array<[string, string]>;
  recovery: Array<[string, string]>;
  timeline: Array<[string, string, string]>;
}) {
  const { incident } = input;
  const doc = new jsPDF();
  const reference = incident.public_code || "—";
  header(
    doc,
    `Incident after-action report — ${reference}`,
    `${incident.is_simulation ? "SIMULATION — not a real incident. " : ""}Generated ${new Date().toLocaleString()}`,
  );

  autoTable(doc, {
    startY: 40,
    head: [["Incident", "Detail"]],
    body: [
      ["Reference", reference],
      ["Type", incident.incident_type],
      ["Severity", incident.severity],
      ["Stage reached", input.phaseLabel],
      ["Started", new Date(incident.started_at).toLocaleString()],
      [
        "Closed",
        incident.resolved_at ? new Date(incident.resolved_at).toLocaleString() : "Still open",
      ],
      [
        "Location",
        incident.address ||
          (incident.latitude != null && incident.longitude != null
            ? `${incident.latitude.toFixed(4)}, ${incident.longitude.toFixed(4)}`
            : "Not recorded"),
      ],
      ["People involved", String(incident.victim_count)],
      ["Mass-casualty", incident.is_mass_casualty ? "Yes" : "No"],
      ["Description", incident.incident_description || "—"],
      ["AI assessment", incident.ai_summary || "—"],
    ],
    theme: "striped",
    headStyles: { fillColor: [220, 38, 38] },
    styles: { fontSize: 9, cellPadding: 2.5 },
  });

  autoTable(doc, {
    head: [["Response timing", "Measured"]],
    body: input.metrics.length ? input.metrics : [["No timing recorded", "—"]],
    theme: "striped",
    headStyles: { fillColor: [37, 99, 235] },
    styles: { fontSize: 9, cellPadding: 2.5 },
  });

  autoTable(doc, {
    head: [["Unit dispatched", "Type", "Status"]],
    body: input.units.length ? input.units : [["No unit dispatched", "—", "—"]],
    theme: "striped",
    headStyles: { fillColor: [15, 23, 42] },
    styles: { fontSize: 9, cellPadding: 2.5 },
  });

  autoTable(doc, {
    head: [["Person", "Priority", "Status", "Hospital"]],
    body: input.people.length ? input.people : [["No individual records", "—", "—", "—"]],
    theme: "striped",
    headStyles: { fillColor: [5, 150, 105] },
    styles: { fontSize: 9, cellPadding: 2.5 },
  });

  autoTable(doc, {
    head: [["Hospital handover", "Detail"]],
    body: input.handover.length ? input.handover : [["No handover recorded", "—"]],
    theme: "striped",
    headStyles: { fillColor: [147, 51, 234] },
    styles: { fontSize: 9, cellPadding: 2.5 },
  });

  autoTable(doc, {
    head: [["Recovery step", "State"]],
    body: input.recovery,
    theme: "striped",
    headStyles: { fillColor: [180, 83, 9] },
    styles: { fontSize: 9, cellPadding: 2.5 },
  });

  autoTable(doc, {
    head: [["Time", "Event", "Detail"]],
    body: input.timeline.length ? input.timeline : [["—", "No timeline entries", "—"]],
    theme: "striped",
    headStyles: { fillColor: [71, 85, 105] },
    styles: { fontSize: 8, cellPadding: 2 },
  });

  doc.save(`resqora-incident-report-${reference}.pdf`);
}
