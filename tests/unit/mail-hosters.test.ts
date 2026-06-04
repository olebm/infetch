import { describe, expect, it } from "vitest";
import { detectHoster, MAIL_HOSTERS } from "@/lib/mail-hosters";

// Verifiziert die MX-basierte Hoster-Erkennung + Server-Ableitung (pure Logik).

describe("detectHoster — feste Server", () => {
  it("IONOS via .de und .com", () => {
    for (const mx of ["mx00.ionos.de", "mx01.ionos.com"]) {
      const d = detectHoster([mx], "firma.de");
      expect(d?.hosterId).toBe("ionos-hosting");
      expect(d?.imapHost).toBe("imap.ionos.de");
      expect(d?.smtpHost).toBe("smtp.ionos.de");
      expect(d?.imapPort).toBe(993);
      expect(d?.smtpSecure).toBe(false); // 587/STARTTLS
    }
  });

  it("Strato wird am rzone.de-MX erkannt (nicht strato.de)", () => {
    const d = detectHoster(["mailin.rzone.de"], "firma.de");
    expect(d?.hosterId).toBe("strato-hosting");
    expect(d?.imapHost).toBe("imap.strato.de");
  });

  it("Hetzner: fester Client-Host, NICHT das MX-Ziel", () => {
    const d = detectHoster(["sw123.your-server.de"], "firma.de");
    expect(d?.hosterId).toBe("hetzner");
    expect(d?.imapHost).toBe("mail.your-server.de");
    expect(d?.smtpHost).toBe("mail.your-server.de");
  });

  it("DomainFactory am ispgateway.de-MX", () => {
    const d = detectHoster(["mxlb.ispgateway.de"], "firma.de");
    expect(d?.hosterId).toBe("domainfactory");
    expect(d?.imapHost).toBe("sslin.df.eu");
    expect(d?.smtpHost).toBe("sslout.df.eu");
  });

  it("Google Workspace trägt App-Passwort-Hinweis", () => {
    const d = detectHoster(["alt1.aspmx.l.google.com"], "firma.de");
    expect(d?.hosterId).toBe("google-workspace");
    expect(d?.imapHost).toBe("imap.gmail.com");
    expect(d?.hint).toContain("App-Passwort");
    expect(d?.appPasswordUrl).toBeTruthy();
  });
});

describe("detectHoster — Server = MX-Ziel", () => {
  it("webgo: Server kommt aus dem MX-Hostnamen", () => {
    const d = detectHoster(["s66.goserver.host"], "firma.de");
    expect(d?.hosterId).toBe("webgo");
    expect(d?.imapHost).toBe("s66.goserver.host");
    expect(d?.smtpHost).toBe("s66.goserver.host");
    expect(d?.smtpPort).toBe(587);
  });

  it("webgo auch via webgo24.de", () => {
    const d = detectHoster(["server42.webgo24.de"], "firma.de");
    expect(d?.hosterId).toBe("webgo");
    expect(d?.imapHost).toBe("server42.webgo24.de");
  });

  it("All-Inkl: Server = kasserver-MX-Ziel", () => {
    const d = detectHoster(["w0123456.kasserver.com"], "firma.de");
    expect(d?.hosterId).toBe("all-inkl");
    expect(d?.imapHost).toBe("w0123456.kasserver.com");
  });
});

describe("detectHoster — Server aus Domain / vom User", () => {
  it("netcup: Server = mail.<domain>", () => {
    const d = detectHoster(["mxf963.netcup.net"], "meine-firma.de");
    expect(d?.hosterId).toBe("netcup");
    expect(d?.imapHost).toBe("mail.meine-firma.de");
    expect(d?.smtpHost).toBe("mail.meine-firma.de");
  });

  it("Host Europe: kundenspezifisch → Host leer, Ports gesetzt", () => {
    const d = detectHoster(["mx0.hosteurope.de"], "firma.de");
    expect(d?.hosterId).toBe("hosteurope");
    expect(d?.imapHost).toBe("");
    expect(d?.smtpHost).toBe("");
    expect(d?.imapPort).toBe(993);
    expect(d?.hint).toBeTruthy();
  });

  it("Alfahosting wird auch am secure-mailgate-Spamfilter erkannt", () => {
    const d = detectHoster(["mx03.secure-mailgate.com"], "firma.de");
    expect(d?.hosterId).toBe("alfahosting");
    expect(d?.imapHost).toBe("");
  });
});

describe("detectHoster — Sonderfälle", () => {
  it("Microsoft 365: erkannt, aber als nicht verbindbar markiert", () => {
    const d = detectHoster(["firma-de.mail.protection.outlook.com"], "firma.de");
    expect(d?.hosterId).toBe("microsoft365");
    expect(d?.unsupportedReason).toContain("Microsoft");
  });

  it("normalisiert Groß-/Kleinschreibung und trailing dot", () => {
    const d = detectHoster(["S66.GoServer.Host."], "firma.de");
    expect(d?.hosterId).toBe("webgo");
    expect(d?.imapHost).toBe("s66.goserver.host");
  });

  it("nimmt das erste passende MX (Prioritäts-Reihenfolge)", () => {
    const d = detectHoster(["s10.goserver.host", "s11.goserver.host"], "firma.de");
    expect(d?.imapHost).toBe("s10.goserver.host");
  });

  it("unbekannter Hoster → null", () => {
    expect(detectHoster(["mx.irgendein-unbekannter-host.example"], "firma.de")).toBeNull();
  });

  it("leere MX-Liste → null", () => {
    expect(detectHoster([], "firma.de")).toBeNull();
  });
});

describe("SMTP-Port-Regression (Incident: Hetzner sperrt ausgehend 465)", () => {
  // webgo schlug fehl, weil der App-Server (Hetzner) ausgehend Port 465 sperrt,
  // 587 aber offen ist. Alle Hoster müssen daher SMTP über 587/STARTTLS fahren,
  // nicht über das oft gesperrte 465. Dieser Test macht ein Zurückfallen rot.
  it("nutzt für SMTP überall 587/STARTTLS, nie 465", () => {
    for (const h of MAIL_HOSTERS) {
      expect(h.smtp.port, `${h.name} SMTP-Port`).toBe(587);
      expect(h.smtp.secure, `${h.name} SMTP secure`).toBe(false);
    }
  });

  it("IMAP bleibt 993 (impliziertes SSL/TLS, ausgehend offen)", () => {
    for (const h of MAIL_HOSTERS) {
      expect(h.imap.port, `${h.name} IMAP-Port`).toBe(993);
      expect(h.imap.secure, `${h.name} IMAP secure`).toBe(true);
    }
  });
});
