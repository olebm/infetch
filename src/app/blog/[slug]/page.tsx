import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicShell } from "@/components/layout/public-shell";
import { POSTS, getPost } from "../posts";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "Nicht gefunden — Infetch" };
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `https://infetch.de/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      url: `https://infetch.de/blog/${post.slug}`,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    inLanguage: "de-DE",
    author: { "@type": "Organization", name: "Infetch" },
    publisher: {
      "@type": "Organization",
      name: "Infetch",
      logo: {
        "@type": "ImageObject",
        url: "https://infetch.de/images/brand/infetch-logo.png",
      },
    },
    mainEntityOfPage: `https://infetch.de/blog/${post.slug}`,
  };

  return (
    <PublicShell title={post.title}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <div className="legal-prose mt-10 text-muted">
        <p>
          <time dateTime={post.date} style={{ fontSize: "0.8rem" }}>
            {new Date(post.date).toLocaleDateString("de-DE", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
        </p>
        {post.body.map((block, i) =>
          block.startsWith("## ") ? (
            <h2 key={i}>{block.slice(3)}</h2>
          ) : (
            <p key={i}>{block}</p>
          ),
        )}
      </div>
    </PublicShell>
  );
}
