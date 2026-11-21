import { useTranslations } from "next-intl";
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
  const t = useTranslations("home");
  return (
    <section id="benefits" className="w-full max-w-6xl mx-auto py-20 scroll-mt-24">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold">{t("benefitHeading")}</h2>
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
                <CardTitle className="text-xl font-semibold mb-2">{t("extract")}</CardTitle>
                <CardDescription className={description}>{t("extractBody")}</CardDescription>
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
                <CardTitle className="text-xl font-semibold mb-2">{t("askTranscript")}</CardTitle>
                <CardDescription className={description}>{t("askTranscriptBody")}</CardDescription>
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
                <CardTitle className="text-xl font-semibold mb-2">{t("deep")}</CardTitle>
                <CardDescription className={description}>{t("deepBody")}</CardDescription>
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
                <CardTitle className="text-xl font-semibold mb-2">{t("withoutCaptions")}</CardTitle>
                <CardDescription className={description}>{t("withoutCaptionsBody")}</CardDescription>
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
            <CardTitle className="text-xl font-semibold mb-2">{t("workflow")}</CardTitle>
            <CardDescription className={description}>{t("workflowBody")}</CardDescription>
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
            <CardTitle className="text-xl font-semibold mb-2">{t("time")}</CardTitle>
            <CardDescription className={description}>{t("timeBody")}</CardDescription>
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
            <CardTitle className="text-xl font-semibold mb-2">{t("library")}</CardTitle>
            <CardDescription className={description}>{t("libraryBody")}</CardDescription>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
