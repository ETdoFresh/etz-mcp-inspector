// src/mcp-communication.ts
import { McpMessagePayload } from '../models/mcp-message-payload.model';
import { ApplicationServiceProvider } from './application-service-provider';
import { Logger } from './logger-service';

// Define the structure for connection configuration
export interface McpConnectionConfig {
    transport: string;
    command: string;
    args: string[];
    env: { [key: string]: string };
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
        if (this.eventSource && this.eventSource.readyState !== this.eventSource.CLOSED) {
            console.warn("[CommService] Attempted to connect while already connected or connecting. Closing existing connection first.");
            this.disconnect();
        }

        this.callbacks = callbacks;

        this.callbacks.onConnecting();
        this.isConnectedState = false;

        this.logger?.LogInfo((a, b) => a(b), 'Attempting SSE connection to backend proxy...', "Service", "Comm", "Connect", "SSE");
        this.logger?.LogDebug((a, b) => a(b), `Config: ${JSON.stringify(config)}`, "Service", "Comm", "Connect", "Config");

        try {
            const urlParams = new URLSearchParams({
                transport: config.transport,
                command: config.command,
                args: JSON.stringify(config.args), // Args are expected as a JSON string by the backend
                env: JSON.stringify(config.env) // Add environment variables
            });
            const sseUrl = `${this.MCP_PROXY_PATH}?${urlParams.toString()}`;
            this.logger?.LogDebug((a, b) => a(b), `SSE URL: ${sseUrl}`, "Service", "Comm", "Connect", "SSE", "URL");
            this.eventSource = new EventSource(sseUrl);

            this.eventSource.onopen = () => {
                this.logger?.LogInfo((a, b) => a(b), 'EventSource onopen fired.', "Service", "Comm", "SSE", "Event", "Open");
                this.isConnectedState = true;
                this.logger?.LogDebug((a, b) => a(b), `isConnectedState set to: ${this.isConnectedState}`, "Service", "Comm", "SSE", "State");
                this.logger?.LogDebug((a, b) => a(b), `Checking callbacks object: ${this.callbacks ? 'Exists' : 'NULL or Undefined'}`, "Service", "Comm", "SSE", "CallbackCheck");
                this.logger?.LogDebug((a, b) => a(b), `Checking callbacks.onConnected function: ${typeof this.callbacks?.onConnected === 'function' ? 'Is a function' : 'NOT a function'}`, "Service", "Comm", "SSE", "CallbackCheck");
                if (this.callbacks?.onConnected) {
                    this.logger?.LogDebug((a, b) => a(b), 'Attempting to call callbacks.onConnected()...', "Service", "Comm", "SSE", "Callback");
                    try {
                        this.callbacks.onConnected();
                        this.logger?.LogDebug((a, b) => a(b), 'Successfully called callbacks.onConnected().', "Service", "Comm", "SSE", "Callback");
                    } catch (e: unknown) {
                        const errorMsg = e instanceof Error ? e.message : String(e);
                        this.logger?.LogError((a, b) => a(b), `Error calling callbacks.onConnected(): ${errorMsg}`, "Service", "Comm", "SSE", "Callback", "Error");
                    }
                } else {
                    this.logger?.LogError((a, b) => a(b), 'Cannot call onConnected because callbacks object is missing!', "Service", "Comm", "SSE", "Callback", "Error", "Missing");
                }
            };

            this.eventSource.onerror = (errorEvent) => {
                this.logger?.LogError((a, b) => a(b), `SSE connection error. State: ${this.eventSource?.readyState}`, "Service", "Comm", "SSE", "Event", "Error");
                this.isConnectedState = false;
                const errorMessage = 'SSE connection failed. Is the backend server running? Check logs.';
                this.callbacks?.onError(errorMessage, true);
                this.disconnect();
            };

            this.eventSource.onmessage = (event) => {
                this.logger?.LogDebug((a, b) => a(b), `SSE message received: ${event.data}`, "Service", "Comm", "SSE", "Event", "Message");
                try {
                    this.handleServerMessage(JSON.parse(event.data));
                } catch (e: any) {
                    this.logger?.LogError((a, b) => a(b), `Failed to parse SSE message: ${e?.message || e}. Data: ${event.data}`, "Service", "Comm", "SSE", "Event", "Message", "ParseError");
                    this.callbacks?.onError(`Failed to parse message from server: ${e?.message || e}`, false);
                }
            };
        } catch (e: any) {
            this.logger?.LogError((a, b) => a(b), `Failed to initialize EventSource: ${e?.message || e}`, "Service", "Comm", "SSE", "InitError");
            this.isConnectedState = false;
            this.callbacks?.onError(`Error: Could not initiate connection. Check logs. ${e?.message || e}`, true);
            this.disconnect();
        }
    }

    public disconnect(): void {
        if (this.eventSource) {
            this.logger?.LogInfo((a, b) => a(b), "Closing SSE connection.", "Service", "Comm", "SSE", "Disconnect");
            this.eventSource.close();
            this.eventSource = null;
        }
        this.callbacks = null;
        this.isConnectedState = false;
    }

    public async sendRequestToBackend(type: string, payload: any): Promise<{ success: boolean; error?: string }> {
        if (!this.isConnectedState) {
            const errorMsg = 'Cannot send request: Not connected.';
            this.logger?.LogError((a, b) => a(b), errorMsg, "Service", "Comm", "HTTP", "RequestError", "Preflight");
            return { success: false, error: errorMsg };
        }
        this.logger?.LogDebug((a, b) => a(b), `Sending '${type}' request to backend: ${JSON.stringify(payload)}`, "Service", "Comm", "HTTP", "Request");
        try {
            const response = await fetch(this.MCP_PROXY_PATH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, payload }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                this.logger?.LogError((a, b) => a(b), `Backend request error: ${response.status} - ${errorText}`, "Service", "Comm", "HTTP", "ResponseError");
                const errorMsg = `Error sending '${type}' request: ${errorText || response.statusText}`;
                this.callbacks?.onError(errorMsg, false);
                return { success: false, error: errorMsg };
            } else {
                this.logger?.LogInfo((a, b) => a(b), `'${type}' request sent successfully.`, "Service", "Comm", "HTTP", "RequestSuccess");
                return { success: true };
            }
        } catch (error: any) {
            this.logger?.LogError((a, b) => a(b), `Network error sending request: ${error.message || error}`, "Service", "Comm", "HTTP", "NetworkError");
            const errorMsg = `Network error sending '${type}' request. Check logs. ${error.message || error}`;
            this.callbacks?.onError(errorMsg, false);
            return { success: false, error: errorMsg };
        }
    }

    private handleServerMessage(message: any): void {
        if (!message || typeof message !== 'object' || !message.type) {
            this.logger?.LogWarning((a, b) => a(b), `SSE message missing type or invalid format: ${JSON.stringify(message)}`, "Service", "Comm", "SSE", "Message", "FormatError");
            return;
        }
        this.logger?.LogDebug((a, b) => a(b), `Handling proxy message type: ${message.type}`, "Service", "Comm", "SSE", "Message", "Handling");

        switch (message.type) {
            case 'connectionStatus':
                this.logger?.LogDebug((a, b) => a(b), `Connection status update from proxy: ${JSON.stringify(message.payload)}`, "Service", "Comm", "SSE", "Message", "StatusUpdate");
                this.handleConnectionStatusUpdate(message.payload);
                break;
            case 'logMessage':
                if (message.payload && typeof message.payload.source === 'string' && typeof message.payload.content === 'string') {
                    this.callbacks?.onLogMessage(message.payload.source, message.payload.content);
                } else {
                     this.logger?.LogWarning((a, b) => a(b), `Invalid logMessage format: ${JSON.stringify(message.payload)}`, "Service", "Comm", "SSE", "Message", "FormatError", "LogMessage");
                }
                break;
            case 'commandError':
                if (message.payload && typeof message.payload.type === 'string' && typeof message.payload.error === 'string') {
                    this.logger?.LogError((a, b) => a(b), `Backend command error for type ${message.payload.type}: ${message.payload.error}`, "Service", "Comm", "HTTP", "CommandError");
                    const commandErrMsg = `Backend Error: Failed to send command '${message.payload.type}' to MCP process. ${message.payload.error}`;
                    this.callbacks?.onError(commandErrMsg, false);
                } else {
                    this.logger?.LogWarning((a, b) => a(b), `Invalid commandError format: ${JSON.stringify(message.payload)}`, "Service", "Comm", "SSE", "Message", "FormatError", "CommandError");
                }
                break;
            case 'mcpMessage':
                this.logger?.LogDebug((a, b) => a(b), `Received wrapped MCP message`, "Service", "Comm", "SSE", "Message", "MCPMessage");
                this.handleMcpProcessMessage(message.payload);
                break;
            default:
                this.logger?.LogWarning((a, b) => a(b), `Unhandled SSE message type from proxy: ${message.type}`, "Service", "Comm", "SSE", "Message", "Unhandled");
        }
    }

    private handleConnectionStatusUpdate(payload: any): void {
         if (!payload || typeof payload !== 'object') {
             this.logger?.LogWarning((a, b) => a(b), `Invalid connectionStatus payload: ${JSON.stringify(payload)}`, "Service", "Comm", "SSE", "Message", "StatusUpdate", "FormatError");
             return;
         }
         if (payload.status === 'error') {
             this.isConnectedState = false;
             const errorMsg = `Connection error: ${payload.error || 'Unknown error'}`;
             this.callbacks?.onError(errorMsg, true);
             if (payload.error && typeof payload.error === 'string' && !payload.error.startsWith('stderr:')) {
                 this.disconnect();
             }
        } else if (payload.status === 'connected') {
             if (!this.isConnectedState) {
                 this.isConnectedState = true;
                 this.callbacks?.onConnected();
             }
        } else if (payload.status === 'disconnected') {
             const wasConnected = this.isConnectedState;
             this.isConnectedState = false;
             if (wasConnected || this.eventSource?.readyState === EventSource.CONNECTING) {
                  this.callbacks?.onDisconnected(payload.code ?? 'N/A');
             }
             this.disconnect();
        } else {
             this.logger?.LogWarning((a, b) => a(b), `Unknown connectionStatus status: ${payload.status}`, "Service", "Comm", "SSE", "Message", "StatusUpdate", "UnknownStatus");
        }
    }

    private handleMcpProcessMessage(mcpData: McpMessagePayload | any): void {
        if (mcpData && typeof mcpData === 'object' && (mcpData.result !== undefined || mcpData.error !== undefined || mcpData.method !== undefined)) {
            this.callbacks?.onMcpMessage(mcpData as McpMessagePayload);
        } else {
            const dataString = JSON.stringify(mcpData);
            this.logger?.LogWarning((a, b) => a(b), `Received unknown data structure from MCP via proxy: ${dataString}`, "Service", "Comm", "MCP", "FormatError");
            this.callbacks?.onLogMessage('mcp_raw', `Received unknown data structure: ${dataString}`);
        }
    }
} 