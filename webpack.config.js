const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'development',
  entry: {
    main: './src/main.ts',
    mcp_tester: './src/mcp_tester.ts',
  },
  devtool: 'inline-source-map',
  devServer: {
    static: './dist', // Serve files from the final build directory
    hot: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  output: {
    filename: '[name].js', // Use entry point name for output file
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  plugins: [],
}; 