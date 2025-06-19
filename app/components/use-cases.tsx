"use client";

import { BookOpen, Briefcase, Users, Video } from "lucide-react";
import {
  Card,
  CardContent,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function UseCases() {
  return (
    <section className="w-full max-w-6xl mx-auto py-20">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold">Use Cases</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:border-blue-500/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-blue-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <BookOpen className="w-6 h-6 text-blue-400" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Students and Learners:
                </CardTitle>
                <CardDescription className="text-gray-300">
                  Use the YouTube Summary Generator to get the key points from
                  long educational videos or lectures, saving you time and
                  enhancing your learning process.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:border-green-500/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-green-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Briefcase className="w-6 h-6 text-green-400" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Busy Professionals:
                </CardTitle>
                <CardDescription className="text-gray-300">
                  If you need to catch up on industry trends or learn new skills
                  via YouTube but are pressed for time, use our tool to get a
                  quick summary.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:border-purple-500/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-purple-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Video className="w-6 h-6 text-purple-400" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Content Creators and Marketers:
                </CardTitle>
                <CardDescription className="text-gray-300">
                  Quickly understand the content of competitor videos or
                  trending topics in your domain for research purposes.
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
                  <Users className="w-6 h-6 text-amber-400" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Casual Viewers:
                </CardTitle>
                <CardDescription className="text-gray-300">
                  Get the gist of lengthy videos, reviews, tutorials, or
                  documentaries without having to watch them in entirety.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
