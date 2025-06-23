import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  async redirects() {
    return [
      // Redirect from non-www to www
      {
        source: "http://youtubeai.chat/:path*",
        destination: "https://www.youtubeai.chat/:path*",
        permanent: true,
      },
      {
        source: "https://youtubeai.chat/:path*",
        destination: "https://www.youtubeai.chat/:path*",
        permanent: true,
      },
      // Redirect from http www to https www
      {
        source: "http://www.youtubeai.chat/:path*",
        destination: "https://www.youtubeai.chat/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
