import { BookOpen, Briefcase, Users, Video } from "lucide-react";
import {
  Card,
  CardContent,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const cardBase =
  "bg-white dark:bg-white/5 backdrop-blur-sm border-gray-100 dark:border-white/10 shadow-sm";
const description = "text-gray-700 dark:text-gray-300 font-medium";

export function UseCases() {
  return (
    <section className="w-full max-w-6xl mx-auto py-20">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold">Perfect For Your Needs</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card
          className={`${cardBase} hover:border-blue-500/30 transition-colors`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-blue-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <BookOpen className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Academic Excellence
                </CardTitle>
                <CardDescription className={description}>
                  Transform how you study with lecture summaries, research video
                  analysis, and course material digests. Get the key concepts
                  without rewatching hours of educational content.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`${cardBase} hover:border-green-500/30 transition-colors`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-green-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Briefcase className="w-6 h-6 text-green-600 dark:text-green-400" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Professional Development
                </CardTitle>
                <CardDescription className={description}>
                  Stay ahead in your field without the time sink. Extract
                  insights from industry talks, conference presentations, and
                  technical tutorials in a fraction of the time.
                </CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`${cardBase} hover:border-purple-500/30 transition-colors`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-purple-500/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Video className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Content Creation & Research
                </CardTitle>
                <CardDescription className={description}>
                  Accelerate your content strategy by quickly analyzing market
                  trends, competitor videos, and audience preferences. Build
                  better content with data-driven insights.
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
                  <Users className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">
                  Everyday Efficiency
                </CardTitle>
                <CardDescription className={description}>
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
