import './views/theme-toggle';
import { ApplicationServiceProvider } from './services/application-service-provider';
import { Logger, LogLevel } from './services/logger-service';

const message: string = "Hello World";

const appDiv = document.getElementById('app');
if (appDiv) {
    appDiv.innerHTML = `<h1>${message}</h1>`;
}

// Removed Logger initialization - It's now handled in mcp_tester.ts

// Optional: Keep a logger call here if index.ts performs other logic
// But ensure mcp_tester.ts (or wherever registration happens) runs first.
// const logger = ApplicationServiceProvider.getService(Logger);
// logger?.LogDebug((a, b) => a(b), "Index script finished basic setup.", "Index", "Scripting"); 