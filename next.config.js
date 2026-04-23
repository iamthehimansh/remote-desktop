/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  experimental: {
    serverComponentsExternalPackages: ["systeminformation"],
  },
  async headers() {
    return [
      {
        source: "/dashboard/rdp",
        headers: [
          {
            key: "Permissions-Policy",
            value: "clipboard-read=(self \"*\"), clipboard-write=(self \"*\"), microphone=(self \"*\"), camera=(self \"*\"), fullscreen=(self \"*\"), display-capture=(self \"*\")",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
