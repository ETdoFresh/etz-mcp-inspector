// src/controllers/mcp.controller.ts
import { McpUIView } from '../views/mcp-ui';
import { McpCommunicationService, McpCommunicationCallbacks, McpConnectionConfig } from '../services/mcp-communication';
import { McpMessagePayload } from '../models/mcp-message-payload.model'; // Needed for onMcpMessage
import { UIToolDefinition } from '../models/tool-definition.model'; // Needed for renderToolList

// Define the structure for callbacks the UI needs to trigger actions
export interface McpUIActions {
    onAddArgument: () => void;
    onTestConnection: (args: string[]) => void; // Passes current args
    onListTools: () => void;
    onExecuteTool: (params: { [key: string]: any }) => void;
    onToolSelected: (toolIndex: number) => void; // To notify the orchestrator
    onArgumentInputChange: () => string[]; // Callback to get current args for saving
}

export class McpController implements McpUIActions, McpCommunicationCallbacks {
    private view: McpUIView;
    private communicationService: McpCommunicationService;
    // State to track the type of request pending a response
    private pendingRequestType: 'listTools' | 'executeTool' | null = null;
    
    // Add state to store selected tool if needed
    // private selectedTool: UIToolDefinition | null = null;

    constructor() {
        this.view = new McpUIView();
        this.communicationService = new McpCommunicationService();

        // Register the controller's methods as actions for the view
        this.view.registerActions(this);

        // Initialize the view state
        this.view.setInitialState();
        // Potentially load saved config and render args here?
        this.loadAndApplyConfig();

        console.log("McpController initialized.");
    }

    // --- Implementation of McpUIActions ---

    onAddArgument(): void {
        console.log("[Controller] onAddArgument triggered");
        // This might trigger saving config if needed
        this.saveConfig(); 
    }

    onTestConnection(args: string[]): void {
        console.log("[Controller] onTestConnection triggered with args:", args);
        this.view.showConnecting();
        
        // Get current config from view
        const config: McpConnectionConfig = {
            transport: this.view.getTransport(),
            command: this.view.getCommand(),
            args: args // Use args passed from view event
        };

        // Save config before attempting connection
        this.saveConfig(config);

        // Reset pending request state before connecting
        this.pendingRequestType = null;
        // Connect using the service, passing this controller as the callback handler
        this.communicationService.connect(config, this);
    }

    onListTools(): void {
        console.log("[Controller] onListTools triggered");
        if (!this.communicationService.isConnected) {
            this.view.showToolListError("Cannot list tools: Not connected.");
            return;
        }
        this.view.showFetchingTools();
        // Set pending request type
        this.pendingRequestType = 'listTools';
        // Send request via service - Use correct method name 'tools/list'
        // The proxy will add an ID
        this.communicationService.sendRequestToBackend('tools/list', {});
        console.log(`[Controller] Sent tools/list request`);
        // Result will be handled by onMcpMessage callback
    }

    onExecuteTool(params: { [key: string]: any }): void {
        console.log("[Controller] onExecuteTool triggered with params:", params);
        if (!this.communicationService.isConnected) {
            this.view.displayToolResult({ status: 'error', message: "Cannot execute tool: Not connected." });
            return;
        }
        
        const selectedToolName = this.view.getSelectedToolName();
        if (!selectedToolName) {
            this.view.displayToolResult({ status: 'error', message: "Cannot execute: No tool selected or name unavailable." });
            return;
        }

        this.view.showExecutingTool();
        // Set pending request type
        this.pendingRequestType = 'executeTool';
        // Send request via service - Use correct method name 'tools/call'
        // The proxy will add an ID
        this.communicationService.sendRequestToBackend('tools/call', { 
            name: selectedToolName, // Older code used 'name' and 'arguments'
            arguments: params 
        });
        console.log(`[Controller] Sent tools/call request for ${selectedToolName}`);
        // Result will be handled by onMcpMessage callback
    }

    onToolSelected(toolIndex: number): void {
        console.log(`[Controller] onToolSelected triggered with index: ${toolIndex}`);
        // Logic is currently handled by the View to display the form.
        // Controller could store the selected tool definition if needed for execution.
        // this.selectedTool = this.view.getToolDefinitionByIndex(toolIndex); // Example if needed
    }

    onArgumentInputChange(): string[] {
        console.log("[Controller] onArgumentInputChange triggered");
        const currentArgs = this.view.getAllArguments();
        // Trigger saving config whenever args change
        this.saveConfig(); 
        console.log("[Controller] Current args from view:", currentArgs);
        return currentArgs;
    }

    // --- Implementation of McpCommunicationCallbacks ---

    onConnecting(): void {
        console.log("[Controller] Service is connecting...");
        this.view.showConnecting();
    }

    onConnected(): void {
        console.log("[Controller] Service connected.");
        this.view.showConnected(true);
    }

    onDisconnected(code?: number | string): void {
        console.log(`[Controller] Service disconnected. Code: ${code}`);
        this.pendingRequestType = null; // Reset pending request on disconnect
        this.view.showConnected(false); // Update status indicator
        this.view.showError(`Disconnected (Code: ${code})`, false); // Show message, not necessarily a connection error
    }

    onError(error: string, isConnectionError: boolean): void {
        console.error(`[Controller] Service Error: ${error}. Is connection error: ${isConnectionError}`);
        this.pendingRequestType = null; // Reset pending request on error
        this.view.showError(error, isConnectionError);
    }

    onMcpMessage(payload: McpMessagePayload): void {
        console.log("[Controller] Received MCP message:", payload);

        // Check if it's a response (has an ID)
        if (payload.id) {
            // Check the pending request type to determine how to handle the response
            switch (this.pendingRequestType) {
                case 'listTools':
                    console.log(`[Controller] Handling response for pending request: ${this.pendingRequestType} (ID: ${payload.id})`);
                    if (payload.result && payload.result.tools && Array.isArray(payload.result.tools)) {
                        this.view.renderToolList(payload.result.tools as UIToolDefinition[]); 
                    } else if (payload.error) {
                        this.view.showToolListError(`Error listing tools: ${payload.error.message} (Code: ${payload.error.code})`);
                    } else {
                        this.view.showToolListError('Received invalid response format for listTools.');
                    }
                    this.pendingRequestType = null; // Reset pending type
                    break;

                case 'executeTool':
                    console.log(`[Controller] Handling response for pending request: ${this.pendingRequestType} (ID: ${payload.id})`);
                     if (payload.result !== undefined) { 
                         this.view.displayToolResult({ status: 'success', data: payload.result });
                     } else if (payload.error) {
                         this.view.displayToolResult({ status: 'error', message: payload.error.message, details: payload.error.data });
                     } else {
                         this.view.displayToolResult({ status: 'error', message: 'Received invalid response format for executeTool.' });
                     }
                    this.pendingRequestType = null; // Reset pending type
                    break;

                default:
                    console.warn(`[Controller] Received response with ID ${payload.id} but no matching pending request type (${this.pendingRequestType})`, payload);
                    // Handle unexpected response? Maybe show a generic error?
                    break;
            }
        } 
        // --- Handle Notifications (No ID) ---
        else if (payload.method) { 
             if (payload.method === 'logMessage') { 
                 if (payload.params && typeof payload.params.message === 'string') {
                     console.log(`[MCP Log] ${payload.params.level || 'info'}: ${payload.params.message}`);
                     // this.view.addLogMessage(...) // Example
                 }
            } else {
                console.warn("[Controller] Unhandled MCP notification method:", payload.method, payload.params);
            }
        } 
        // --- Handle Unexpected Data --- 
        else {
            console.warn("[Controller] Received unexpected data structure from MCP:", payload);
        }
    }

    onLogMessage(source: string, content: string): void {
        console.log(`[Controller] Log from ${source}: ${content}`);
        // TODO: Decide how/if to display proxy/service logs in the UI
        // this.view.addLogMessage(`${source}: ${content}`); // Example
    }

    // --- Helper Methods ---
    private saveConfig(config?: McpConnectionConfig): void {
        console.log("[Controller] Attempting to save config...");
        try {
            const transport = config?.transport ?? this.view.getTransport();
            const command = config?.command ?? this.view.getCommand();
            const args = config?.args ?? this.view.getAllArguments();
            
            localStorage.setItem('mcpConfig', JSON.stringify({ transport, command, args }));
            console.log("Config saved:", { transport, command, args });
        } catch (e) {
            console.error("[Controller] Failed to save config to localStorage:", e);
        }
    }

    private loadAndApplyConfig(): void {
        console.log("[Controller] Attempting to load config...");
        try {
            const savedConfig = localStorage.getItem('mcpConfig');
            if (savedConfig) {
                const config = JSON.parse(savedConfig);
                if (config && typeof config === 'object') {
                    this.view.setTransport(config.transport || 'tcp'); // Provide default
                    this.view.setCommand(config.command || '');
                    this.view.renderArgumentInputs(config.args || []);
                    console.log("Config loaded and applied:", config);
                } else {
                    console.log("No valid saved config found.");
                }
            }
        } catch (e) {
            console.error("[Controller] Failed to load or apply config from localStorage:", e);
        }
    }
} 