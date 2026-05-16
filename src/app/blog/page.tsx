import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/layout/public-shell";
import { POSTS } from "./posts";

export const metadata: Metadata = {
  title: "Blog — Infetch",
  description:
    "Praxis-Tipps rund um automatisierte Rechnungsverarbeitung, Belegtransfer und DSGVO-konforme Buchhaltung für Selbstständige und kleine Teams.",
  alternates: { canonical: "https://infetch.de/blog" },
};

export default function BlogIndexPage() {
  return (
    <PublicShell title="Blog">
      <div className="legal-prose mt-10 text-muted">
        {POSTS.length === 0 && <p>Bald geht es hier los.</p>}
        <ul style={{ listStyle: "none", padding: 0 }}>
          {POSTS.map((post) => (
            <li key={post.slug} style={{ marginBottom: "2rem" }}>
              <Link
                href={`/blog/${post.slug}`}
                className="text-ink"
                style={{ fontWeight: 600, fontSize: "1.15rem" }}
              >
                {post.title}
              </Link>
              <p style={{ marginTop: "0.5rem" }}>{post.description}</p>
              <time dateTime={post.date} style={{ fontSize: "0.8rem" }}>
                {new Date(post.date).toLocaleDateString("de-DE", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
            </li>
          ))}
        </ul>
      </div>
    </PublicShell>
  );
}
