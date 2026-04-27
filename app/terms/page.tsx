import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service - YouTubeAI.chat",
  description:
    "Terms and conditions for using YouTubeAI.chat video summarization service",
  alternates: {
    canonical: "/terms",
  },
};

export default function TermsOfService() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Terms of Service</h1>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">1. Acceptance of Terms</h2>
        <p className="mb-4">
          By accessing and using YouTubeAI.chat, you accept and agree to be
          bound by the terms and provisions of this agreement.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">
          2. Description of Service
        </h2>
        <p className="mb-4">
          YouTubeAI.chat provides an AI-powered video summarization service that
          creates summaries and key points from YouTube videos. The service is
          provided &ldquo;as is&rdquo; and may be modified or updated at any
          time.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">
          3. User Responsibilities
        </h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            You must provide accurate information when creating an account
          </li>
          <li>
            You are responsible for maintaining the confidentiality of your
            account
          </li>
          <li>
            You agree not to use the service for any illegal or unauthorized
            purpose
          </li>
          <li>You must comply with all applicable laws and regulations</li>
          <li>
            You must respect YouTube&apos;s terms of service when using our
            service
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">
          4. Intellectual Property
        </h2>
        <p className="mb-4">
          The service, including its original content, features, and
          functionality, is owned by YouTubeAI.chat and is protected by
          international copyright, trademark, and other intellectual property
          rights laws.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">5. Limitations of Use</h2>
        <p className="mb-4">You agree not to:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Use the service for any unlawful purpose</li>
          <li>
            Attempt to gain unauthorized access to any part of the service
          </li>
          <li>Interfere with or disrupt the service or servers</li>
          <li>Collect or track personal information of other users</li>
          <li>Spam or send unwanted messages</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">
          6. Disclaimer of Warranties
        </h2>
        <p className="mb-4">
          The service is provided &ldquo;as is&rdquo; without any warranty of
          any kind. We do not guarantee the accuracy, completeness, or
          usefulness of any summaries generated.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">
          7. Limitation of Liability
        </h2>
        <p className="mb-4">
          YouTubeAI.chat shall not be liable for any indirect, incidental,
          special, consequential, or punitive damages resulting from your use or
          inability to use the service.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">8. Changes to Terms</h2>
        <p className="mb-4">
          We reserve the right to modify these terms at any time. We will notify
          users of any material changes by posting the new terms on this site.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">9. Governing Law</h2>
        <p className="mb-4">
          These terms shall be governed by and construed in accordance with the
          laws of the jurisdiction in which YouTubeAI.chat operates, without
          regard to its conflict of law provisions.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">10. Contact Information</h2>
        <p className="mb-4">
          For any questions about these Terms of Service, please contact us at
          terms@youtubeai.chat.
        </p>
      </section>

      <footer className="text-sm text-muted-foreground">
        Last updated: {new Date().toLocaleDateString()}
      </footer>
    </div>
  );
}
