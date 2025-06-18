import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "youtubeai.chat",
          },
        ],
        destination: "https://www.youtubeai.chat/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
