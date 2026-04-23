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
  async rewrites() {
    // Proxy Guacamole through the dashboard so middleware can enforce auth first.
    // (HTTP works here. WebSocket upgrade is handled by the custom server in `server/proxy.ts`.)
    return [
      {
        source: "/guacamole/:path*",
        destination: "http://localhost:8080/guacamole/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
