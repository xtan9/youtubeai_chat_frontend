import { useTranslations } from "next-intl";
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
  const t = useTranslations("home");
  return (
    <section id="use-cases" className="w-full max-w-6xl mx-auto py-20 scroll-mt-24">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold">{t("casesHeading")}</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card
          className={`${cardBase} hover:border-accent-brand-secondary/30 transition-colors`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-accent-brand-secondary/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <BookOpen className="w-6 h-6 text-accent-brand-secondary" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">{t("study")}</CardTitle>
                <CardDescription className={description}>{t("studyBody")}</CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`${cardBase} hover:border-accent-success/30 transition-colors`}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-12 w-12 rounded-lg bg-accent-success/20 p-0">
                <AvatarFallback className="bg-transparent">
                  <Briefcase className="w-6 h-6 text-accent-success" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">{t("work")}</CardTitle>
                <CardDescription className={description}>{t("workBody")}</CardDescription>
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
                  <Video className="w-6 h-6 text-accent-brand" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">{t("creator")}</CardTitle>
                <CardDescription className={description}>{t("creatorBody")}</CardDescription>
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
                  <Users className="w-6 h-6 text-accent-warning" />
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-xl font-semibold mb-2">{t("daily")}</CardTitle>
                <CardDescription className={description}>{t("dailyBody")}</CardDescription>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
