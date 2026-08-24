import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/legal/terms-of-service")({
  component: TermsOfServicePage,
});

function TermsOfServicePage() {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-slate-900">
      <article className="mx-auto max-w-3xl space-y-8">
        <header className="border-b border-slate-200 pb-6">
          <p className="text-sm font-medium text-slate-500">
            Pumpkii Media Hub
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            Last updated: 2026-05-05
          </p>
        </header>

        <div className="space-y-7 text-sm leading-7 text-slate-700">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">
              Nature of the Service
            </h2>
            <p>
              Pumpkii Media Hub is a private internal-use content management
              tool operated by Pumpkii. It is used only by authorized Pumpkii
              staff and contractors to publish marketing content to
              Pumpkii-owned brand accounts and review aggregate analytics.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">
              Acceptable Use
            </h2>
            <p>
              Users may use the service only for Pumpkii business purposes.
              Users must not publish content to accounts not owned or operated
              by Pumpkii, violate third-party platform terms, circumvent rate
              limits, or use the service for spam, harassment, misinformation,
              or unlawful activity.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">
              Third-Party Platform Terms
            </h2>
            <p>
              The service operates on top of YouTube, Instagram, and TikTok
              APIs. Users are responsible for complying with each platform's
              terms and community guidelines. Pumpkii is not affiliated with,
              endorsed by, or sponsored by Google, Meta, or TikTok.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">
              Connected Account Authorization
            </h2>
            <p>
              When a user connects a Pumpkii brand account, the user authorizes
              the service to act on behalf of that account within the scopes
              granted. Authorization can be revoked at any time through the
              relevant third-party platform settings.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">
              Service Availability
            </h2>
            <p>
              The service is provided as-is and as-available. Platform API
              outages, rate limits, policy changes, or infrastructure issues may
              affect availability.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">Contact</h2>
            <p>
              For questions about these terms, contact Pumpkii at{" "}
              <a
                className="text-blue-600 underline"
                href="mailto:dev@pumpkii.com"
              >
                dev@pumpkii.com
              </a>
              .
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
