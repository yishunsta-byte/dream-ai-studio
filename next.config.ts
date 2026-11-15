import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "./storage/**/*", "./backups/**/*", "./tmp/**/*", "./.tools/**/*", "./.env*"],
  },
};

export default config;
