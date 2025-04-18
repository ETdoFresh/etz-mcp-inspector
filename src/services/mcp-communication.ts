// src/mcp-communication.ts
import { McpMessagePayload } from '../models/mcp-message-payload.model.js';
import { ApplicationServiceProvider } from './application-service-provider.js';
import { Logger } from './logger-service.js';

// Define the structure for connection configuration
export interface McpConnectionConfig {
    transport: string;
    command: string;
    args: string[];
    env: { [key: string]: string };
}

// Define the structure for callbacks that the communicator will use to signal events
export interface McpCommunicationCallbacks {
    onConnected(): void;
    onDisconnected(code?: number): void;
    onMcpMessage(message: McpMessagePayload): void;
    onCommandError(type: string, error: string): void;
}

export class McpCommunicationService {
    private eventSource: EventSource | null = null;
    private callbacks: McpCommunicationCallbacks | null = null;
    private isConnected: boolean = false;
    private isInitialized: boolean = false;
    private pendingRequests: { type: string; payload: any; id?: string | number }[] = [];
    private logger: Logger | undefined = ApplicationServiceProvider.getService(Logger);
    private clientId: string | null = null;

    public connect(config: McpConnectionConfig, callbacks: McpCommunicationCallbacks): void {
        this.callbacks = callbacks;
        this.isConnected = false;
        this.isInitialized = false;
        this.pendingRequests = [];
        this.clientId = null;

        // Build the SSE URL with query parameters
        const params = new URLSearchParams({
            transport: config.transport,
            command: config.command,
            args: JSON.stringify(config.args),
            env: JSON.stringify(config.env)
        });

        const url = `/mcp-proxy/sse?${params.toString()}`;
        this.logger?.LogInfo((a, b) => a(b), `SSE URL: ${url}`, "Service", "Comm", "Connect", "SSE", "URL");

        // Create new EventSource
        this.eventSource = new EventSource(url);

        this.eventSource.onopen = () => {
            this.logger?.LogInfo((a, b) => a(b), "EventSource onopen fired.", "Service", "Comm", "SSE", "Event", "Open");
            this.isConnected = true;
            this.logger?.LogInfo((a, b) => a(b), "isConnectedState set to: true", "Service", "Comm", "SSE", "State");
            
            this.isInitialized = true;
            this.logger?.LogInfo((a, b) => a(b), "isInitialized set to: true (onopen)", "Service", "Comm", "SSE", "State");
            this.processPendingRequests();
            
            // Check callbacks exist before calling
            this.logger?.LogInfo((a, b) => a(b), "Checking callbacks object: " + (this.callbacks ? "Exists" : "Does not exist"), "Service", "Comm", "SSE", "CallbackCheck");
            if (this.callbacks) {
                this.logger?.LogInfo((a, b) => a(b), "Checking callbacks.onConnected function: " + (typeof this.callbacks.onConnected === 'function' ? "Is a function" : "Not a function"), "Service", "Comm", "SSE", "CallbackCheck");
                if (typeof this.callbacks.onConnected === 'function') {
                    this.logger?.LogInfo((a, b) => a(b), "Attempting to call callbacks.onConnected()...", "Service", "Comm", "SSE", "Callback");
                    try {
                        this.callbacks.onConnected();
                        this.logger?.LogInfo((a, b) => a(b), "Successfully called callbacks.onConnected().", "Service", "Comm", "SSE", "Callback");
                    } catch (error: any) {
                        this.logger?.LogError((a, b) => a(b), `Error in callbacks.onConnected(): ${error.message || error}`, "Service", "Comm", "SSE", "Callback", "Error");
                    }
                }
            }
        };

        this.eventSource.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.logger?.LogInfo((a, b) => a(b), `SSE message received: ${event.data}`, "Service", "Comm", "SSE", "Event", "Message");

                if (message.type === 'clientIdAssigned' && message.payload?.clientId) {
                    this.clientId = message.payload.clientId;
                    this.logger?.LogInfo((a, b) => a(b), `Client ID assigned by server: ${this.clientId}`, "Service", "Comm", "SSE", "Message", "ClientId");
                }
                // Handle connection status updates
                else if (message.type === 'connectionStatus') {
                    this.logger?.LogInfo((a, b) => a(b), `Connection status update from proxy: ${JSON.stringify(message.payload)}`, "Service", "Comm", "SSE", "Message", "StatusUpdate");
                    
                    if (message.payload.status === 'connected') {
                        this.isConnected = true;
                        // Don't set initialized here - wait for the actual initialization message
                    } else if (message.payload.status === 'disconnected') {
                        this.isConnected = false;
                        this.isInitialized = false;
                        if (this.callbacks) {
                            this.callbacks.onDisconnected(message.payload.code);
                        }
                    }
                }
                // Handle MCP messages
                else if (message.type === 'mcpMessage') {
                    const payload = message.payload;
                    
                    // Check for initialization message in all supported formats
                    if (
                        // JSON-RPC 2.0 format
                        (typeof payload === 'object' && 'jsonrpc' in payload && 
                            (('result' in payload && payload.result && typeof payload.result === 'object' && 'capabilities' in payload.result) ||
                             ('method' in payload && (payload.method === 'initialize' || payload.method === 'initialized')))
                        ) ||
                        // Legacy formats
                        (typeof payload === 'object' && 'type' in payload && payload.type === 'initialized') ||
                        (typeof payload === 'object' && 'result' in payload && payload.result === 'initialized')
                    ) {
                        this.logger?.LogInfo((a, b) => a(b), `Received server initialization message: ${JSON.stringify(payload)}`, "Service", "Comm", "SSE", "Message", "Initialization");
                        this.isInitialized = true;
                        this.processPendingRequests();
                    }
                    
                    if (this.callbacks) {
                        this.callbacks.onMcpMessage(payload);
                    }
                }
                // Handle command errors
                else if (message.type === 'commandError') {
                    if (this.callbacks) {
                        this.callbacks.onCommandError(message.payload.type, message.payload.error);
                    }
                }
                // Handle log messages
                else if (message.type === 'logMessage') {
                    // Log messages are handled by the proxy handler
                    console.log(`[${message.payload.source}] ${message.payload.content}`);
                }
            } catch (error) {
                this.logger?.LogError((a, b) => a(b), `Error processing SSE message: ${error}`, "Service", "Comm", "SSE", "Message", "Error");
            }
        };

        this.eventSource.onerror = (error) => {
            this.logger?.LogError((a, b) => a(b), `SSE connection error: ${error}`, "Service", "Comm", "SSE", "Error");
            this.isConnected = false;
            this.isInitialized = false;
            if (this.callbacks) {
                this.callbacks.onDisconnected();
            }
        };
    }

    public disconnect(): void {
        if (this.eventSource) {
            this.logger?.LogInfo((a, b) => a(b), "Closing SSE connection.", "Service", "Comm", "SSE", "Disconnect");
            this.eventSource.close();
            this.eventSource = null;
        }
        this.isConnected = false;
        this.isInitialized = false;
        this.pendingRequests = [];
    }

    public sendRequest(type: string, payload: any, id?: string | number): void {
        if (!this.isConnected || !this.isInitialized) {
            this.logger?.LogInfo((a, b) => a(b), `Request queued (not connected or not initialized): ${type}`, "Service", "Comm", "HTTP", "Request");
            this.pendingRequests.push({ type, payload, id });
            return;
        }

        this.logger?.LogInfo((a, b) => a(b), `Sending '${type}' request to backend: ${JSON.stringify(payload)}`, "Service", "Comm", "HTTP", "Request");
        this.sendRequestToBackend(type, payload, id);
    }

    private processPendingRequests(): void {
        while (this.pendingRequests.length > 0) {
            const request = this.pendingRequests.shift();
            if (request) {
                this.sendRequestToBackend(request.type, request.payload, request.id);
            }
        }
    }

    private sendRequestToBackend(type: string, payload: any, id?: string | number): void {
        // For JSON-RPC requests, send the payload directly
        const isJsonRpc = payload && typeof payload === 'object' && 'jsonrpc' in payload;
        // The backend expects the raw JSON-RPC message as the body
        const requestBody = isJsonRpc ? payload : { jsonrpc: "2.0", method: type, params: payload, id: id || `req-${Date.now()}` };

        // Use the correct endpoint: /mcp-proxy/message
        // Also include the clientId as a query parameter as expected by the server
        const clientId = this.getClientIdFromTransport();
        if (!clientId) {
             this.logger?.LogError((a, b) => a(b), `Cannot send request - Client ID not yet received from server.`, "Service", "Comm", "HTTP", "RequestError");
            if (this.callbacks) {
                this.callbacks.onCommandError(type, "Cannot send request: Client ID not yet assigned by proxy.");
            }
            return;
        }
        
        const postUrl = `/mcp-proxy/message?clientId=${encodeURIComponent(clientId)}`;

        this.logger?.LogInfo((a, b) => a(b), `POSTing to ${postUrl} with body: ${JSON.stringify(requestBody)}`, "Service", "Comm", "HTTP", "Request");

        fetch(postUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        })
        .then(response => {
            if (!response.ok) {
                // Attempt to read error message from response body
                response.text().then(text => {
                     throw new Error(`HTTP error! status: ${response.status} - ${text || 'No response body'}`);
                 }).catch(() => {
                     // Fallback if reading text fails
                    throw new Error(`HTTP error! status: ${response.status}`);
                 });
            }
             // Read response text even for success, might contain useful info
            return response.text(); 
        })
        .then(responseText => {
            this.logger?.LogInfo((a, b) => a(b), `Request to ${postUrl} successful. Response: ${responseText}`, "Service", "Comm", "HTTP", "RequestSuccess");
            // Note: The actual MCP response comes via SSE, not this POST response.
            // The POST response is just an acknowledgement.
        })
        .catch(error => {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.logger?.LogError((a, b) => a(b), `Error sending request to ${postUrl}: ${errorMsg}`, "Service", "Comm", "HTTP", "RequestError");
            if (this.callbacks) {
                // Pass the more detailed error message back
                this.callbacks.onCommandError(type, errorMsg);
            }
        });
    }

     // Helper function to get the stored clientId
     private getClientIdFromTransport(): string | null {
         // Return the stored clientId property
         return this.clientId;
     }
} 