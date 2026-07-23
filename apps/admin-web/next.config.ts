import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@wasel/localization', '@wasel/ui'],
};

export default nextConfig;
