"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, ArrowRight, Zap, Globe, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function YouTubeSummarizerHero() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const isValidYouTubeUrl = (url: string) => {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    return youtubeRegex.test(url);
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!url.trim()) {
      setError("Please enter a video URL");
      return;
    }

    if (!isValidYouTubeUrl(url)) {
      setError("Please enter a valid YouTube URL");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        router.push("/auth/login");
        return;
      }

      const encodedUrl = encodeURIComponent(url);
      router.push(`/protected?url=${encodedUrl}`);
      
    } catch (error) {
      console.error("Error:", error);
      setError("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoClick = () => {
    setUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  };

  return (
    <div className="relative max-w-4xl mx-auto">
      {/* Main Input Card */}
      <div className="relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 rounded-3xl blur-sm opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-pulse"></div>
        <div className="relative bg-slate-900/90 backdrop-blur-xl border border-white/20 rounded-3xl p-8 md:p-12">
          <form onSubmit={handleAnalyze} className="space-y-6">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-cyan-500/20 rounded-2xl blur-xl"></div>
              <div className="relative bg-white/5 backdrop-blur-sm border border-white/20 rounded-2xl p-1">
                <div className="flex flex-col md:flex-row gap-3">
                  <div className="flex-1 relative">
                    <Input
                      type="url"
                      placeholder="Paste any YouTube URL here to unlock insights..."
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        setError(null);
                      }}
                      className="h-16 text-lg bg-transparent border-0 text-white placeholder:text-gray-400 focus:ring-0 focus:outline-none"
                    />
                    <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                      <Sparkles size={20} className="text-purple-400" />
                    </div>
                  </div>
                  <Button 
                    type="submit" 
                    size="lg" 
                    className="h-16 px-8 bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white font-semibold text-lg rounded-xl border-0 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-300"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2"></div>
                        Analyzing...
                      </>
                    ) : (
                      <>
                        Analyze Video
                        <ArrowRight className="ml-2 h-5 w-5" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
            
            {error && (
              <div className="text-center">
                <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg py-2 px-4 inline-block">
                  {error}
                </p>
              </div>
            )}
          </form>
          
          <div className="mt-8 text-center">
            <button 
              onClick={handleDemoClick}
              className="text-purple-300 hover:text-white transition-colors text-sm font-medium"
            >
              Try with example video →
            </button>
          </div>
        </div>
      </div>

      {/* Feature Pills */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-12">
        <div className="group relative">
          <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-2xl blur-lg group-hover:blur-xl transition-all opacity-0 group-hover:opacity-100"></div>
          <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 text-center hover:border-purple-500/30 transition-all">
            <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <h3 className="font-semibold text-white mb-2">Lightning Speed</h3>
            <p className="text-gray-400 text-sm">Process any video in under 10 seconds</p>
          </div>
        </div>

        <div className="group relative">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-2xl blur-lg group-hover:blur-xl transition-all opacity-0 group-hover:opacity-100"></div>
          <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 text-center hover:border-cyan-500/30 transition-all">
            <div className="w-12 h-12 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Globe className="w-6 h-6 text-white" />
            </div>
            <h3 className="font-semibold text-white mb-2">Universal Support</h3>
            <p className="text-gray-400 text-sm">Works with any YouTube video</p>
          </div>
        </div>

        <div className="group relative">
          <div className="absolute inset-0 bg-gradient-to-r from-pink-500/10 to-purple-500/10 rounded-2xl blur-lg group-hover:blur-xl transition-all opacity-0 group-hover:opacity-100"></div>
          <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 text-center hover:border-pink-500/30 transition-all">
            <div className="w-12 h-12 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <h3 className="font-semibold text-white mb-2">Privacy First</h3>
            <p className="text-gray-400 text-sm">Your data stays secure and private</p>
          </div>
        </div>
      </div>
    </div>
  );
} 