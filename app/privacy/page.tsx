import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy - YouTubeAI.chat",
  description: "Privacy policy and data handling practices for YouTubeAI.chat",
  alternates: {
    canonical: "/privacy",
  },
};

export default function PrivacyPolicy() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Introduction</h2>
        <p className="mb-4">
          At YouTubeAI.chat, we take your privacy seriously. This Privacy Policy
          explains how we collect, use, and protect your personal information
          when you use our service.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Information We Collect</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>Account information (email address when you sign up)</li>
          <li>Usage data (how you interact with our service)</li>
          <li>YouTube video URLs you submit for summarization</li>
          <li>Generated summaries and analysis</li>
          <li>
            Technical information (IP address, browser type, device information)
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">
          How We Use Your Information
        </h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>To provide and improve our video summarization service</li>
          <li>To personalize your experience</li>
          <li>To communicate with you about your account or our service</li>
          <li>To analyze usage patterns and improve our website</li>
          <li>To protect our legal rights and comply with applicable laws</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">
          Data Storage and Security
        </h2>
        <p className="mb-4">
          We implement appropriate technical and organizational measures to
          protect your personal information. However, no method of transmission
          over the Internet or electronic storage is 100% secure.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Third-Party Services</h2>
        <p className="mb-4">We use third-party services for:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Authentication (Supabase)</li>
          <li>Analytics (Google Analytics)</li>
          <li>Video data (YouTube API Services)</li>
        </ul>
        <p className="mt-4">
          Each of these services has their own privacy policies and handling
          practices.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Your Rights</h2>
        <p className="mb-4">You have the right to:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Access your personal information</li>
          <li>Correct inaccurate information</li>
          <li>Request deletion of your information</li>
          <li>Object to processing of your information</li>
          <li>Withdraw consent</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Contact Us</h2>
        <p className="mb-4">
          If you have any questions about this Privacy Policy, please contact us
          at privacy@youtubeai.chat.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Changes to This Policy</h2>
        <p className="mb-4">
          We may update this Privacy Policy from time to time. We will notify
          you of any changes by posting the new Privacy Policy on this page and
          updating the &ldquo;last updated&rdquo; date.
        </p>
      </section>

      <footer className="text-sm text-muted-foreground">
        Last updated: {new Date().toLocaleDateString()}
      </footer>
    </div>
  );
}
