import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/legal/data-deletion")({
  component: DataDeletionPage,
});

function DataDeletionPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-slate-900">
      <article className="mx-auto max-w-3xl space-y-8">
        <header className="border-b border-slate-200 pb-6">
          <p className="text-sm font-medium text-slate-500">
            Pumpkii Media Hub
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            Data Deletion Instructions
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            Last updated: 2026-05-05
          </p>
        </header>

        <div className="space-y-7 text-sm leading-7 text-slate-700">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">
              How to Request Deletion
            </h2>
            <p>
              Pumpkii Media Hub is an internal tool for Pumpkii staff. To
              request deletion of account data, OAuth tokens, or uploaded media
              associated with your staff account, email{" "}
              <a
                className="text-blue-600 underline"
                href="mailto:dev@pumpkii.com"
              >
                dev@pumpkii.com
              </a>{" "}
              with the subject "Media Hub Data Deletion Request".
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">
              What We Delete
            </h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>Stored OAuth tokens for connected platform accounts.</li>
              <li>
                Staff profile data associated with your Media Hub account.
              </li>
              <li>
                Raw uploaded media files that are no longer needed for
                publishing.
              </li>
              <li>
                Non-required audit records where deletion is permitted by law
                and security policy.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">
              Response Time
            </h2>
            <p>
              We will acknowledge deletion requests within 14 days. Some
              operational logs or records may be retained where required for
              security, legal compliance, or platform audit obligations.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">
              Revoke Platform Access
            </h2>
            <p>
              You can also revoke the service's access directly in the relevant
              platform account settings, including Facebook or Instagram Apps
              and Websites settings.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
