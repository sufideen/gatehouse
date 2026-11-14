import { PILOT_RETENTION_DAYS } from "@gatehouse/api/privacy";

export const POLICY_VERSION = "pilot-v1";

/** Single source for the pilot privacy notice (web join page and the mobile app both render this). Replace with your reviewed notice. */
export const NOTICE = [
  { title: "What this is", body: "A test of a scheduling and lone-worker app. Taking part is voluntary and does not affect your job." },
  { title: "What we collect", body: "Only what you tick, plus your work activity during the test (clock-ins with GPS and a selfie, checkpoint scans, welfare checks, incident reports)." },
  { title: "How long", body: `Everything personal is automatically deleted or anonymised ${PILOT_RETENTION_DAYS} days after you join. You can withdraw or delete everything yourself at any time from "My data".` },
  { title: "Your rights", body: `Access, correction, erasure and objection under UK GDPR. Notice version ${POLICY_VERSION}. (Replace this text with your reviewed privacy notice and controller contact before real use.)` },
];

export const SCOPE_INFO = [
  { scope: "IDENTITY", label: "Name and work email", required: true },
  { scope: "CONTACT", label: "Mobile number", required: false },
  { scope: "SIA_DETAILS", label: "SIA badge number and expiry", required: false },
] as const;
