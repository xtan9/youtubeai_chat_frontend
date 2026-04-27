import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const cardBase =
  "bg-white dark:bg-white/5 backdrop-blur-sm border-gray-100 dark:border-white/10 shadow-sm";
const muted = "text-gray-500 dark:text-gray-400";
const body = "text-gray-700 dark:text-gray-300 font-medium";
const footerBorder = "border-gray-100 dark:border-white/10";

const testimonials = [
  {
    id: 1,
    name: "Alex Rivera",
    handle: "@AlexTeaches",
    rating: 5,
    text: "As a university professor, I've integrated this tool into my teaching workflow. It helps me quickly digest research videos and create more effective lecture materials. My students love that I can recommend specific video segments rather than entire lectures.",
    date: "May 12, 2023",
  },
  {
    id: 2,
    name: "Sophia Chen",
    handle: "@SophiaTechLead",
    rating: 5,
    text: "Game-changer for my engineering team. We process dozens of technical talks weekly to stay current with industry developments. This tool cuts our research time by 70% and helps us identify the most relevant information for our projects.",
    date: "June 8, 2023",
  },
  {
    id: 3,
    name: "Marcus Johnson",
    handle: "@ContentWithMarcus",
    rating: 5,
    text: "As a content creator, I need to stay on top of trends without spending hours watching videos. This summarizer gives me the perfect balance of depth and efficiency. The key points extraction is surprisingly insightful—it catches nuances that other tools miss.",
    date: "July 15, 2023",
  },
];

export function Testimonials() {
  return (
    <section id="testimonials" className="w-full max-w-6xl mx-auto py-20 scroll-mt-24">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold">Success Stories</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {testimonials.map((testimonial) => (
          <Card
            key={testimonial.id}
            className={`${cardBase} hover:border-purple-500/30 transition-colors`}
          >
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Avatar className="h-12 w-12 border-2 border-purple-500/50">
                  <AvatarFallback className="bg-gradient-to-r from-purple-500 to-cyan-500 text-white">
                    {testimonial.name.substring(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold">{testimonial.name}</div>
                  <div className={`text-sm ${muted}`}>{testimonial.handle}</div>
                </div>
              </div>

              <div className="flex mb-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <svg
                    key={i}
                    className={`w-5 h-5 ${
                      i < testimonial.rating
                        ? "text-yellow-400"
                        : "text-gray-500"
                    }`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>

              <p className={`${body} mb-4`}>{testimonial.text}</p>
            </CardContent>
            <CardFooter className={`px-6 py-3 border-t ${footerBorder}`}>
              <div className={`text-xs ${muted}`}>{testimonial.date}</div>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}
