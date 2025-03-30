import './views/theme-toggle';
import { McpController } from './controllers/mcp.controller';

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded. Initializing MCP Application...");
    try {
        // Instantiate the main controller - it handles initializing the view and service
        new McpController();
        console.log("MCP Application initialized successfully.");
    } catch (error: any) {
        console.error("Failed to initialize MCP Application:", error);
        // Display a fallback error message if controller initialization fails catastrophically
        const body = document.body;
        if (body) {
            body.innerHTML = `<div style="color: red; padding: 20px;"><h1>Fatal Error</h1><p>Application failed to start. Please check the console for details.</p><pre>${error.stack || error.message}</pre></div>`;
        }
    }
});
