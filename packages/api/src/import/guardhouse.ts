import { parse } from "csv-parse/sync";
import { checkpoints, circlePolygonWkt, pointWkt, sites, users, writeAudit, type Db } from "@gatehouse/db";

export type Issue = { level: "ERROR" | "WARNING"; message: string };
export type GuardRow = {
  row: number; firstName: string; lastName: string; email: string; mobile: string;
  siaBadgeNumber: string; siaLicenceExpiry: Date | null; employmentType: "FULL_TIME" | "RELIEF_BANK"; issues: Issue[];
};
export type CheckpointRow = { name: string; externalTagUid: string };
export type SiteRow = {
  row: number; name: string; address: string; postcode: string; lat: number | null; lng: number | null;
  checkpoints: CheckpointRow[]; issues: Issue[];
};

const records = (csv: string) =>
  parse(csv, { columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true, relax_column_count: true }) as Record<string, string>[];
const pick = (r: Record<string, string>, ...keys: string[]) => keys.map((k) => r[k]).find((v) => v !== undefined && v !== "") ?? "";

/** Accepts dd/mm/yyyy (Guardhouse/UK) or ISO yyyy-mm-dd. */
export function parseUkDate(s: string): Date | null {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s) ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [a, b, c] = m.slice(1).map(Number) as [number, number, number];
  const [y, mo, d] = m[0]!.match(/^\d{4}/) ? [a, b, c] : [c, b, a];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}

export function previewGuardsCsv(csv: string, now = new Date()): GuardRow[] {
  const seen = new Set<string>();
  return records(csv).map((r, i) => {
    const issues: Issue[] = [];
    const email = pick(r, "email").toLowerCase();
    const expiry = parseUkDate(pick(r, "licence expiry", "license expiry", "sia expiry"));
    const emp = pick(r, "employment type").toLowerCase();
    if (!email) issues.push({ level: "ERROR", message: "Email is required" });
    else if (seen.has(email)) issues.push({ level: "ERROR", message: "Duplicate email in file" });
    seen.add(email);
    if (!pick(r, "first name") || !pick(r, "last name")) issues.push({ level: "ERROR", message: "Name is required" });
    if (!expiry) issues.push({ level: "ERROR", message: "Licence expiry missing or unparseable" });
    else if (expiry.getTime() + 86_399_999 < now.getTime()) issues.push({ level: "WARNING", message: "SIA licence EXPIRED: guard will be blocked from assignment" });
    if (!pick(r, "sia licence number", "sia licence", "sia number")) issues.push({ level: "WARNING", message: "No SIA licence number" });
    return {
      row: i + 2, firstName: pick(r, "first name"), lastName: pick(r, "last name"), email, mobile: pick(r, "mobile"),
      siaBadgeNumber: pick(r, "sia licence number", "sia licence", "sia number"), siaLicenceExpiry: expiry,
      employmentType: /relief|bank/.test(emp) ? "RELIEF_BANK" : "FULL_TIME", issues,
    };
  });
}

/** One row per checkpoint; rows sharing Site Name are grouped. Duplicate tag UIDs within a site keep the first. */
export function previewSitesCsv(csv: string): SiteRow[] {
  const bySite = new Map<string, SiteRow>();
  records(csv).forEach((r, i) => {
    const name = pick(r, "site name");
    const key = name.toLowerCase();
    let site = bySite.get(key);
    if (!site) {
      const lat = parseFloat(pick(r, "latitude", "lat")), lng = parseFloat(pick(r, "longitude", "lng", "lon"));
      const issues: Issue[] = [];
      if (!name) issues.push({ level: "ERROR", message: "Site name is required" });
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) issues.push({ level: "ERROR", message: "Latitude/longitude required to build geofence (geocode the postcode first)" });
      else if (lat < 49.8 || lat > 60.9 || lng < -8.7 || lng > 1.8) issues.push({ level: "ERROR", message: "Coordinates are outside the UK" });
      site = { row: i + 2, name, address: pick(r, "address"), postcode: pick(r, "postcode").toUpperCase(), lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null, checkpoints: [], issues };
      bySite.set(key, site);
    }
    const uid = pick(r, "tag uid", "qr/nfc tag uid", "tag id", "checkpoint tag");
    if (uid) {
      if (site.checkpoints.some((c) => c.externalTagUid === uid)) site.issues.push({ level: "WARNING", message: `Duplicate tag UID "${uid}" (row ${i + 2}) skipped` });
      else site.checkpoints.push({ name: pick(r, "checkpoint name", "checkpoint") || `Checkpoint ${site.checkpoints.length + 1}`, externalTagUid: uid });
    }
  });
  return [...bySite.values()];
}

export type CommitResult = { guardsCreated: number; guardsSkipped: number; sitesCreated: number; checkpointsCreated: number };

/** Single transaction; rows with ERROR issues are never imported. Bulk event goes to the audit log. */
export async function commitGuardhouseImport(db: Db, o: { organisationId: string; actorId: string | null; ipAddress?: string | null; guards?: GuardRow[]; sites?: SiteRow[] }): Promise<CommitResult> {
  return db.transaction(async (tx) => {
    const res: CommitResult = { guardsCreated: 0, guardsSkipped: 0, sitesCreated: 0, checkpointsCreated: 0 };
    for (const g of o.guards ?? []) {
      if (g.issues.some((i) => i.level === "ERROR")) { res.guardsSkipped++; continue; }
      const inserted = await tx.insert(users).values({
        organisationId: o.organisationId, role: "STATIC_GUARD", firstName: g.firstName, lastName: g.lastName, email: g.email,
        mobile: g.mobile, employmentType: g.employmentType, siaBadgeNumber: g.siaBadgeNumber, siaLicenceExpiry: g.siaLicenceExpiry,
        bs7858VettingStatus: "PENDING", // vetting is never inferred from an import
      }).onConflictDoNothing().returning({ id: users.id });
      inserted.length ? res.guardsCreated++ : res.guardsSkipped++;
    }
    for (const s of o.sites ?? []) {
      if (s.issues.some((i) => i.level === "ERROR") || s.lat === null || s.lng === null) continue;
      const [site] = await tx.insert(sites).values({
        organisationId: o.organisationId, name: s.name, address: s.address, postcode: s.postcode,
        centre: pointWkt(s.lat, s.lng), geofence: circlePolygonWkt(s.lat, s.lng, 75), radiusMeters: 75,
      }).returning({ id: sites.id });
      res.sitesCreated++;
      if (s.checkpoints.length) {
        const rows = await tx.insert(checkpoints).values(s.checkpoints.map((c) => ({
          siteId: site!.id, name: c.name, externalTagUid: c.externalTagUid, location: pointWkt(s.lat!, s.lng!),
        }))).onConflictDoNothing().returning({ id: checkpoints.id });
        res.checkpointsCreated += rows.length;
      }
    }
    await writeAudit(tx, { actorId: o.actorId, ipAddress: o.ipAddress, action: "BULK_IMPORT_GUARDHOUSE", entityType: "organisation", entityId: o.organisationId, newValues: res });
    return res;
  });
}
