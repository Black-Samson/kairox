import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Optional peer deps pulled in by wallet SDKs that are not needed in the browser bundle.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // wagmi's connector barrel includes the Base Account connector, which drags in the Coinbase CDP
    // server SDK and its optional x402 packages. Kairox doesn't use that connector, so stub it out.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@coinbase/cdp-sdk": false,
    };
    return config;
  },
};

export default nextConfig;
