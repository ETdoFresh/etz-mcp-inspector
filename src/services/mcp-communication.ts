// src/mcp-communication.ts
import { McpMessagePayload } from '../models/mcp-message-payload.model';

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

        console.log('Attempting SSE connection to backend proxy...');
        console.log('Config:', config);

        try {
            const urlParams = new URLSearchParams({
                transport: config.transport,
                command: config.command,
                args: JSON.stringify(config.args) // Args are expected as a JSON string by the backend
            });
            const sseUrl = `${this.MCP_PROXY_PATH}?${urlParams.toString()}`;
            console.log('SSE URL:', sseUrl);
            this.eventSource = new EventSource(sseUrl);

            this.eventSource.onopen = () => {
                console.log('[Comm] EventSource onopen fired.');
                this.isConnectedState = true;
                console.log(`[Comm] isConnectedState set to: ${this.isConnectedState}`);
                console.log(`[Comm] Checking callbacks object: ${this.callbacks ? 'Exists' : 'NULL or Undefined'}`);
                if (this.callbacks) {
                    console.log(`[Comm] Checking callbacks.onConnected function: ${typeof this.callbacks.onConnected === 'function' ? 'Is a function' : 'NOT a function'}`);
                    try {
                        console.log('[Comm] Attempting to call callbacks.onConnected()...');
                        this.callbacks.onConnected();
                        console.log('[Comm] Successfully called callbacks.onConnected().');
                    } catch (e) {
                        console.error('[Comm] Error calling callbacks.onConnected():', e);
                    }
                } else {
                    console.error('[Comm] Cannot call onConnected because callbacks object is missing!');
                }
            };

            this.eventSource.onerror = (error) => {
                console.error('SSE connection error:', error);
                this.isConnectedState = false;
                const errorMessage = 'SSE connection failed. Is the backend server running? Check console.';
                this.callbacks?.onError(errorMessage, true); // Indicate it's a connection error
                this.disconnect(); // Ensure closure on error
            };

            this.eventSource.onmessage = (event) => {
                console.log('SSE message received:', event.data);
                try {
                    this.handleServerMessage(JSON.parse(event.data));
                } catch (e: any) {
                    console.error('Failed to parse SSE message:', e, 'Data:', event.data);
                    this.callbacks?.onError(`Failed to parse message from server: ${e?.message || e}`, false);
                }
            };
        } catch (e: any) {
            console.error('Failed to initialize EventSource:', e);
            this.isConnectedState = false;
            this.callbacks?.onError(`Error: Could not initiate connection. Check console. ${e?.message || e}`, true); // Connection error
            this.disconnect();
        }
    }

    public disconnect(): void {
        if (this.eventSource) {
            console.log("Closing SSE connection.");
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
            console.error(errorMsg);
            // Don't trigger onError here, let the UI handle the state check
            // this.callbacks?.onError(errorMsg, false);
            return { success: false, error: errorMsg };
        }
        console.log(`Sending '${type}' request to backend:`, payload);
        try {
            const response = await fetch(this.MCP_PROXY_PATH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, payload }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Backend request error: ${response.status}`, errorText);
                const errorMsg = `Error sending '${type}' request: ${errorText || response.statusText}`;
                this.callbacks?.onError(errorMsg, false); // Report error sending
                return { success: false, error: errorMsg };
            } else {
                console.log(`'${type}' request sent successfully.`);
                return { success: true };
            }
        } catch (error: any) {
            console.error('Network error sending request:', error);
            const errorMsg = `Network error sending '${type}' request. Check console. ${error.message || error}`;
            this.callbacks?.onError(errorMsg, false); // Report network error
            return { success: false, error: errorMsg };
        }
    }

    // Handles messages *from the proxy server* (including wrapped MCP messages)
    private handleServerMessage(message: any): void {
        if (!message || typeof message !== 'object' || !message.type) {
            console.warn('SSE message missing type or invalid format:', message);
            return;
        }
        console.log(`Handling proxy message type: ${message.type}`, message.payload);

        switch (message.type) {
            case 'connectionStatus':
                console.log('Connection status update from proxy:', message.payload);
                this.handleConnectionStatusUpdate(message.payload);
                break;
            case 'logMessage':
                if (message.payload && typeof message.payload.source === 'string' && typeof message.payload.content === 'string') {
                    this.callbacks?.onLogMessage(message.payload.source, message.payload.content);
                } else {
                     console.warn('Invalid logMessage format:', message.payload);
                }
                break;
            case 'commandError': // Error reported from backend when trying to POST command to MCP
                if (message.payload && typeof message.payload.type === 'string' && typeof message.payload.error === 'string') {
                    console.error(`Backend command error for type ${message.payload.type}:`, message.payload.error);
                    const commandErrMsg = `Backend Error: Failed to send command '${message.payload.type}' to MCP process. ${message.payload.error}`;
                    this.callbacks?.onError(commandErrMsg, false); // Report command error
                } else {
                    console.warn('Invalid commandError format:', message.payload);
                }
                break;
            case 'mcpMessage': // Message is specifically identified as originating from the MCP client
                console.log('Received wrapped MCP message:', message.payload);
                this.handleMcpProcessMessage(message.payload); // Handle the unwrapped payload
                break;
            default:
                console.warn('Unhandled SSE message type from proxy:', message.type);
        }
    }

    // Handles the 'connectionStatus' message payload from the proxy
    private handleConnectionStatusUpdate(payload: any): void {
         if (!payload || typeof payload !== 'object') {
             console.warn("Invalid connectionStatus payload:", payload);
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
             console.warn("Unknown connectionStatus status:", payload.status);
        }
    }

    // Handles messages *from* the MCP process itself (parsed & wrapped by proxy)
    private handleMcpProcessMessage(mcpData: McpMessagePayload | any): void {
        // Validate the structure minimally before passing to callback
        if (mcpData && typeof mcpData === 'object' && (mcpData.result !== undefined || mcpData.error !== undefined || mcpData.method !== undefined)) {
            // It looks like a valid JSON-RPC message (response or notification)
            this.callbacks?.onMcpMessage(mcpData as McpMessagePayload);
        } else {
            console.warn('Received unknown data structure from MCP via proxy:', mcpData);
            // Optionally report this as a specific type of log/error
            // this.callbacks?.onError("Received malformed message from MCP client", false);
            this.callbacks?.onLogMessage('mcp_raw', `Received unknown data structure: ${JSON.stringify(mcpData)}`);
        }
    }
} 