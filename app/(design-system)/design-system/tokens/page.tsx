// app/(design-system)/design-system/tokens/page.tsx
import * as React from "react";
import { ShowcaseLayout } from "../../_components/ShowcaseLayout";
import { TokenSwatch } from "../../_components/TokenSwatch";
import { TypeSpecimen } from "../../_components/TypeSpecimen";

export default function TokensPage() {
  return (
    <ShowcaseLayout title="Tokens">
      <section>
        <h2 className="text-h2 mb-4">Surfaces</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <TokenSwatch name="--color-surface-base" utilityClass="bg-surface-base" description="Page background" />
          <TokenSwatch name="--color-surface-raised" utilityClass="bg-surface-raised" description="Cards, panels" />
          <TokenSwatch name="--color-surface-overlay" utilityClass="bg-surface-overlay" description="Popovers, tooltips" />
          <TokenSwatch name="--color-surface-sunken" utilityClass="bg-surface-sunken" description="Inset wells" />
          <TokenSwatch name="--color-surface-inverse" utilityClass="bg-surface-inverse" description="High-contrast emphasis" />
        </div>
      </section>

      <section>
        <h2 className="text-h2 mb-4">Text</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <TokenSwatch name="--color-text-primary" utilityClass="bg-text-primary" description="Default body" />
          <TokenSwatch name="--color-text-secondary" utilityClass="bg-text-secondary" description="Subheadings" />
          <TokenSwatch name="--color-text-muted" utilityClass="bg-text-muted" description="Captions" />
          <TokenSwatch name="--color-text-disabled" utilityClass="bg-text-disabled" description="Disabled controls" />
          <TokenSwatch name="--color-text-inverse" utilityClass="bg-text-inverse" description="Text on inverse surface" />
        </div>
      </section>

      <section>
        <h2 className="text-h2 mb-4">Borders</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <TokenSwatch name="--color-border-subtle" utilityClass="bg-border-subtle" description="Default dividers" />
          <TokenSwatch name="--color-border-default" utilityClass="bg-border-default" description="Form inputs (rest)" />
          <TokenSwatch name="--color-border-strong" utilityClass="bg-border-strong" description="Emphasized outlines" />
        </div>
      </section>

      <section>
        <h2 className="text-h2 mb-4">Accents</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <TokenSwatch name="--color-accent-brand" utilityClass="bg-accent-brand" description="Primary CTA" />
          <TokenSwatch name="--color-accent-brand-secondary" utilityClass="bg-accent-brand-secondary" description="Brand pair" />
          <TokenSwatch name="--color-accent-success" utilityClass="bg-accent-success" description="Success" />
          <TokenSwatch name="--color-accent-warning" utilityClass="bg-accent-warning" description="Warning" />
          <TokenSwatch name="--color-accent-danger" utilityClass="bg-accent-danger" description="Destructive" />
        </div>
      </section>

      <section>
        <h2 className="text-h2 mb-4">Interaction states</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <TokenSwatch name="--color-state-hover" utilityClass="bg-state-hover" description="Hover overlay" />
          <TokenSwatch name="--color-state-pressed" utilityClass="bg-state-pressed" description="Pressed overlay" />
          <TokenSwatch name="--color-state-focus" utilityClass="bg-state-focus" description="Focus ring" />
          <TokenSwatch name="--color-state-disabled" utilityClass="bg-state-disabled" description="Disabled overlay" />
        </div>
      </section>

      <section>
        <h2 className="text-h2 mb-4">Typography</h2>
        <div className="flex flex-col gap-2">
          <TypeSpecimen token="--text-display" utilityClass="text-display" />
          <TypeSpecimen token="--text-h1" utilityClass="text-h1" />
          <TypeSpecimen token="--text-h2" utilityClass="text-h2" />
          <TypeSpecimen token="--text-h3" utilityClass="text-h3" />
          <TypeSpecimen token="--text-h4" utilityClass="text-h4" />
          <TypeSpecimen token="--text-h5" utilityClass="text-h5" />
          <TypeSpecimen token="--text-h6" utilityClass="text-h6" />
          <TypeSpecimen token="--text-body-lg" utilityClass="text-body-lg" />
          <TypeSpecimen token="--text-body-md" utilityClass="text-body-md" />
          <TypeSpecimen token="--text-body-sm" utilityClass="text-body-sm" />
          <TypeSpecimen token="--text-body-xs" utilityClass="text-body-xs" />
          <TypeSpecimen token="--text-caption" utilityClass="text-caption" />
        </div>
      </section>

      <section>
        <h2 className="text-h2 mb-4">Brand gradients</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <TokenSwatch name="--gradient-brand-primary" utilityClass="bg-gradient-brand-primary" />
          <TokenSwatch name="--gradient-brand-primary-hover" utilityClass="bg-gradient-brand-primary-hover" />
          <TokenSwatch name="--gradient-brand-accent" utilityClass="bg-gradient-brand-accent" />
          <TokenSwatch name="--gradient-brand-soft" utilityClass="bg-gradient-brand-soft" />
          <TokenSwatch name="--gradient-error" utilityClass="bg-gradient-error" />
          <TokenSwatch name="--gradient-success" utilityClass="bg-gradient-success" />
          <TokenSwatch name="--gradient-stage-preparing" utilityClass="bg-gradient-stage-preparing" />
          <TokenSwatch name="--gradient-stage-transcribing" utilityClass="bg-gradient-stage-transcribing" />
          <TokenSwatch name="--gradient-stage-summarizing" utilityClass="bg-gradient-stage-summarizing" />
          <TokenSwatch name="--gradient-stage-complete" utilityClass="bg-gradient-stage-complete" />
        </div>
      </section>
    </ShowcaseLayout>
  );
}
