# Research: Signed-URL-Pfad für PDF-Delivery trotz Storage-Encryption

**Status:** Recherche · entscheidungsreif
**Stakeholder:** Ole (User-Decision benötigt)
**Plane-Issue:** [INFETCH-172](https://plane.betaform.io)
**Datum:** 2026-05-20

---

## Problem

Aktueller PDF-Auslieferungspfad ([src/app/api/invoice-files/[fileId]/route.ts](../src/app/api/invoice-files/%5BfileId%5D/route.ts)):

```
Browser → /api/invoice-files/[fileId]
            ↓
         Node-Runtime:
           1. Auth + Org-Check
           2. downloadFromStorage(stored_path)   ← lädt Ciphertext
           3. decryptBuffer(ciphertext, vaultKey) ← entschlüsselt server-side
           4. Response.body = plaintext
            ↓
         Browser zeigt PDF
```

**Skalierungs-Issues bei Wachstum:**
- Jede PDF-View geht durch den Node-Prozess → Memory + CPU + Bandwidth-Cost pro Request
- Kein CDN-/Browser-Caching möglich (Auth-gated dynamic response)
- Bei mehreren parallelen Tabs/Viewern → linear wachsender Footprint
- Sentry-Bandbreite bei Error-Replays unnötig groß

**Warum signed URLs aktuell nicht funktionieren:** Storage-Objekte sind mit AES-256-GCM verschlüsselt ([src/lib/secrets/storage-crypto.ts](../src/lib/secrets/storage-crypto.ts)). Eine Supabase Signed URL liefert den **rohen Ciphertext**. Der Browser hat den Vault-Key nicht (soll ihn auch nicht haben), kann also nicht entschlüsseln. Direkter Signed-URL-Switch ist nicht möglich.

---

## 4 Optionen

### Option A — Proxy bleibt (Status Quo)

**Was:** Nichts ändern. Aktueller Pfad bleibt.

**Sicherheit:** Höchste Stufe — Key bleibt im Vault, Ciphertext nie ohne Server-Mediation.

**Performance:**
- Latenz: ~50-200 ms Server-Roundtrip (Storage-Download + Decrypt)
- Throughput: limitiert durch Node-Worker-Pool (Coolify default ~4 Worker)
- Cost: Node-Server-Bandbreite skaliert linear mit Views

**Komplexität:** 0 (kein Code-Change)

**Wann sinnvoll:**
- Wenn pro User < 50 PDF-Views/Tag erwartet (aktuelle Realität für Free-Tier)
- Wenn Audit-Trail jeder View-Operation wichtig ist (kann man in der Route loggen)
- Wenn Migration-Risiko nicht gerechtfertigt ist

**Caveats:**
- Engpass: wenn Großkunden viele Views pro Sekunde produzieren, blockiert das andere Routes
- Mistral-Extraktion + PDF-View laufen auf demselben Worker-Pool

---

### Option B — Re-Encryption-Strategie (Hybrid Cipher + Signed URL)

**Was:** Storage-Objekt bleibt mit Master-Key verschlüsselt. Bei Read-Request:
1. Server entschlüsselt
2. Re-verschlüsselt mit einem **kurzlebigen ephemeren Key** (z.B. AES-GCM mit 5-min-TTL)
3. Schreibt das re-encrypted Objekt in einen separaten Cache-Bucket (z.B. `invoices-temp`)
4. Generiert eine signed URL zu `invoices-temp/{id}-{ephemeral-key-hash}.bin`
5. Liefert URL + ephemeren Key als JSON an Client
6. Client lädt Ciphertext direkt aus Storage, entschlüsselt mit WebCrypto

**Sicherheit:** Mittel — ephemerer Key wandert via TLS zum Browser. Wenn Browser-Memory leaked (XSS, Browser-Extension), kann der Key innerhalb der TTL missbraucht werden. Storage-Cache hat eine TTL-basierte Garbage-Collection.

**Performance:**
- Erster Read: ~50-200 ms (Decrypt + Re-Encrypt + Upload) — leicht langsamer als Status Quo
- Folge-Reads desselben PDF: schnell (signed URL bedient CDN-Cache)
- Throughput: deutlich höher — Node-Server hat keinen Bandwidth-Drain mehr

**Komplexität:** Hoch
- Separater Storage-Bucket + Lifecycle-Policy (TTL-Cleanup)
- WebCrypto-Decryption im Browser (Subset von Node-Crypto, mit Stolperfallen)
- Key-Delivery via JSON-API + Caching-Logik
- Audit: View-Logging muss expliziter, da signed URLs Server umgehen

**Wann sinnvoll:**
- Wenn PDF-Views der Haupt-Bandbreite-Treiber werden
- Wenn ephemere Keys (~5 min) als Sicherheits-Trade-off akzeptiert werden
- Self-hosted Plan in Reichweite

**Caveats:**
- Re-Encryption-Workflow ist ein neuer Failure-Mode (Storage-Cache-Inkonsistenz, Cleanup-Lecks)
- Browser-Compatibility: WebCrypto AES-GCM ist überall verfügbar, aber Edge-Cases bei alten Versionen
- Bei vielen kleinen PDFs (Free-Tier-Reality): Cache-Bucket füllt sich schnell → Disk-Cost

---

### Option C — Per-File Data Encryption Keys (DEKs) + Envelope-Encryption-2

**Was:** Verschiebt das Encryption-Modell von "ein Master-Key für alles" auf Standard-DEK-Pattern:
1. Pro PDF wird beim Upload ein zufälliger DEK (32 Byte) generiert
2. Das PDF wird mit dem DEK verschlüsselt (wie heute)
3. Der DEK wird mit dem Master-Key (Vault) ge-wrapped und im DB-Feld `invoice_files.wrapped_dek` gespeichert
4. Bei Read-Request: Server entwrapt den DEK, liefert ihn + signed URL als JSON
5. Client decrypted mit WebCrypto

**Sicherheit:** Mittel — siehe Option B, aber stabiler:
- Storage-Bytes werden nie re-encrypted (kein TTL-Cache nötig)
- DEK ist per Datei einzigartig — bei Key-Leak ist nur diese eine PDF kompromittiert
- Master-Key bleibt im Vault, wird nur server-side für DEK-Unwrap genutzt

**Performance:**
- Read: ~10-30 ms Server (nur DEK-Unwrap + signed-URL-Generierung), keine Storage-Download im Node
- Browser lädt Bytes direkt von Supabase Storage (CDN-Edge möglich)
- Throughput: Node-Server-Load drastisch reduziert

**Komplexität:** Hoch (Schema-Migration + Re-Encryption aller Bestandsdateien)
- Migration: neuer Spalte `wrapped_dek` auf `invoice_files`
- Backfill-Pfad: jedes existierende PDF muss ent- und neu mit DEK verschlüsselt werden (große Datenmigration, Hours-To-Days)
- Encryption-Code muss DEK-Pattern unterstützen (kleine Anpassung)
- Browser-Decrypt-Code wie Option B

**Wann sinnvoll:**
- Wenn Re-Encryption aller PDFs einmalig akzeptabel ist (langer Cron oder Background-Job)
- Wenn das saubere "ein Bestand, kein TTL-Cache"-Modell präferiert wird
- Wenn größere Org-Wachstums-Phasen erwartet werden

**Caveats:**
- Migration ist nicht trivial — Rollback-Plan benötigt
- DEK im Klartext kurz im Server-Memory + JSON-Response — Logging/Sentry-Sanitizing nötig

---

### Option D — Range-Streaming-Optimierung (Mini-Verbesserung)

**Was:** Proxy bleibt, aber:
1. Server-Decrypt arbeitet mit **Range-Headern** (Partial-Content)
2. Browser fordert nur die Bytes an, die der PDF-Viewer aktuell zeigt
3. Decrypt-Stream wird mit Backpressure korrekt verbunden (kein Buffer in Memory)

**Sicherheit:** Wie Status Quo — Key bleibt im Vault.

**Performance:**
- Time-to-First-Byte: 50-80 ms (statt 200 ms volle Decrypt)
- Großvolumige PDFs (~5 MB): User sieht erste Seite schneller, Rest streamt nach
- Throughput: leicht besser als Status Quo

**Komplexität:** Mittel (eine Route + AES-CTR-Mode statt GCM für Random-Access)
- AES-GCM hat keinen sicheren Random-Access (Authentication-Tag am Ende)
- Wechsel zu AES-CTR mit separatem HMAC für Authentication, oder Chunked-GCM mit pro-Chunk-Tags
- Backwards-compat-Logic für Bestandsdateien

**Wann sinnvoll:**
- Wenn Status Quo ausreicht aber Time-to-First-Byte das Haupt-UX-Problem ist
- Wenn Schema-Migration vermieden werden soll
- Als Zwischenschritt vor B oder C

**Caveats:**
- Crypto-Refactor ist riskant (CTR ohne HMAC = no integrity)
- PDF-Viewer-Range-Header-Verhalten ist Browser-spezifisch (Chrome vs Firefox vs Safari)

---

## Trade-off-Matrix

| Kriterium | A · Status Quo | B · Re-Encryption | C · Per-File DEK | D · Range-Stream |
|---|---|---|---|---|
| Sicherheit | ★★★★★ | ★★★ | ★★★★ | ★★★★★ |
| Performance | ★★ | ★★★★ | ★★★★★ | ★★★ |
| Komplexität (Effort) | ★★★★★ | ★★ | ★ | ★★★ |
| Migration-Risiko | ★★★★★ (keine) | ★★★★ | ★★ (Backfill) | ★★★ |
| Cost @ Scale | ★ (linear in Server) | ★★★★ | ★★★★★ | ★★ |
| Implementierungszeit (Schätzung) | 0 | 2-3 Tage | 3-4 Tage + Backfill | 1 Tag |
| Reversibel? | ja | mittel | nur mit Rollback-Plan | ja |

★ = niedrig, ★★★★★ = hoch.

---

## Empfehlung

**Aktuell empfohlen: Option A (Status Quo)** — explizit als bewusste Entscheidung dokumentieren.

**Begründung:**
- Free-Tier-Realität (30 Rechnungen/Monat, niedrige View-Häufigkeit) macht den Bandwidth-Druck noch nicht zum Engpass
- Sicherheits-Posture ist maximal — Key verlässt nie das Backend
- Die anderen drei Optionen haben echte Komplexitätskosten, die mit ungeklärten Engpass-Daten nicht zu rechtfertigen sind
- Eine **Monitoring-Aufgabe** ergänzen: Sentry-Performance-Tracking auf `/api/invoice-files/[fileId]` einrichten, p95-Latenz und Worker-Saturation messen → bei realem Engpass ist Option C der saubere nächste Schritt

**Empfohlener nächster Schritt nach User-Entscheidung "A":**
1. Performance-Tracking aktivieren (Sentry-Transactions auf der PDF-Route)
2. Threshold definieren (z.B. p95 > 500 ms ODER >10 req/s sustained)
3. Bei Erreichen des Threshold: Folge-Issue für Option C (DEK-Migration) öffnen

**Falls User-Entscheidung "C":**
- Schema-Migration vorbereiten (`invoice_files.wrapped_dek` Spalte)
- Backfill-Plan (Background-Cron, idempotent)
- Browser-Decrypt-Lib (WebCrypto-Wrapper, Tests)
- Geschätzter Aufwand: 3-4 Tage + Backfill-Laufzeit

**Falls User-Entscheidung "D" als Zwischenschritt:**
- AES-GCM bleibt; Range-Header-Support in der Route + node-Stream-Decrypt
- Geschätzter Aufwand: 1 Tag

---

## Anhang — Code-Referenzen

- Aktueller Decrypt-Pfad: [src/lib/secrets/storage-crypto.ts](../src/lib/secrets/storage-crypto.ts) (`decryptBuffer`, AES-256-GCM Envelope)
- Aktuelle Route: [src/app/api/invoice-files/[fileId]/route.ts](../src/app/api/invoice-files/%5BfileId%5D/route.ts)
- Storage-Helper: [src/lib/supabase/storage.ts](../src/lib/supabase/storage.ts) (`downloadFromStorage`, `BUCKETS`)
- Encryption-Tests: [tests/unit/storage-crypto.test.ts](../tests/unit/storage-crypto.test.ts), [tests/unit/storage-encryption.test.ts](../tests/unit/storage-encryption.test.ts)

## Anhang — Bestands-Code, der angefasst werden müsste

| Option | Files (geschätzt) |
|---|---|
| A | keine |
| B | `storage-crypto.ts` (Re-Encryption-Funktion), `invoice-files/[fileId]/route.ts`, `src/lib/supabase/storage.ts` (zweiter Bucket), neuer Browser-Decrypt-Helper, Lifecycle-Policy in Supabase Dashboard |
| C | `storage-crypto.ts`, neue Migration für `wrapped_dek`-Spalte, Backfill-Cron, `invoice-files/[fileId]/route.ts`, Browser-Decrypt-Helper, Upload-Path in `import-pipeline.ts` |
| D | `storage-crypto.ts` (CTR-Mode + HMAC), `invoice-files/[fileId]/route.ts`, Stream-Adapter, Backwards-Compat-Read-Path |

---

## Wie entscheidest du?

Bitte einen Plane-Kommentar an [INFETCH-172](https://plane.betaform.io) mit:
- **Gewählte Option:** A / B / C / D
- **Begründung:** ein Satz reicht
- Optional: Threshold/Trigger-Bedingungen für eine spätere Re-Evaluation

Dann öffne ich (oder du) ein Folge-Issue mit konkretem Implementierungs-Plan, falls B/C/D gewählt — oder schließe INFETCH-172 mit Verweis auf das Monitoring-Issue, falls A.
