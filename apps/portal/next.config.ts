import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@vericount/ai",
    "@vericount/db",
    "@vericount/pdf",
    "@vericount/plaid",
    "@vericount/qbo",
    "@vericount/shared",
    "@vericount/slack",
    "@vericount/stripe-client",
  ],
};

export default nextConfig;
