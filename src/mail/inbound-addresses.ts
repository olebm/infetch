import crypto from "node:crypto";
import { sql } from "@/lib/db/client";
import { appConfig } from "@/lib/config/env";

export type InboundAddressRow = {
  id: string;
  organizationId: string | null;
  localPart: string;
  enabled: boolean;
  lastReceivedAt: string | null;
  receivedCount: number;
  fullAddress: string;
};

type RawRow = {
  id: string;
  organizationId: string | null;
  localPart: string;
  enabled: boolean;
  lastReceivedAt: string | null;
  receivedCount: number;
};

function rowToInboundAddress(row: RawRow): InboundAddressRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    localPart: row.localPart,
    enabled: Boolean(row.enabled),
    lastReceivedAt: row.lastReceivedAt,
    receivedCount: row.receivedCount,
    fullAddress: `${row.localPart}@${appConfig.resendInbound.domain}`,
  };
}

/**
 * Generiert einen short, URL-sicheren local-part fuer die Inbound-Adresse.
 * 16 hex chars = 64 bits entropy — fuer humans copy-paste-friendly.
 */
function generateLocalPart(): string {
  return crypto.randomBytes(8).toString("hex");
}

export async function getInboundAddressForOrg(
  organizationId: string,
): Promise<InboundAddressRow | null> {
  const rows = await sql<RawRow[]>`
    SELECT id, organization_id AS "organizationId", local_part AS "localPart",
           enabled, last_received_at AS "lastReceivedAt", received_count AS "receivedCount"
    FROM mail_inbound_addresses
    WHERE organization_id = ${organizationId} AND deleted_at IS NULL
    ORDER BY created_at
    LIMIT 1
  `;
  return rows[0] ? rowToInboundAddress(rows[0]) : null;
}

export async function ensureInboundAddressForOrg(
  organizationId: string,
): Promise<InboundAddressRow> {
  const existing = await getInboundAddressForOrg(organizationId);
  if (existing) return existing;

  const id = crypto.randomUUID();
  let localPart = generateLocalPart();
  // Sehr unwahrscheinlich, aber: bei Kollision neuen Wert nehmen
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const exists = await sql`SELECT 1 FROM mail_inbound_addresses WHERE local_part = ${localPart}`;
    if (exists.length === 0) break;
    localPart = generateLocalPart();
  }

  await sql`
    INSERT INTO mail_inbound_addresses (id, organization_id, local_part)
    VALUES (${id}, ${organizationId}, ${localPart})
  `;

  return rowToInboundAddress({
    id,
    organizationId,
    localPart,
    enabled: true,
    lastReceivedAt: null,
    receivedCount: 0,
  });
}

export async function findInboundAddressByLocalPart(
  localPart: string,
): Promise<InboundAddressRow | null> {
  const rows = await sql<RawRow[]>`
    SELECT id, organization_id AS "organizationId", local_part AS "localPart",
           enabled, last_received_at AS "lastReceivedAt", received_count AS "receivedCount"
    FROM mail_inbound_addresses
    WHERE local_part = ${localPart} AND deleted_at IS NULL AND enabled = TRUE
  `;
  return rows[0] ? rowToInboundAddress(rows[0]) : null;
}

export async function recordInboundDelivery(addressId: string): Promise<void> {
  await sql`
    UPDATE mail_inbound_addresses
    SET last_received_at = CURRENT_TIMESTAMP,
        received_count = received_count + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${addressId}
  `;
}
