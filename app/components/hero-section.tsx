"use client";

import { Brain, Sparkles, Clock } from "lucide-react";

export function HeroSection() {
  return (
    <section className="w-full max-w-6xl mx-auto py-16 text-center">
      <div className="relative">
        {/* Animated gradient background */}
        <div className="absolute -top-24 left-1/2 transform -translate-x-1/2 w-[600px] h-[600px] bg-gradient-to-br from-purple-500/20 via-cyan-500/15 to-pink-500/20 dark:from-purple-500/30 dark:via-cyan-500/20 dark:to-pink-500/30 rounded-full blur-3xl opacity-50 animate-pulse"></div>

        {/* Small decorative elements */}
        <div className="absolute top-10 left-10 w-8 h-8 bg-purple-500/20 dark:bg-purple-500/30 rounded-full blur-lg animate-float"></div>
        <div className="absolute top-20 right-20 w-6 h-6 bg-cyan-500/20 dark:bg-cyan-500/30 rounded-full blur-lg animate-float-delay"></div>
        <div className="absolute bottom-10 left-20 w-10 h-10 bg-pink-500/20 dark:bg-pink-500/30 rounded-full blur-lg animate-float-slow"></div>

        {/* Main content */}
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 bg-background/80 dark:bg-white/10 backdrop-blur-sm rounded-full px-4 py-2 border border-border dark:border-white/20 mb-6">
            <Sparkles
              size={16}
              className="text-purple-500 dark:text-purple-400"
            />
            <span className="text-sm font-medium text-foreground">
              100% Free Forever • No Paywall
            </span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 dark:from-purple-400 dark:via-pink-400 dark:to-cyan-400 bg-clip-text text-transparent mb-6">
            Understand YouTube Videos
            <br />
            <span className="text-3xl md:text-5xl">
              In a Fraction of the Time
            </span>
          </h1>

          <p className="text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Our AI instantly transforms lengthy videos into comprehensive
            summaries, key points, and actionable insights—completely free, with
            no restrictions or hidden costs.
          </p>

          <div className="flex flex-wrap justify-center gap-4 mb-12">
            <div className="flex items-center gap-2 bg-background/50 dark:bg-white/5 backdrop-blur-sm rounded-full px-4 py-2 border border-border dark:border-white/10">
              <Brain className="w-5 h-5 text-purple-500 dark:text-purple-400" />
              <span className="text-sm text-foreground">
                Advanced AI Analysis
              </span>
            </div>
            <div className="flex items-center gap-2 bg-background/50 dark:bg-white/5 backdrop-blur-sm rounded-full px-4 py-2 border border-border dark:border-white/10">
              <Clock className="w-5 h-5 text-cyan-500 dark:text-cyan-400" />
              <span className="text-sm text-foreground">
                Save Hours of Watching
              </span>
            </div>
            <div className="flex items-center gap-2 bg-background/50 dark:bg-white/5 backdrop-blur-sm rounded-full px-4 py-2 border border-border dark:border-white/10">
              <Sparkles className="w-5 h-5 text-pink-500 dark:text-pink-400" />
              <span className="text-sm text-foreground">
                No Paywall or Limits
              </span>
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes float {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-10px);
          }
        }
        @keyframes float-delay {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-15px);
          }
        }
        @keyframes float-slow {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-8px);
          }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
        .animate-float-delay {
          animation: float-delay 8s ease-in-out infinite;
        }
        .animate-float-slow {
          animation: float-slow 10s ease-in-out infinite;
        }
      `}</style>
    </section>
  );
}
