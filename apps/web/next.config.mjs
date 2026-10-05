import process from 'node:process';
/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@sahayak/shared'],
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || '.next',
};
