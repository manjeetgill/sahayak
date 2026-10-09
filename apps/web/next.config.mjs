import process from 'node:process';
/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@sahayak/shared'],
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async rewrites() {
    return [
      {
        source: '/public/:slug([a-z0-9-]+)/feedback/:action(open|response|resolution|stop)',
        destination: `${process.env.INTERNAL_API_URL || 'http://127.0.0.1:4000'}/public/:slug/feedback/:action`,
      },
    ];
  },
};
