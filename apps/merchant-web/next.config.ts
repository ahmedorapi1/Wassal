import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@wasel/localization', '@wasel/ui', '@wasel/validation'],
};

export default nextConfig;
