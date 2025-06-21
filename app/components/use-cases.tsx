"use client";

import { BookOpen, Briefcase, Users, Video } from "lucide-react";
import {
  Card,
  CardContent,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function UseCases() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Mount after hydration to prevent mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Safe theme detection
  const isDarkMode = mounted && resolvedTheme === "dark";

  // Theme-specific styles
  const cardBg = isDarkMode ? "bg-white/5" : "bg-white";
  const cardBorder = isDarkMode ? "border-white/10" : "border-gray-100";
  const descriptionText = isDarkMode ? "text-gray-300" : "text-gray-700";

  // Icon colors
  const blueIcon = isDarkMode ? "text-blue-400" : "text-blue-600";
  const greenIcon = isDarkMode ? "text-green-400" : "text-green-600";
  const purpleIcon = isDarkMode ? "text-purple-400" : "text-purple-600";
  const amberIcon = isDarkMode ? "text-amber-400" : "text-amber-600";

  return (
    <section className="w-full max-w-6xl mx-auto py-20">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold">Perfect For Your Needs</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card
          className={`${cardBg} backdrop-blur-sm ${cardBorder} hover:border-blue-500/30 transition-colors shadow-sm`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-blue-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <BookOpen className={`w-6 h-6 ${blueIcon}`} />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Academic Excellence
                </CardTitle>
                <CardDescription className={`${descriptionText} font-medium`}>
                  Transform how you study with lecture summaries, research video
                  analysis, and course material digests. Get the key concepts
                  without rewatching hours of educational content.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`${cardBg} backdrop-blur-sm ${cardBorder} hover:border-green-500/30 transition-colors shadow-sm`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-green-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Briefcase className={`w-6 h-6 ${greenIcon}`} />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Professional Development
                </CardTitle>
                <CardDescription className={`${descriptionText} font-medium`}>
                  Stay ahead in your field without the time sink. Extract
                  insights from industry talks, conference presentations, and
                  technical tutorials in a fraction of the time.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`${cardBg} backdrop-blur-sm ${cardBorder} hover:border-purple-500/30 transition-colors shadow-sm`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-purple-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Video className={`w-6 h-6 ${purpleIcon}`} />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Content Creation & Research
                </CardTitle>
                <CardDescription className={`${descriptionText} font-medium`}>
                  Accelerate your content strategy by quickly analyzing market
                  trends, competitor videos, and audience preferences. Build
                  better content with data-driven insights.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`${cardBg} backdrop-blur-sm ${cardBorder} hover:border-amber-500/30 transition-colors shadow-sm`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-amber-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Users className={`w-6 h-6 ${amberIcon}`} />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Everyday Efficiency
                </CardTitle>
                <CardDescription className={`${descriptionText} font-medium`}>
                  Make informed decisions about which videos deserve your full
                  attention. Get the essence of product reviews, documentaries,
                  and tutorials before committing your time.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
