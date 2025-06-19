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
        <h2 className="text-4xl font-bold">Benefits</h2>
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
                  Time-Saving:
                </CardTitle>
                <CardDescription className="text-gray-300">
                  YouTube summary with AI provides concise summaries, letting
                  you understand video content in a fraction of the original
                  video length.
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
                  Convenience:
                </CardTitle>
                <CardDescription className="text-gray-300">
                  Get accurate summaries without having to watch entire videos,
                  ideal for viewers with limited time.
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
                  Improved Content Understanding:
                </CardTitle>
                <CardDescription className="text-gray-300">
                  By highlighting key points, the tool enhances your
                  comprehension of the video content.
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
                  User-Friendly:
                </CardTitle>
                <CardDescription className="text-gray-300">
                  Our tool is easy to use - just paste the YouTube URL, and the
                  summary is generated in seconds.
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
              Enhance Productivity
            </CardTitle>
            <CardDescription className="text-gray-300">
              Make a big impact with bite-size summaries
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
              Save Time
            </CardTitle>
            <CardDescription className="text-gray-300">
              Take in more information in a fraction of the time
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
              Retain Knowledge
            </CardTitle>
            <CardDescription className="text-gray-300">
              Convert videos into text and unlock your true learning potential
            </CardDescription>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
