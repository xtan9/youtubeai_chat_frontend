import { Captions, Globe, MessageCircle } from "lucide-react";

// Animation keyframes live in app/globals.css (`.animate-float*`) so this
// component renders server-side and ships zero JS.
export function HeroSection() {
  return (
    <section className="w-full max-w-6xl mx-auto py-16 text-center">
      <div className="relative">
        {/* Animated gradient background */}
        <div className="absolute -top-24 left-1/2 transform -translate-x-1/2 w-[600px] h-[600px] bg-gradient-brand-soft rounded-full blur-3xl opacity-50 animate-pulse"></div>

        {/* Small decorative elements */}
        <div className="absolute top-10 left-10 w-8 h-8 bg-accent-brand/20 dark:bg-accent-brand/30 rounded-full blur-lg animate-float"></div>
        <div className="absolute top-20 right-20 w-6 h-6 bg-accent-brand-secondary/20 dark:bg-accent-brand-secondary/30 rounded-full blur-lg animate-float-delay"></div>
        <div className="absolute bottom-10 left-20 w-10 h-10 bg-accent-brand/20 dark:bg-accent-brand/30 rounded-full blur-lg animate-float-slow"></div>

        {/* Main content */}
        <div className="relative z-10">
          <h1 className="text-4xl md:text-6xl font-bold bg-gradient-brand-accent bg-clip-text text-transparent mb-6">
            Summarize YouTube Videos with AI
          </h1>

          <p className="text-xl text-text-muted mb-8 max-w-3xl mx-auto">
            Paste any YouTube link and get a structured summary in seconds —
            then chat with the video to jump to the moments that matter. Works
            even on videos without captions, where most summarizers give up.
          </p>

          <div className="flex flex-wrap justify-center gap-4 mb-8">
            <div className="flex items-center gap-2 bg-surface-base/50 dark:bg-white/5 backdrop-blur-sm rounded-full px-4 py-2 border border-border-subtle dark:border-white/10">
              <MessageCircle className="w-5 h-5 text-accent-brand" />
              <span className="text-sm text-text-primary">
                Chat with the video
              </span>
            </div>
            <div className="flex items-center gap-2 bg-surface-base/50 dark:bg-white/5 backdrop-blur-sm rounded-full px-4 py-2 border border-border-subtle dark:border-white/10">
              <Captions className="w-5 h-5 text-accent-brand-secondary" />
              <span className="text-sm text-text-primary">
                Works without captions
              </span>
            </div>
            <div className="flex items-center gap-2 bg-surface-base/50 dark:bg-white/5 backdrop-blur-sm rounded-full px-4 py-2 border border-border-subtle dark:border-white/10">
              <Globe className="w-5 h-5 text-accent-brand" />
              <span className="text-sm text-text-primary">
                17 summary languages
              </span>
            </div>
          </div>

          {/* Anchor nav — gives crawlers explicit section links (eligible
              for Google "skip-to-content" SERP sublinks) and lets users
              jump straight to the section they care about. */}
          <nav
            aria-label="Page sections"
            className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-text-muted mb-12"
          >
            <a href="#benefits" className="hover:text-text-primary transition-colors">Benefits</a>
            <a href="#use-cases" className="hover:text-text-primary transition-colors">Use Cases</a>
            <a href="#how-it-works" className="hover:text-text-primary transition-colors">How It Works</a>
            <a href="#faq" className="hover:text-text-primary transition-colors">FAQ</a>
          </nav>
        </div>
      </div>
    </section>
  );
}
