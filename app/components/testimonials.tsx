"use client";

import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

export function Testimonials() {
  const testimonials = [
    {
      id: 1,
      name: "Jessica Miller",
      handle: "@MillerWorld",
      avatar: "/avatars/jessica.jpg",
      rating: 5,
      text: "I personally use this YouTube summarizer every day and it has drastically increased my productivity. I highly recommend that everyone give it a try. If you have any feedback or requests for new features, please let the team know by leaving a comment so they can continue to improve the product.",
      date: "Mar 5, 2023",
    },
    {
      id: 2,
      name: "Michael Chen",
      handle: "@TechWithMike",
      avatar: "/avatars/michael.jpg",
      rating: 5,
      text: "As a tech educator, I need to stay on top of hundreds of videos. This AI summarizer has been a game changer for my workflow. I can quickly decide which videos are worth watching in full and which ones I can just get the key points from.",
      date: "Apr 12, 2023",
    },
    {
      id: 3,
      name: "Sarah Johnson",
      handle: "@SarahStudies",
      avatar: "/avatars/sarah.jpg",
      rating: 4,
      text: "This tool has been invaluable for my research. It helps me extract the most important information from lengthy lectures and tutorials without having to watch them entirely. Saves me hours every week!",
      date: "May 20, 2023",
    },
  ];

  return (
    <section className="w-full max-w-6xl mx-auto py-20">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-bold">What They Say About Us?</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {testimonials.map((testimonial) => (
          <Card
            key={testimonial.id}
            className="bg-white/5 backdrop-blur-sm border-white/10 hover:border-purple-500/30 transition-colors"
          >
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Avatar className="h-12 w-12 border-2 border-purple-500/50">
                  <AvatarImage
                    src={testimonial.avatar}
                    alt={testimonial.name}
                  />
                  <AvatarFallback className="bg-gradient-to-r from-purple-500 to-cyan-500">
                    {testimonial.name.substring(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold">{testimonial.name}</div>
                  <div className="text-sm text-gray-400">
                    {testimonial.handle}
                  </div>
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

              <p className="text-gray-300 mb-4">{testimonial.text}</p>
            </CardContent>
            <CardFooter className="px-6 py-3 border-t border-white/10">
              <div className="text-xs text-gray-400">{testimonial.date}</div>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}
