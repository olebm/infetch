# Runbook (Vorlage) — Egress-Firewall der Worker-Box (INFETCH-269)

Netzwerk-Layer-Defense-in-Depth zusätzlich zur Code-Allowlist (#139) und
Install-Validierung (#142). Selbst wenn das Code-Enforcement umgangen würde
(Bug, neue Step-Art), soll die Worker-Box ausgehend **nur Portal-Ziele** (+ DB,
+ Mistral) erreichen — keine beliebige Exfiltration.

> **Status:** Vorlage. Setzt die getrennte Worker-Box aus dem 2-Service-Split
> voraus (Web + Worker getrennt, siehe [0032-chokepoint-deploy.md](0032-chokepoint-deploy.md)).
> Kein Prod-/Infra-Zugriff von Claude — Ausführung liegt bei Ole.

## Warum ein Proxy, keine reine IP-Firewall

Vendor-Portale liegen hinter CDNs (Cloudflare/Akamai) mit **rotierenden IPs** →
eine IP-Allowlist ist nicht wartbar und löchrig. Domain-Enforcement braucht einen
**Egress-Proxy**, der die `CONNECT`-Zieldomain prüft (ohne TLS aufzubrechen).
Die IP-Firewall bleibt als grober Backstop darunter.

## Layer 1 — Squid als Egress-Proxy (Domain-Allowlist)

Squid auf der Worker-Box; der Browser des Agents nutzt ihn. Squid erlaubt nur
`CONNECT` auf Allowlist-Domains, alles andere 403 — ohne TLS-Interception (es
sieht nur den Zielhost im CONNECT).

`/etc/squid/squid.conf` (Auszug):

```squid
acl SSL_ports port 443
acl CONNECT method CONNECT
acl allowed_dstdomains dstdomain "/etc/squid/allowed-domains.txt"

http_port 3128

http_access deny CONNECT !SSL_ports
http_access allow CONNECT allowed_dstdomains
http_access deny all
```

`/etc/squid/allowed-domains.txt` (führender Punkt = inkl. Subdomains):

```
# KI
.mistral.ai
# Portal-Domains — aus der DB generiert (siehe SQL unten)
.enbw.com
.adobe.com
# … pro aktivem Vendor eine Zeile
```

**Allowlist aus der DB generieren** (Hosts der aktiven Portal-Vendoren):

```sql
SELECT DISTINCT regexp_replace(portal_login_url, '^https?://([^/]+).*$', '\1') AS host
FROM vendors
WHERE portal_login_url IS NOT NULL
ORDER BY host;
```

→ Ausgabe als `.host`-Zeilen in `allowed-domains.txt` übernehmen, dann
`squid -k reconfigure`. (Registrable-Domain genügt, z. B. `.enbw.com` deckt
`login.enbw.com` + `www.enbw.com` ab.)

## Layer 2 — Code-Hook: Browser über den Proxy zwingen

Eine Zeile in `src/portals/agent/agent-connector.ts` an der `chromium.launch`-Stelle
(aktuell ~Z. 109), env-gated (No-op, solange die Variable nicht gesetzt ist):

```ts
await chromium.launch({
  headless,
  proxy: process.env.PORTAL_EGRESS_PROXY
    ? { server: process.env.PORTAL_EGRESS_PROXY }   // z. B. http://127.0.0.1:3128
    : undefined,
  args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
});
```

Coolify-ENV der Worker-Box: `PORTAL_EGRESS_PROXY=http://127.0.0.1:3128`.

> Diese Code-Zeile ist bewusst noch **nicht** gemerged — sie lässt sich erst
> end-to-end verifizieren, wenn der Squid steht. Sag Bescheid, dann liefere ich
> sie als kleinen env-gated PR (mit Test, dass ohne ENV das Verhalten identisch
> bleibt).

## Layer 3 — Hetzner Cloud Firewall (grober IP-Backstop)

Domain-Enforcement macht Squid; die Cloud-Firewall blockt offensichtlich Falsches
und reduziert die Angriffsfläche:

- **Outbound erlauben:** TCP 443 (HTTPS, vom Proxy benötigt), TCP 53/UDP 53 (DNS
  zum gesetzten Resolver), TCP zum **managed-DB-Host:Port** (Postgres).
- **Outbound blocken:** alles andere — explizit TCP 25/465/587 (SMTP),
  TCP 22 (SSH egress), sowie die Cloud-Metadata-IP `169.254.169.254`.
- **Inbound:** nur was der Betrieb braucht (kein öffentlicher Port für den Worker;
  Admin nur über VPN/Bastion).

> Reine IP-Filter können CDN-Ziele nicht sauber begrenzen — deshalb ist Layer 1
> (Squid) die eigentliche Domain-Grenze, Layer 3 nur Backstop.

## Verifikation (AC INFETCH-269)

```bash
# Erlaubt: ein Portal-Ziel über den Proxy
curl -x http://127.0.0.1:3128 -sS -o /dev/null -w "%{http_code}\n" https://www.enbw.com/   # 200/3xx

# Geblockt: eine Nicht-Allowlist-Domain → Proxy verweigert
curl -x http://127.0.0.1:3128 -sS -o /dev/null -w "%{http_code}\n" https://example.com/    # 403

# Geblockt: direkter Egress an der Firewall vorbei (ohne Proxy) → Timeout/refused
curl -sS --max-time 5 https://example.com/ ; echo "exit=$?"
```

Ergebnis dokumentieren (Issue-Kommentar) — sonst gilt AC nicht als erfüllt.

## Pflege

- **Neuer Vendor** → SQL erneut laufen lassen, `allowed-domains.txt` aktualisieren,
  `squid -k reconfigure`. Kandidat für eine kleine Cron/Deploy-Automation (Folge).
- Mistral-Endpoint ändert sich → `.mistral.ai`-Eintrag prüfen.
