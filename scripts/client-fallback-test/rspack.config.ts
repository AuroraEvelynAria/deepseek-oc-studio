import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rspack } from '@rspack/core'
import type { Configuration } from '@rspack/core'

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))

const config: Configuration = {
  mode: 'development',
  target: 'node',
  devtool: false,
  entry: './scripts/client-fallback-test/entry.ts',
  output: {
    path: path.join(root, 'scripts/client-fallback-test/dist'),
    filename: 'test.cjs',
    library: { type: 'commonjs2' },
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    rules: [
      {
        test: /\.(?:[cm]?js|jsx|tsx?)$/,
        loader: 'builtin:swc-loader',
        options: {
          detectSyntax: 'auto',
          isModule: 'unknown',
          jsc: { externalHelpers: true },
        },
        type: 'javascript/auto',
      },
    ],
  },
  plugins: [
    new rspack.DefinePlugin({
      __API_ORIGIN__: JSON.stringify('https://api.deepseek.com'),
    }),
  ],
  optimization: { minimize: false },
}

export default config
