import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  webpack(config) {
    config.resolve = config.resolve ?? {}
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    }
    config.resolve.alias = {
      ...config.resolve.alias,
      '@pay/coral-client': path.resolve(__dirname, '../packages/coral-client/src'),
    }
    return config
  },
}

export default nextConfig
