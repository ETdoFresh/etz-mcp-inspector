// src/services/application-service-provider.ts
import { Logger, LogLevel } from './logger-service'; // Import Logger for potential default registration or type usage

// Define a type for service constructors (classes)
type ServiceIdentifier<T> = new (...args: any[]) => T;

/**
 * Provides a central registry for application-wide services.
 * Follows a singleton pattern using static methods.
 */
export class ApplicationServiceProvider {
    private static services: Map<ServiceIdentifier<any>, any> = new Map();
    private static internalLogger: Logger | null = null; // For logging provider actions

    // Private constructor to prevent instantiation
    private constructor() {}

    /**
     * Registers a service instance with a specific identifier (typically the class constructor).
     * @param identifier The identifier for the service (e.g., Logger class).
     * @param instance The singleton instance of the service.
     */
    public static registerService<T>(identifier: ServiceIdentifier<T>, instance: T): void {
        if (this.services.has(identifier)) {
            this.logWarning(`Service with identifier ${identifier.name} is already registered. Overwriting.`);
        }
        this.services.set(identifier, instance);
        this.logInfo(`Service ${identifier.name} registered.`);

        // If registering the Logger itself, keep a reference for internal logging
        if (identifier === Logger) {
          this.internalLogger = instance as Logger;
          // Optionally set a specific log level for the provider itself
          // this.internalLogger.setLogLevel(LogLevel.Info);
          this.internalLogger.LogInfo("ApplicationServiceProvider internal logger initialized.", "ServiceProvider", "Initialization");
        }
    }

    /**
     * Retrieves a registered service instance by its identifier.
     * @param identifier The identifier of the service to retrieve (e.g., Logger class).
     * @returns The service instance, or undefined if not found.
     */
    public static getService<T>(identifier: ServiceIdentifier<T>): T | undefined {
        const instance = this.services.get(identifier);
        if (!instance) {
            // Use warning level for attempts to get unregistered services
            this.logWarning(`Attempted to get unregistered service: ${identifier.name}`);
        }
        return instance as T | undefined;
    }

    // --- Optional: Add a quit method as mentioned in mvc-pattern.mdc ---
    /**
     * Placeholder for application quit logic.
     * Specific implementation depends on the application environment (e.g., Node, Electron, browser).
     */
    public static quitApplication(): void {
        this.logInfo("Quit application requested.", "Application", "ServiceProvider");
        // Add specific exit logic here (e.g., process.exit(), window.close())
        console.log("[ServiceProvider] Application quit sequence initiated..."); // Keep console here as logger might be affected by quit
    }

    // --- Internal logging helpers --- Use console as fallback if logger not ready/registered
    private static logInfo(message: string, ...tags: string[]) {
      if (this.internalLogger) {
        // Always add the ServiceProvider tag internally
        this.internalLogger.LogInfo(message, "ServiceProvider", ...tags);
      } else {
        // Fallback before logger is registered
        const tagString = tags.length > 0 ? `, ${tags.join(', ')}` : '';
        console.info(`[ServiceProvider${tagString}] ${message}`);
      }
    }

    private static logWarning(message: string, ...tags: string[]) {
      if (this.internalLogger) {
        this.internalLogger.LogWarning(message, "ServiceProvider", ...tags);
      } else {
        // Fallback before logger is registered
        const tagString = tags.length > 0 ? `, ${tags.join(', ')}` : '';
        console.warn(`[ServiceProvider${tagString}] ${message}`);
      }
    }
}

// --- Example Initialization (would happen in your main application entry point) ---
/*
import { Logger, LogLevel } from './logger-service';
import { ApplicationServiceProvider } from './application-service-provider';

// 1. Create service instances
const loggerInstance = new Logger();
// Set initial log level if desired
loggerInstance.setLogLevel(LogLevel.Info);

// 2. Register services
ApplicationServiceProvider.registerService(Logger, loggerInstance);

// Add other services
// const anotherService = new AnotherService();
// ApplicationServiceProvider.registerService(AnotherService, anotherService);

// 3. Now services can be retrieved globally
const retrievedLogger = ApplicationServiceProvider.getService(Logger);
retrievedLogger?.LogInfo("Application Initialized", "Application");

// Example of quitting
// ApplicationServiceProvider.quitApplication();
*/ 