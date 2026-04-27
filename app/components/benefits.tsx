import { Clock, Brain, Sparkles, Zap } from "lucide-react";
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
          className={`${cardBase} hover:border-purple-500/30 transition-colors`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-purple-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Clock className="w-6 h-6 text-purple-500" />
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
          className={`${cardBase} hover:border-cyan-500/30 transition-colors`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-cyan-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Sparkles className="w-6 h-6 text-cyan-500" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Watch Smarter, Not Longer
                </CardTitle>
                <CardDescription className={description}>
                  Skip the fluff and focus on what matters. Perfect for
                  researchers, students, and professionals who need information
                  without the time investment.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`${cardBase} hover:border-pink-500/30 transition-colors`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-pink-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Brain className="w-6 h-6 text-pink-500" />
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
          className={`${cardBase} hover:border-amber-500/30 transition-colors`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-amber-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Zap className="w-6 h-6 text-amber-500" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Effortless Experience
                </CardTitle>
                <CardDescription className={description}>
                  No complicated setup or learning curve. Paste a URL, click
                  once, and receive your comprehensive summary in seconds—all
                  with our intuitive interface.
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
                  <Zap className="w-12 h-12 text-blue-500" />
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
                  <Clock className="w-12 h-12 text-blue-500" />
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
                  <Brain className="w-12 h-12 text-blue-500" />
                </AvatarFallback>
              </Avatar>
            </div>
            <CardTitle className="text-xl font-semibold mb-2">
              Optimize Learning
            </CardTitle>
            <CardDescription className={description}>
              Boost information retention with structured summaries and key
              point extraction
            </CardDescription>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
