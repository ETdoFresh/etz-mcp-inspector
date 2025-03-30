import './views/theme-toggle';
import { McpController } from './controllers/mcp.controller';
import { ApplicationServiceProvider } from './services/application-service-provider';
import { Logger, LogLevel } from './services/logger-service';

document.addEventListener('DOMContentLoaded', () => {
    // --- Logger Initialization ---
    const loggerInstance = new Logger();
    // Set desired initial log level (e.g., Debug for development)
    loggerInstance.setLogLevel(LogLevel.Debug);
    ApplicationServiceProvider.registerService(Logger, loggerInstance);
    // --- End Logger Initialization ---

    // Now get the registered logger
    const logger = ApplicationServiceProvider.getService(Logger);
    if (!logger) {
        // This fallback should ideally not be needed anymore, but kept as safety
        console.error("Logger service could not be initialized or retrieved! Cannot initialize application.");
        return;
    }
    logger.LogInfo((a, b) => a(b), "DOM Loaded. Initializing MCP Application...", "Application", "Initialization");

    try {
        // Instantiate the main controller - it handles initializing the view and service
        new McpController();
        logger.LogInfo((a, b) => a(b), "MCP Application initialized successfully.", "Application", "Initialization");
    } catch (error: any) {
        // Log the error using the logger
        logger.LogError((a, b) => a(b), `Failed to initialize MCP Application: ${error.message}`, "Application", "Initialization", "Fatal");
        // Also log the stack trace if available
        if (error.stack) {
            logger.LogError((a, b) => a(b), `Stack trace: ${error.stack}`, "Application", "Initialization", "Fatal");
        }

        // Display a fallback error message if controller initialization fails catastrophically
        // Note: This UI update might still be useful even with logging
        const body = document.body;
        if (body) {
            body.innerHTML = `<div style="color: red; padding: 20px;"><h1>Fatal Error</h1><p>Application failed to start. Please check the console or logs for details.</p><pre>${error.stack || error.message}</pre></div>`;
        }
    }
});
