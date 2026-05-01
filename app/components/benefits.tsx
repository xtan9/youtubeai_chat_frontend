import { Brain, BookmarkCheck, Captions, Clock, MessageCircle, Zap } from "lucide-react";
import {
  Card,
  CardContent,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

// Theme-conditional class strings replaced with Tailwind `dark:` prefixes
// so this section renders fully on the server and ships zero JS for the
// theme swap.
const cardBase =
  "bg-white dark:bg-white/5 backdrop-blur-sm border-gray-100 dark:border-white/10 shadow-sm";
const description = "text-gray-700 dark:text-gray-300 font-medium";

export function Benefits() {
  return (
    <section id="benefits" className="w-full max-w-6xl mx-auto py-20 scroll-mt-24">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold">Why Choose Our AI Video Analysis</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card
          className={`${cardBase} hover:border-accent-brand/30 transition-colors`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-accent-brand/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Clock className="w-6 h-6 text-accent-brand" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Rapid Knowledge Extraction
                </CardTitle>
                <CardDescription className={description}>
                  Extract core insights from lengthy videos in minutes, not
                  hours. Our AI distills hours of content into concise,
                  actionable summaries.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`${cardBase} hover:border-accent-brand-secondary/30 transition-colors`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-accent-brand-secondary/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <MessageCircle className="w-6 h-6 text-accent-brand-secondary" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Chat With the Transcript
                </CardTitle>
                <CardDescription className={description}>
                  After the summary, ask follow-up questions and let the AI
                  pull the answer straight from the transcript. Drill into a
                  specific moment without scrubbing the timeline.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`${cardBase} hover:border-accent-brand/30 transition-colors`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-accent-brand/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Brain className="w-6 h-6 text-accent-brand" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Deep Insight Extraction
                </CardTitle>
                <CardDescription className={description}>
                  Our advanced AI doesn&apos;t just transcribe—it analyzes
                  context, identifies key arguments, and structures information
                  for maximum comprehension.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`${cardBase} hover:border-accent-warning/30 transition-colors`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-accent-warning/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Captions className="w-6 h-6 text-accent-warning" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Works Without Captions
                </CardTitle>
                <CardDescription className={description}>
                  Most YouTube summarizers fail when a video has no
                  transcript. We don&apos;t. When captions aren&apos;t
                  available, we transcribe the audio with Whisper and
                  summarize anyway — so caption-less talks, livestreams,
                  and indie creators just work.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-10">
        <Card className={`${cardBase} text-center`}>
          <CardContent className="pt-6">
            <div className="flex justify-center mb-6">
              <Avatar className="h-24 w-24">
                <AvatarFallback>
                  <Zap className="w-12 h-12 text-accent-brand-secondary" />
                </AvatarFallback>
              </Avatar>
            </div>
            <CardTitle className="text-xl font-semibold mb-2">
              Supercharge Your Workflow
            </CardTitle>
            <CardDescription className={description}>
              Transform how you consume video content with AI-powered efficiency
              tools
            </CardDescription>
          </CardContent>
        </Card>

        <Card className={`${cardBase} text-center`}>
          <CardContent className="pt-6">
            <div className="flex justify-center mb-6">
              <Avatar className="h-24 w-24">
                <AvatarFallback>
                  <Clock className="w-12 h-12 text-accent-brand-secondary" />
                </AvatarFallback>
              </Avatar>
            </div>
            <CardTitle className="text-xl font-semibold mb-2">
              Reclaim Your Hours
            </CardTitle>
            <CardDescription className={description}>
              Process 10x more content in the same amount of time with smart
              summarization
            </CardDescription>
          </CardContent>
        </Card>

        <Card className={`${cardBase} text-center`}>
          <CardContent className="pt-6">
            <div className="flex justify-center mb-6">
              <Avatar className="h-24 w-24">
                <AvatarFallback>
                  <BookmarkCheck className="w-12 h-12 text-accent-brand-secondary" />
                </AvatarFallback>
              </Avatar>
            </div>
            <CardTitle className="text-xl font-semibold mb-2">
              Build Your Library
            </CardTitle>
            <CardDescription className={description}>
              Sign in and every summary is saved to your dashboard, ready to
              revisit, re-chat, or share later
            </CardDescription>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
