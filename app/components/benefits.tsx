"use client";

import { Clock, Brain, Sparkles, Zap } from "lucide-react";
import {
  Card,
  CardContent,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function Benefits() {
  return (
    <section className="w-full max-w-6xl mx-auto py-20">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold">Why Choose Our AI Video Analysis</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:border-purple-500/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-purple-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Clock className="w-6 h-6 text-purple-400" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Rapid Knowledge Extraction
                </CardTitle>
                <CardDescription className="text-gray-300">
                  Extract core insights from lengthy videos in minutes, not
                  hours. Our AI distills hours of content into concise,
                  actionable summaries.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:border-cyan-500/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-cyan-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Sparkles className="w-6 h-6 text-cyan-400" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Watch Smarter, Not Longer
                </CardTitle>
                <CardDescription className="text-gray-300">
                  Skip the fluff and focus on what matters. Perfect for
                  researchers, students, and professionals who need information
                  without the time investment.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:border-pink-500/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-pink-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Brain className="w-6 h-6 text-pink-400" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Deep Insight Extraction
                </CardTitle>
                <CardDescription className="text-gray-300">
                  Our advanced AI doesn&apos;t just transcribe—it analyzes
                  context, identifies key arguments, and structures information
                  for maximum comprehension.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:border-amber-500/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-amber-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Zap className="w-6 h-6 text-amber-400" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Effortless Experience
                </CardTitle>
                <CardDescription className="text-gray-300">
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
        <Card className="bg-white/5 backdrop-blur-sm border-white/10 text-center">
          <CardContent className="pt-6">
            <div className="flex justify-center mb-6">
              <Avatar className="h-24 w-24">
                <AvatarImage
                  src="/enhance-productivity.svg"
                  alt="Enhance Productivity"
                />
                <AvatarFallback>
                  <Zap className="w-12 h-12 text-blue-400" />
                </AvatarFallback>
              </Avatar>
            </div>
            <CardTitle className="text-xl font-semibold mb-2">
              Supercharge Your Workflow
            </CardTitle>
            <CardDescription className="text-gray-300">
              Transform how you consume video content with AI-powered efficiency
              tools
            </CardDescription>
          </CardContent>
        </Card>

        <Card className="bg-white/5 backdrop-blur-sm border-white/10 text-center">
          <CardContent className="pt-6">
            <div className="flex justify-center mb-6">
              <Avatar className="h-24 w-24">
                <AvatarImage src="/save-time.svg" alt="Save Time" />
                <AvatarFallback>
                  <Clock className="w-12 h-12 text-blue-400" />
                </AvatarFallback>
              </Avatar>
            </div>
            <CardTitle className="text-xl font-semibold mb-2">
              Reclaim Your Hours
            </CardTitle>
            <CardDescription className="text-gray-300">
              Process 10x more content in the same amount of time with smart
              summarization
            </CardDescription>
          </CardContent>
        </Card>

        <Card className="bg-white/5 backdrop-blur-sm border-white/10 text-center">
          <CardContent className="pt-6">
            <div className="flex justify-center mb-6">
              <Avatar className="h-24 w-24">
                <AvatarImage
                  src="/retain-knowledge.svg"
                  alt="Retain Knowledge"
                />
                <AvatarFallback>
                  <Brain className="w-12 h-12 text-blue-400" />
                </AvatarFallback>
              </Avatar>
            </div>
            <CardTitle className="text-xl font-semibold mb-2">
              Optimize Learning
            </CardTitle>
            <CardDescription className="text-gray-300">
              Boost information retention with structured summaries and key
              point extraction
            </CardDescription>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
