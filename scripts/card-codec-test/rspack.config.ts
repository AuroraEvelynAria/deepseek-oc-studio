import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Configuration } from '@rspack/core'

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))

const config: Configuration = {
  mode: 'development',
  target: 'node',
  devtool: false,
  entry: './scripts/card-codec-test/entry.ts',
  output: {
    path: path.join(root, 'scripts/card-codec-test/dist'),
    filename: 'codec.cjs',
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
  optimization: { minimize: false },
}

export default config
