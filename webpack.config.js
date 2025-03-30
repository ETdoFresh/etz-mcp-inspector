const path = require('path');
const fs = require('fs'); // Require the file system module
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { mcpProxyHandler } = require('./src/mcp_proxy_handler.js'); // Revert to .js

// Define your entry points
const entryPoints = {
  index: './src/index.ts',
  mcp_tester: './src/mcp_tester.ts',
  // Add other entry points here if needed, matching HTML file names in public/
};

// Function to generate HtmlWebpackPlugin instances
function generateHtmlPlugins(templateDir) {
  // Ensure the template directory exists
  const absoluteTemplateDir = path.resolve(__dirname, templateDir);
  if (!fs.existsSync(absoluteTemplateDir)) {
    console.warn(`Warning: Template directory not found: ${absoluteTemplateDir}`);
    return []; // Return empty array if directory doesn't exist
  }

  const templateFiles = fs.readdirSync(absoluteTemplateDir);
  return templateFiles
    .filter(item => item.toLowerCase().endsWith('.html')) // Filter for .html files (case-insensitive)
    .map(item => {
      const name = path.basename(item, '.html'); // Get filename without extension
      const nameLower = name.toLowerCase(); // Use lower case for matching entry points

      // Find the matching entry point key (case-insensitive)
      const entryPointKey = Object.keys(entryPoints).find(key => key.toLowerCase() === nameLower);

      // Ensure there's a corresponding entry point
      if (entryPointKey) {
        return new HtmlWebpackPlugin({
          template: path.resolve(__dirname, templateDir, item),
          filename: item, // Output filename will be the same as template
          chunks: [entryPointKey] // Link to the corresponding entry chunk
        });
      } else {
        console.warn(`Warning: No matching entry point found for HTML template: ${item}. Skipping.`);
        return null; // Return null if no matching entry point
      }
    })
    .filter(plugin => plugin !== null); // Filter out null values
}

const htmlPlugins = generateHtmlPlugins('./public');

module.exports = {
  mode: 'development',
  entry: entryPoints, // Use the defined entry points
  devtool: 'inline-source-map',
  optimization: {
    splitChunks: {
      chunks: 'all',
      minSize: 20000,
      maxSize: 244000,
      minChunks: 1,
      maxAsyncRequests: 30,
      maxInitialRequests: 30,
      cacheGroups: {
        defaultVendors: {
          test: /[\\/]node_modules[\\/]/,
          priority: -10,
          reuseExistingChunk: true,
        },
        default: {
          minChunks: 2,
          priority: -20,
          reuseExistingChunk: true,
        },
      },
    },
  },
  devServer: {
    static: './public', // Serve static files from the public directory
    hot: true,
    // Add the setupMiddlewares configuration
    setupMiddlewares: (middlewares, devServer) => {
      if (!devServer) {
        throw new Error('webpack-dev-server is not defined');
      }

      // Add our custom middleware BEFORE the default middlewares
      // Let the middleware function handle the path check internally
      middlewares.unshift({
        name: 'mcp-proxy-middleware',
        middleware: mcpProxyHandler,
      });

      return middlewares;
    },
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
  plugins: [
    ...htmlPlugins, // Spread the dynamically generated plugins
    // Add any other static plugins here if needed
  ],
}; 