import type * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/legal/privacy-policy")({
  component: PrivacyPolicyPage,
});

function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-slate-900">
      <article className="mx-auto max-w-3xl space-y-8">
        <header className="border-b border-slate-200 pb-6">
          <p className="text-sm font-medium text-slate-500">
            Pumpkii Media Hub
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            {title}
          </h1>
          <p className="mt-3 text-sm text-slate-500">Last updated: {updated}</p>
        </header>
        <div className="space-y-7 text-sm leading-7 text-slate-700">
          {children}
        </div>
      </article>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function PrivacyPolicyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="2026-05-05">
      <p>
        Pumpkii Media Hub is a private internal tool used by authorized Pumpkii
        staff to publish marketing content to Pumpkii-owned YouTube, Instagram,
        and TikTok accounts, and to review aggregate performance data for those
        posts.
      </p>

      <Section title="Data We Collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Staff account data such as email address, display name, role, and
            login audit records.
          </li>
          <li>
            OAuth tokens and connected account identifiers for Pumpkii-owned
            platform accounts.
          </li>
          <li>
            Video files, thumbnails, titles, descriptions, hashtags, publishing
            status, and platform post IDs.
          </li>
          <li>
            Aggregate platform analytics such as views, likes, comments, and
            follower snapshots.
          </li>
        </ul>
      </Section>

      <Section title="How We Use Data">
        <p>
          We use this data only to operate the service, publish content to
          Pumpkii-owned accounts, maintain security, audit administrative
          actions, and improve internal content workflows. We do not sell data,
          share it with ad networks, or use OAuth tokens for accounts that are
          not owned or operated by Pumpkii.
        </p>
      </Section>

      <Section title="Third-Party Platforms">
        <p>
          The service integrates with official APIs from Google YouTube, Meta
          Instagram, and TikTok. Video files, metadata, OAuth tokens, and
          aggregate analytics may be sent to or received from those platforms
          only as needed to publish and measure Pumpkii-owned content.
        </p>
      </Section>

      <Section title="Retention and Deletion">
        <p>
          Raw uploaded video files are retained for up to 30 days after
          successful publication unless operational needs require shorter
          retention. OAuth tokens are kept until authorization is revoked or the
          connected account is removed. Staff may request access, correction, or
          deletion by contacting us.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Data is transmitted over HTTPS. OAuth tokens, passwords, and platform
          credentials are encrypted at rest. Access is restricted to authorized
          Pumpkii staff using role-based controls.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For privacy questions or data requests, contact Pumpkii at{" "}
          <a className="text-blue-600 underline" href="mailto:dev@pumpkii.com">
            dev@pumpkii.com
          </a>
          .
        </p>
      </Section>
    </LegalShell>
  );
}
