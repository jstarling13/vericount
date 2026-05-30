import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@vericount/db", "@vericount/shared", "@vericount/slack", "@vericount/stripe-client"],
};

export default nextConfig;
