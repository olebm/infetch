import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { getLoginHintDomain, LOGIN_HINT_COOKIE, syncLoginHintCookie } from "@/lib/auth/login-hint";

// Der Login-Hinweis erlaubt der Marketing-Domain infetch.de, den App-Login auf
// app.infetch.de zu erkennen, ohne die echte (host-only) Session zu teilen.
// Siehe src/lib/auth/login-hint.ts.

describe("getLoginHintDomain", () => {
  it("teilt den Hinweis über alle infetch.de-Domains (.infetch.de)", () => {
    expect(getLoginHintDomain("infetch.de")).toBe(".infetch.de");
    expect(getLoginHintDomain("app.infetch.de")).toBe(".infetch.de");
    expect(getLoginHintDomain("www.infetch.de")).toBe(".infetch.de");
  });

  it("bleibt lokal/Preview host-only (undefined)", () => {
    expect(getLoginHintDomain("localhost")).toBeUndefined();
    expect(getLoginHintDomain("127.0.0.1")).toBeUndefined();
    expect(getLoginHintDomain("infetch-staging.vercel.app")).toBeUndefined();
  });

  it("greift NICHT bei Fremd-Domains, die nur ähnlich aussehen", () => {
    // Der führende Punkt in der Prüfung schützt vor Suffix-Domain-Tricks.
    expect(getLoginHintDomain("notinfetch.de")).toBeUndefined();
    expect(getLoginHintDomain("fakeinfetch.de")).toBeUndefined();
    expect(getLoginHintDomain("infetch.de.evil.com")).toBeUndefined();
  });
});

describe("syncLoginHintCookie", () => {
  it("setzt für eingeloggte User ein domainübergreifendes, sicheres Flag", () => {
    const res = new NextResponse(null);
    syncLoginHintCookie(res, "app.infetch.de", "user-123");

    const c = res.cookies.get(LOGIN_HINT_COOKIE);
    expect(c?.value).toBe("1"); // nur ein Flag, KEIN Token / keine Session
    expect(c?.domain).toBe(".infetch.de");
    expect(c?.secure).toBe(true);
    expect(c?.httpOnly).toBe(true);
    expect(String(c?.sameSite).toLowerCase()).toBe("lax");
    expect(c?.maxAge ?? 0).toBeGreaterThan(0);
  });

  it("löscht das Flag bei fehlendem Login (maxAge 0)", () => {
    const res = new NextResponse(null);
    syncLoginHintCookie(res, "app.infetch.de", null);

    const c = res.cookies.get(LOGIN_HINT_COOKIE);
    expect(c?.value).toBe("");
    expect(c?.maxAge).toBe(0);
  });

  it("bleibt lokal host-only und ohne secure-Flag (http)", () => {
    const res = new NextResponse(null);
    syncLoginHintCookie(res, "localhost", "user-123");

    const c = res.cookies.get(LOGIN_HINT_COOKIE);
    expect(c?.domain).toBeUndefined();
    expect(c?.secure).toBe(false);
  });
});
