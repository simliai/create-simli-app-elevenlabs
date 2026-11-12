import type { NextConfig } from "next";

const securityHeaders = [
  // Only this site may frame the app. (No connect-src etc.: Simli's media hosts aren't pinned here.)
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=()" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
