import { Card, CardContent } from "@/components/ui/card";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PlayCircle } from "lucide-react";
import Image from "next/image";
import { HOW_IT_WORKS_STEPS } from "./how-it-works-steps";

const cardBase =
  "bg-white dark:bg-white/5 backdrop-blur-sm border-gray-100 dark:border-white/10 shadow-sm";
const description = "text-gray-700 dark:text-gray-300 font-medium";
const badgeGradient = "bg-gradient-brand-primary";

export function HowItWorks() {
  return (
    <section id="how-it-works" className="w-full max-w-6xl mx-auto py-20 scroll-mt-24">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold">Your Video Insights in 5 Steps</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-8">
          {HOW_IT_WORKS_STEPS.map((step, i) => (
            <div key={step.title} className="flex gap-4">
              <Badge
                className={`shrink-0 w-10 h-10 rounded-full ${badgeGradient} flex items-center justify-center text-white font-bold p-0`}
              >
                {i + 1}
              </Badge>
              <div>
                <h3 className="text-xl font-semibold mb-2">{step.title}</h3>
                <p className={description}>{step.body}</p>
              </div>
            </div>
          ))}
        </div>

        <Card className={`${cardBase} overflow-hidden`}>
          <CardContent className="p-4">
            <div className="relative">
              <AspectRatio
                ratio={16 / 9}
                className="bg-gradient-brand-soft rounded-lg overflow-hidden"
              >
                <Image
                  src="/youtube-summary-demo.png"
                  alt="AI summary of a YouTube video — example output"
                  fill
                  className="object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 bg-white/10 backdrop-blur-sm rounded-full flex items-center justify-center">
                    <PlayCircle className="w-8 h-8 text-white fill-white/10" />
                  </div>
                </div>
              </AspectRatio>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {/* TODO(design-followup): YouTube logo red is a third-party
                      brand color and doesn't map to a semantic token. Consider
                      introducing a `--color-brand-youtube` token or sourcing the
                      official YouTube asset instead of recreating it here. */}
                  {/* eslint-disable-next-line no-restricted-syntax */}
                  <Avatar className="w-8 h-8 bg-gradient-to-r from-red-500 to-red-600">
                    <AvatarFallback className="text-xs text-white font-bold">
                      YT
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium">
                    See Our AI Summarizer in Action
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
