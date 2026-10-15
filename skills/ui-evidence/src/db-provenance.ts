// skills/ui-evidence/src/db-provenance.ts — spec F15: evidence stays entirely
// local unless the DB is seeded/scrubbed data only (RF-2). `query` is
// injected so this file never hardcodes a DB driver; the caller supplies one
// (e.g. `docker exec "$UI_EVIDENCE_DB_CONTAINER" psql`).
//
// Which table holds the user emails, and which domains and email pattern
// count as "seed data", are deployment-specific, so they come from config
// (UI_EVIDENCE_SEED_TABLE, UI_EVIDENCE_SEED_DOMAINS,
// UI_EVIDENCE_SEED_EMAIL_PATTERN — see SKILL.md). With no table configured
// the check can't run and provenance stays "unknown"; the domain and pattern
// defaults only match fictional example.com addresses. Either way an
// unconfigured install fails closed (evidence stays local)
const DEFAULT_SEED_DOMAINS = ["example.com"];
const DEFAULT_SEED_EMAIL_PATTERN = "seed-admin-%@example.com";

function getAllowedDomains(): string[] {
  const raw = process.env.UI_EVIDENCE_SEED_DOMAINS;
  if (!raw || raw.trim() === "") return DEFAULT_SEED_DOMAINS;
  return raw
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
}

// A table name, optionally schema-qualified: it is spliced into the SQL, so
// nothing but plain identifiers is accepted.
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

function getSeedTable(): string | { error: string } {
  const raw = process.env.UI_EVIDENCE_SEED_TABLE?.trim();
  if (raw === undefined || raw === "") return { error: "no seed table configured (set UI_EVIDENCE_SEED_TABLE)" };
  return TABLE_NAME.test(raw) ? raw : { error: "UI_EVIDENCE_SEED_TABLE is not a plain [schema.]table name" };
}

function getSeedEmailPattern(): string {
  const raw = process.env.UI_EVIDENCE_SEED_EMAIL_PATTERN;
  return raw && raw.trim() !== "" ? raw : DEFAULT_SEED_EMAIL_PATTERN;
}

export interface ProvenanceResult {
  provenance: "seeded" | "unknown";
  reason: string;
}

export async function checkDbProvenance(query: (sql: string) => Promise<unknown[]>): Promise<ProvenanceResult> {
  try {
    const table = getSeedTable();
    if (typeof table !== "string") return { provenance: "unknown", reason: table.error };
    const allowedDomains = getAllowedDomains();
    const seedPattern = getSeedEmailPattern();
    const seedRows = await query(`SELECT email FROM ${table} WHERE email LIKE '${seedPattern}'`);
    if (seedRows.length === 0) {
      return { provenance: "unknown", reason: `no seed row found in ${table}` };
    }

    const allRows = (await query(`SELECT email FROM ${table}`)) as Array<{ email: string }>;
    for (const row of allRows) {
      const domain = row.email.split("@")[1];
      if (domain === undefined || !allowedDomains.includes(domain)) {
        return { provenance: "unknown", reason: `a profile row's email domain ("${row.email}") doesn't look like a seed — this data may be real` };
      }
    }

    return { provenance: "seeded", reason: "seed row present, every profile email domain is an allowed seed domain" };
  } catch (err) {
    return { provenance: "unknown", reason: err instanceof Error ? err.message : String(err) };
  }
}
