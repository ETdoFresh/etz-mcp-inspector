/**
 * Defines the logging levels.
 */
export enum LogLevel {
  Fatal = 1,
  Error,
  Warning,
  Info,
  Debug,
}

/**
 * Defines the signature for a function that forwards log messages.
 */
export type ForwardLogFunction = (consoleLog: (message: string) => void, message: string) => void;

/**
 * A service for logging messages with different levels and tags.
 * For now, it logs directly to the console.
 */
export class Logger {
  // Placeholder for potential future filtering logic
  private currentLevel: LogLevel = LogLevel.Debug; // Default to show all logs

  /**
   * Logs a fatal message.
   * @param forwardLogFunction Function to forward the log call.
   * @param message The message to log.
   * @param tags Optional tags for filtering.
   */
  public LogFatal(forwardLogFunction: ForwardLogFunction, message: string, ...tags: string[]): void {
    if (LogLevel.Fatal <= this.currentLevel) {
        const tagPrefix = tags.length > 0 ? `[${tags.join(', ')}] ` : '';
        const output = `${tagPrefix}${message}`;
        forwardLogFunction(console.error, output);
    }
  }

  /**
   * Logs an error message.
   * @param forwardLogFunction Function to forward the log call.
   * @param message The message to log.
   * @param tags Optional tags for filtering.
   */
  public LogError(forwardLogFunction: ForwardLogFunction, message: string, ...tags: string[]): void {
    if (LogLevel.Error <= this.currentLevel) {
        const tagPrefix = tags.length > 0 ? `[${tags.join(', ')}] ` : '';
        const output = `${tagPrefix}${message}`;
        forwardLogFunction(console.error, output);
    }
  }

  /**
   * Logs a warning message.
   * @param forwardLogFunction Function to forward the log call.
   * @param message The message to log.
   * @param tags Optional tags for filtering.
   */
  public LogWarning(forwardLogFunction: ForwardLogFunction, message: string, ...tags: string[]): void {
    if (LogLevel.Warning <= this.currentLevel) {
        const tagPrefix = tags.length > 0 ? `[${tags.join(', ')}] ` : '';
        const output = `${tagPrefix}${message}`;
        forwardLogFunction(console.warn, output);
    }
  }

  /**
   * Logs an informational message.
   * @param forwardLogFunction Function to forward the log call.
   * @param message The message to log.
   * @param tags Optional tags for filtering.
   */
  public LogInfo(forwardLogFunction: ForwardLogFunction, message: string, ...tags: string[]): void {
    if (LogLevel.Info <= this.currentLevel) {
        const tagPrefix = tags.length > 0 ? `[${tags.join(', ')}] ` : '';
        const output = `${tagPrefix}${message}`;
        forwardLogFunction(console.info, output);
    }
  }

  public LogTest(forwardLogFunction: ForwardLogFunction, message: string, ...tags: string[]): void {
    // Keep LogTest as is, or potentially align it with others if needed for consistency
    // For now, assuming it might have specific test behavior
    const tagPrefix = tags.length > 0 ? `[${tags.join(', ')}] ` : '';
    const output = `${tagPrefix}${message}`;
    forwardLogFunction(console.log, output); // Use console.log for test messages
  }

  /**
   * Logs a debug message.
   * @param forwardLogFunction Function to forward the log call.
   * @param message The message to log.
   * @param tags Optional tags for filtering.
   */
  public LogDebug(forwardLogFunction: ForwardLogFunction, message: string, ...tags: string[]): void {
     if (LogLevel.Debug <= this.currentLevel) {
        const tagPrefix = tags.length > 0 ? `[${tags.join(', ')}] ` : '';
        const output = `${tagPrefix}${message}`;
        forwardLogFunction(console.debug, output);
    }
  }

  /**
   * Sets the minimum log level to display.
   * @param level The minimum LogLevel.
   */
  public setLogLevel(level: LogLevel): void {
    const oldLevel = this.currentLevel;
    this.currentLevel = level;
    // Use the logger itself for this message, applying the new format
    // Avoid logging if the new level would prevent this message from showing
    if (LogLevel.Info <= this.currentLevel || LogLevel.Info <= oldLevel) {
        // Add the forward function here as well
        this.LogInfo((a,b) => a(b), `Log level set to ${LogLevel[level]} (${level})`);
    }
  }
}

// Example of how it might be registered and used (assuming an ApplicationServiceProvider exists)
/*
import { ApplicationServiceProvider } from './application-service-provider'; // Adjust path as needed
import { Logger, LogLevel } from './logger-service';

// --- Somewhere during application initialization ---
const logger = new Logger();
logger.setLogLevel(LogLevel.Debug); // Set initial level
ApplicationServiceProvider.registerService(Logger, logger); // Example registration method

// --- Somewhere else in the application ---
const appLogger = ApplicationServiceProvider.getService(Logger);
appLogger?.LogInfo("Application started", "Application"); // Output: [Application] Application started
appLogger?.LogDebug("Debugging component X", "ComponentX", "Debug"); // Output: [ComponentX, Debug] Debugging component X
appLogger?.LogWarning("Just a warning"); // Output: Just a warning
*/ 