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
 * A service for logging messages with different levels and tags.
 * For now, it logs directly to the console.
 */
export class Logger {
  // Placeholder for potential future filtering logic
  private currentLevel: LogLevel = LogLevel.Debug; // Default to show all logs

  private log(level: LogLevel, message: string, tags: string[]): void {
    if (level <= this.currentLevel) {
      // Format with tags first, no level string
      const tagPrefix = tags.length > 0 ? `[${tags.join(', ')}] ` : '';
      const output = `${tagPrefix}${message}`;

      switch (level) {
        case LogLevel.Fatal:
        case LogLevel.Error:
          console.error(output);
          break;
        case LogLevel.Warning:
          console.warn(output);
          break;
        case LogLevel.Info:
          console.info(output);
          break;
        case LogLevel.Debug:
        default:
          console.debug(output); // console.debug might not show in all browser consoles by default
          // Or use console.log(output);
          break;
      }
    }
  }

  /**
   * Logs a fatal message.
   * @param message The message to log.
   * @param tags Optional tags for filtering.
   */
  public LogFatal(message: string, ...tags: string[]): void {
    this.log(LogLevel.Fatal, message, tags);
  }

  /**
   * Logs an error message.
   * @param message The message to log.
   * @param tags Optional tags for filtering.
   */
  public LogError(message: string, ...tags: string[]): void {
    this.log(LogLevel.Error, message, tags);
  }

  /**
   * Logs a warning message.
   * @param message The message to log.
   * @param tags Optional tags for filtering.
   */
  public LogWarning(message: string, ...tags: string[]): void {
    this.log(LogLevel.Warning, message, tags);
  }

  /**
   * Logs an informational message.
   * @param message The message to log.
   * @param tags Optional tags for filtering.
   */
  public LogInfo(message: string, ...tags: string[]): void {
    this.log(LogLevel.Info, message, tags);
  }

  /**
   * Logs a debug message.
   * @param message The message to log.
   * @param tags Optional tags for filtering.
   */
  public LogDebug(message: string, ...tags: string[]): void {
    this.log(LogLevel.Debug, message, tags);
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
        this.LogInfo(`Log level set to ${LogLevel[level]} (${level})`);
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