/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  transpilePackages: ["@gatehouse/api", "@gatehouse/db"],
  serverExternalPackages: ["postgres"],
};
