// src/mcp-communication.ts
import { McpMessagePayload } from '../models/mcp-message-payload.model';
import { ApplicationServiceProvider } from './application-service-provider';
import { Logger } from './logger-service';

// Define the structure for connection configuration
export interface McpConnectionConfig {
    transport: string;
    command: string;
    args: string[];
}

// Define the structure for callbacks that the communicator will use to signal events
export interface McpCommunicationCallbacks {
    onConnecting: () => void;
    onConnected: () => void;
    onDisconnected: (code?: number | string) => void;
    onError: (error: string, isConnectionError: boolean) => void;
    onMcpMessage: (payload: McpMessagePayload) => void;
    onLogMessage: (source: string, content: string) => void;
    // Optional: Add specific callback for command errors if needed
    // onCommandError: (commandType: string, error: string) => void;
}

export class McpCommunicationService {
    private logger: Logger | undefined = ApplicationServiceProvider.getService(Logger);
    private eventSource: EventSource | null = null;
    private isConnectedState: boolean = false;
    private readonly MCP_PROXY_PATH = '/mcp-proxy'; // Path for SSE and POST requests
    private callbacks: McpCommunicationCallbacks | null = null;

    public get isConnected(): boolean {
        return this.isConnectedState;
    }

    public connect(config: McpConnectionConfig, callbacks: McpCommunicationCallbacks): void {
        // 1. Disconnect any *previous* connection first
        this.disconnect(); 

        // 2. Assign the *new* set of callbacks for this connection attempt
        this.callbacks = callbacks;

        // 3. Trigger the connecting callback (must happen after assigning callbacks)
        this.callbacks.onConnecting(); // Use direct call assuming callbacks is non-null here
        this.isConnectedState = false;

        this.logger?.LogInfo('Attempting SSE connection to backend proxy...', "Service", "Comm", "Connect", "SSE");
        this.logger?.LogDebug(`Config: ${JSON.stringify(config)}`, "Service", "Comm", "Connect", "Config");

        try {
            const urlParams = new URLSearchParams({
                transport: config.transport,
                command: config.command,
                args: JSON.stringify(config.args) // Args are expected as a JSON string by the backend
            });
            const sseUrl = `${this.MCP_PROXY_PATH}?${urlParams.toString()}`;
            this.logger?.LogDebug(`SSE URL: ${sseUrl}`, "Service", "Comm", "Connect", "SSE", "URL");
            this.eventSource = new EventSource(sseUrl);

            this.eventSource.onopen = () => {
                this.logger?.LogInfo('EventSource onopen fired.', "Service", "Comm", "SSE", "Event", "Open");
                this.isConnectedState = true;
                this.logger?.LogDebug(`isConnectedState set to: ${this.isConnectedState}`, "Service", "Comm", "SSE", "State");
                this.logger?.LogDebug(`Checking callbacks object: ${this.callbacks ? 'Exists' : 'NULL or Undefined'}`, "Service", "Comm", "SSE", "CallbackCheck");
                if (this.callbacks) {
                    this.logger?.LogDebug(`Checking callbacks.onConnected function: ${typeof this.callbacks.onConnected === 'function' ? 'Is a function' : 'NOT a function'}`, "Service", "Comm", "SSE", "CallbackCheck");
                    try {
                        this.logger?.LogDebug('Attempting to call callbacks.onConnected()...', "Service", "Comm", "SSE", "Callback");
                        this.callbacks.onConnected();
                        this.logger?.LogDebug('Successfully called callbacks.onConnected().', "Service", "Comm", "SSE", "Callback");
                    } catch (e: unknown) {
                        const errorMsg = e instanceof Error ? e.message : String(e);
                        this.logger?.LogError(`Error calling callbacks.onConnected(): ${errorMsg}`, "Service", "Comm", "SSE", "Callback", "Error");
                    }
                } else {
                    this.logger?.LogError('Cannot call onConnected because callbacks object is missing!', "Service", "Comm", "SSE", "Callback", "Error", "Missing");
                }
            };

            this.eventSource.onerror = (errorEvent) => { // errorEvent is a generic Event, not very detailed
                this.logger?.LogError(`SSE connection error. State: ${this.eventSource?.readyState}`, "Service", "Comm", "SSE", "Event", "Error"); // Replaced console.error
                this.isConnectedState = false;
                const errorMessage = 'SSE connection failed. Is the backend server running? Check logs.';
                this.callbacks?.onError(errorMessage, true); // Indicate it's a connection error
                this.disconnect(); // Ensure closure on error
            };

            this.eventSource.onmessage = (event) => {
                this.logger?.LogDebug(`SSE message received: ${event.data}`, "Service", "Comm", "SSE", "Event", "Message"); // Replaced console.log (debug for raw data)
                try {
                    this.handleServerMessage(JSON.parse(event.data));
                } catch (e: any) {
                    this.logger?.LogError(`Failed to parse SSE message: ${e?.message || e}. Data: ${event.data}`, "Service", "Comm", "SSE", "Event", "Message", "ParseError"); // Replaced console.error
                    this.callbacks?.onError(`Failed to parse message from server: ${e?.message || e}`, false);
                }
            };
        } catch (e: any) {
            this.logger?.LogError(`Failed to initialize EventSource: ${e?.message || e}`, "Service", "Comm", "SSE", "InitError"); // Replaced console.error
            this.isConnectedState = false;
            this.callbacks?.onError(`Error: Could not initiate connection. Check logs. ${e?.message || e}`, true); // Connection error
            this.disconnect();
        }
    }

    public disconnect(): void {
        if (this.eventSource) {
            this.logger?.LogInfo("Closing SSE connection.", "Service", "Comm", "SSE", "Disconnect"); // Replaced console.log
            this.eventSource.close();
            this.eventSource = null;
        }
        // Don't reset isConnectedState immediately, let onDisconnected callback handle UI state
        // this.isConnectedState = false;
        // Only call onDisconnected if we were previously connected and are manually disconnecting,
        // otherwise rely on server message or onerror.
        // if (this.isConnectedState) {
        //     this.callbacks?.onDisconnected('manual');
        // }
        this.callbacks = null; // Clear callbacks on disconnect
        // Set isConnected to false *after* potentially calling disconnect callback
        this.isConnectedState = false;
    }

    public async sendRequestToBackend(type: string, payload: any): Promise<{ success: boolean; error?: string }> {
        if (!this.isConnectedState) {
            const errorMsg = 'Cannot send request: Not connected.';
            this.logger?.LogError(errorMsg, "Service", "Comm", "HTTP", "RequestError", "Preflight"); // Replaced console.error
            // Don't trigger onError here, let the UI handle the state check
            // this.callbacks?.onError(errorMsg, false);
            return { success: false, error: errorMsg };
        }
        this.logger?.LogDebug(`Sending '${type}' request to backend: ${JSON.stringify(payload)}`, "Service", "Comm", "HTTP", "Request"); // Replaced console.log (debug, stringify)
        try {
            const response = await fetch(this.MCP_PROXY_PATH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, payload }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                this.logger?.LogError(`Backend request error: ${response.status} - ${errorText}`, "Service", "Comm", "HTTP", "ResponseError"); // Replaced console.error
                const errorMsg = `Error sending '${type}' request: ${errorText || response.statusText}`;
                this.callbacks?.onError(errorMsg, false); // Report error sending
                return { success: false, error: errorMsg };
            } else {
                this.logger?.LogInfo(`'${type}' request sent successfully.`, "Service", "Comm", "HTTP", "RequestSuccess"); // Replaced console.log
                return { success: true };
            }
        } catch (error: any) {
            this.logger?.LogError(`Network error sending request: ${error.message || error}`, "Service", "Comm", "HTTP", "NetworkError"); // Replaced console.error
            const errorMsg = `Network error sending '${type}' request. Check logs. ${error.message || error}`;
            this.callbacks?.onError(errorMsg, false); // Report network error
            return { success: false, error: errorMsg };
        }
    }

    // Handles messages *from the proxy server* (including wrapped MCP messages)
    private handleServerMessage(message: any): void {
        if (!message || typeof message !== 'object' || !message.type) {
            this.logger?.LogWarning(`SSE message missing type or invalid format: ${JSON.stringify(message)}`, "Service", "Comm", "SSE", "Message", "FormatError"); // Replaced console.warn
            return;
        }
        this.logger?.LogDebug(`Handling proxy message type: ${message.type}`, "Service", "Comm", "SSE", "Message", "Handling"); // Replaced console.log

        switch (message.type) {
            case 'connectionStatus':
                this.logger?.LogDebug(`Connection status update from proxy: ${JSON.stringify(message.payload)}`, "Service", "Comm", "SSE", "Message", "StatusUpdate"); // Replaced console.log
                this.handleConnectionStatusUpdate(message.payload);
                break;
            case 'logMessage':
                if (message.payload && typeof message.payload.source === 'string' && typeof message.payload.content === 'string') {
                    this.callbacks?.onLogMessage(message.payload.source, message.payload.content);
                } else {
                     this.logger?.LogWarning(`Invalid logMessage format: ${JSON.stringify(message.payload)}`, "Service", "Comm", "SSE", "Message", "FormatError", "LogMessage"); // Replaced console.warn
                }
                break;
            case 'commandError': // Error reported from backend when trying to POST command to MCP
                if (message.payload && typeof message.payload.type === 'string' && typeof message.payload.error === 'string') {
                    this.logger?.LogError(`Backend command error for type ${message.payload.type}: ${message.payload.error}`, "Service", "Comm", "HTTP", "CommandError"); // Replaced console.error
                    const commandErrMsg = `Backend Error: Failed to send command '${message.payload.type}' to MCP process. ${message.payload.error}`;
                    this.callbacks?.onError(commandErrMsg, false); // Report command error
                } else {
                    this.logger?.LogWarning(`Invalid commandError format: ${JSON.stringify(message.payload)}`, "Service", "Comm", "SSE", "Message", "FormatError", "CommandError"); // Replaced console.warn
                }
                break;
            case 'mcpMessage': // Message is specifically identified as originating from the MCP client
                this.logger?.LogDebug(`Received wrapped MCP message`, "Service", "Comm", "SSE", "Message", "MCPMessage"); // Replaced console.log
                this.handleMcpProcessMessage(message.payload); // Handle the unwrapped payload
                break;
            default:
                this.logger?.LogWarning(`Unhandled SSE message type from proxy: ${message.type}`, "Service", "Comm", "SSE", "Message", "Unhandled"); // Replaced console.warn
        }
    }

    // Handles the 'connectionStatus' message payload from the proxy
    private handleConnectionStatusUpdate(payload: any): void {
         if (!payload || typeof payload !== 'object') {
             this.logger?.LogWarning(`Invalid connectionStatus payload: ${JSON.stringify(payload)}`, "Service", "Comm", "SSE", "Message", "StatusUpdate", "FormatError"); // Replaced console.warn
             return;
         }
         if (payload.status === 'error') {
             this.isConnectedState = false;
             const errorMsg = `Connection error: ${payload.error || 'Unknown error'}`;
             this.callbacks?.onError(errorMsg, true); // Treat as connection error
             // Close SSE connection if the error originated from the proxy/process management itself (not just stderr)
             if (payload.error && typeof payload.error === 'string' && !payload.error.startsWith('stderr:')) {
                 this.disconnect(); // Close our side
             }
        } else if (payload.status === 'connected') {
             // This might be redundant if onopen already fired, but confirms proxy sees client as connected
             if (!this.isConnectedState) { // Only trigger if we weren't already connected
                 this.isConnectedState = true;
                 this.callbacks?.onConnected();
             }
        } else if (payload.status === 'disconnected') {
             const wasConnected = this.isConnectedState;
             this.isConnectedState = false;
             // Only trigger callback if we were previously connected or connection was pending
             if (wasConnected || this.eventSource?.readyState === EventSource.CONNECTING) {
                  this.callbacks?.onDisconnected(payload.code ?? 'N/A');
             }
             // Close our SSE connection as the underlying process ended
             this.disconnect();
        } else {
             this.logger?.LogWarning(`Unknown connectionStatus status: ${payload.status}`, "Service", "Comm", "SSE", "Message", "StatusUpdate", "UnknownStatus"); // Replaced console.warn
        }
    }

    // Handles messages *from* the MCP process itself (parsed & wrapped by proxy)
    private handleMcpProcessMessage(mcpData: McpMessagePayload | any): void {
        // Validate the structure minimally before passing to callback
        if (mcpData && typeof mcpData === 'object' && (mcpData.result !== undefined || mcpData.error !== undefined || mcpData.method !== undefined)) {
            // It looks like a valid JSON-RPC message (response or notification)
            this.callbacks?.onMcpMessage(mcpData as McpMessagePayload);
        } else {
            const dataString = JSON.stringify(mcpData);
            this.logger?.LogWarning(`Received unknown data structure from MCP via proxy: ${dataString}`, "Service", "Comm", "MCP", "FormatError"); // Replaced console.warn
            // Optionally report this as a specific type of log/error
            // this.callbacks?.onError("Received malformed message from MCP client", false);
            this.callbacks?.onLogMessage('mcp_raw', `Received unknown data structure: ${dataString}`);
        }
    }
} 