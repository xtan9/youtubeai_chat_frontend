"use client";

import { Card, CardContent } from "@/components/ui/card";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PlayCircle } from "lucide-react";
import Image from "next/image";

export function HowItWorks() {
  return (
    <section className="w-full max-w-6xl mx-auto py-20">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold">How to Summarize YouTube Video</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-8">
          <div className="flex gap-4">
            <Badge className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-cyan-500 flex items-center justify-center text-white font-bold p-0">
              1
            </Badge>
            <div>
              <h3 className="text-xl font-semibold mb-2">Enter YouTube URL</h3>
              <p className="text-gray-300">
                Find a video on YouTube that you would like to summarize and
                paste the URL into the input field.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <Badge className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-cyan-500 flex items-center justify-center text-white font-bold p-0">
              2
            </Badge>
            <div>
              <h3 className="text-xl font-semibold mb-2">
                Click &quot;Summarize&quot;
              </h3>
              <p className="text-gray-300">
                Click the button to start the AI-powered summarization process.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <Badge className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-cyan-500 flex items-center justify-center text-white font-bold p-0">
              3
            </Badge>
            <div>
              <h3 className="text-xl font-semibold mb-2">
                Wait for Processing
              </h3>
              <p className="text-gray-300">
                Our AI will download the video, transcribe it, and generate a
                comprehensive summary.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <Badge className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-cyan-500 flex items-center justify-center text-white font-bold p-0">
              4
            </Badge>
            <div>
              <h3 className="text-xl font-semibold mb-2">Get Your Summary</h3>
              <p className="text-gray-300">
                View the AI-generated summary, key points, and insights. You can
                copy the text or share it with others.
              </p>
            </div>
          </div>
        </div>

        <Card className="bg-white/5 backdrop-blur-sm border-white/10 overflow-hidden">
          <CardContent className="p-4">
            <div className="relative">
              <AspectRatio
                ratio={16 / 9}
                className="bg-gradient-to-br from-purple-500/20 to-cyan-500/20 rounded-lg overflow-hidden"
              >
                <Image
                  src="/youtube-summary-demo.png"
                  alt="YouTube Summary Demo"
                  fill
                  className="object-cover"
                  onError={(
                    e: React.SyntheticEvent<HTMLImageElement, Event>
                  ) => {
                    const fallbackSvg =
                      "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2338bdf8' stroke-width='2'%3E%3Crect width='20' height='16' x='2' y='4' rx='2'/%3E%3Cpath d='m10 9 5 3-5 3z'/%3E%3C/svg%3E";
                    const target = e.currentTarget as HTMLImageElement;
                    target.src = fallbackSvg;
                    target.style.padding = "20%";
                    target.style.background = "#0f172a";
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 bg-white/10 backdrop-blur-sm rounded-full flex items-center justify-center">
                    <PlayCircle className="w-8 h-8 text-white fill-white/10" />
                  </div>
                </div>
              </AspectRatio>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Avatar className="w-8 h-8 bg-gradient-to-r from-red-500 to-red-600">
                    <AvatarFallback className="text-xs text-white font-bold">
                      YT
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium">
                    How to Use YouTube AI Summary
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className="text-xs text-gray-400 bg-transparent"
                >
                  2:45
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
