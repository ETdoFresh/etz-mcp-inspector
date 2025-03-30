// src/controllers/mcp.controller.ts
import { McpUIView } from '../views/mcp-ui';
import { McpCommunicationService, McpCommunicationCallbacks, McpConnectionConfig } from '../services/mcp-communication';
import { McpMessagePayload } from '../models/mcp-message-payload.model'; // Needed for onMcpMessage
import { UIToolDefinition } from '../models/tool-definition.model'; // Needed for renderToolList
import { ApplicationServiceProvider } from '../services/application-service-provider'; // Added
import { Logger } from '../services/logger-service'; // Added

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
    private logger: Logger | undefined = ApplicationServiceProvider.getService(Logger); // Added
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

        this.logger?.LogInfo("McpController initialized.", "Controller", "Initialization"); // Replaced console.log
    }

    // --- Implementation of McpUIActions ---

    onAddArgument(): void {
        this.logger?.LogDebug("onAddArgument triggered", "Controller", "Action", "UIEvent"); // Replaced console.log
        // This might trigger saving config if needed
        this.saveConfig(); 
    }

    onTestConnection(args: string[]): void {
        this.logger?.LogInfo(`onTestConnection triggered with ${args.length} args`, "Controller", "Action", "UIEvent"); // Replaced console.log
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
        this.logger?.LogInfo("onListTools triggered", "Controller", "Action", "UIEvent"); // Replaced console.log
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
        this.logger?.LogDebug(`Sent tools/list request`, "Controller", "Action", "MCPRequest"); // Replaced console.log
        // Result will be handled by onMcpMessage callback
    }

    onExecuteTool(params: { [key: string]: any }): void {
        this.logger?.LogInfo(`onExecuteTool triggered`, "Controller", "Action", "UIEvent", "ToolExecution"); // Replaced console.log
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
        this.logger?.LogDebug(`Sent tools/call request for ${selectedToolName}`, "Controller", "Action", "MCPRequest", "ToolExecution"); // Replaced console.log
        // Result will be handled by onMcpMessage callback
    }

    onToolSelected(toolIndex: number): void {
        this.logger?.LogDebug(`onToolSelected triggered with index: ${toolIndex}`, "Controller", "Action", "UIEvent", "ToolSelection"); // Replaced console.log
        // Logic is currently handled by the View to display the form.
        // Controller could store the selected tool definition if needed for execution.
        // this.selectedTool = this.view.getToolDefinitionByIndex(toolIndex); // Example if needed
    }

    onArgumentInputChange(): string[] {
        this.logger?.LogDebug("onArgumentInputChange triggered", "Controller", "Action", "UIEvent"); // Replaced console.log
        const currentArgs = this.view.getAllArguments();
        // Trigger saving config whenever args change
        this.saveConfig(); 
        this.logger?.LogDebug(`Current args from view: ${JSON.stringify(currentArgs)}`, "Controller", "State", "UIEvent"); // Replaced console.log
        return currentArgs;
    }

    // --- Implementation of McpCommunicationCallbacks ---

    onConnecting(): void {
        this.logger?.LogInfo("Service is connecting...", "Controller", "Callback", "CommunicationState"); // Replaced console.log
        this.view.showConnecting();
    }

    onConnected(): void {
        this.logger?.LogInfo("Service connected.", "Controller", "Callback", "CommunicationState"); // Replaced console.log
        this.view.showConnected(true);
    }

    onDisconnected(code?: number | string): void {
        this.logger?.LogInfo(`Service disconnected. Code: ${code ?? 'N/A'}`, "Controller", "Callback", "CommunicationState"); // Replaced console.log
        this.pendingRequestType = null; // Reset pending request on disconnect
        this.view.showConnected(false); // Update status indicator
        this.view.showError(`Disconnected (Code: ${code})`, false); // Show message, not necessarily a connection error
    }

    onError(error: string, isConnectionError: boolean): void {
        this.logger?.LogError(`Service Error: ${error}. Is connection error: ${isConnectionError}`, "Controller", "Callback", "CommunicationError"); // Replaced console.error
        this.pendingRequestType = null; // Reset pending request on error
        this.view.showError(error, isConnectionError);
    }

    onMcpMessage(payload: McpMessagePayload): void {
        this.logger?.LogDebug(`Received MCP message`, "Controller", "Callback", "MCPMessage"); // Replaced console.log

        // Check if it's a response (has an ID)
        if (payload.id) {
            // Check the pending request type to determine how to handle the response
            switch (this.pendingRequestType) {
                case 'listTools':
                    this.logger?.LogDebug(`Handling response for pending request: ${this.pendingRequestType} (ID: ${payload.id})`, "Controller", "Callback", "MCPMessage", "ResponseHandling"); // Replaced console.log
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
                    this.logger?.LogDebug(`Handling response for pending request: ${this.pendingRequestType} (ID: ${payload.id})`, "Controller", "Callback", "MCPMessage", "ResponseHandling"); // Replaced console.log
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
                    this.logger?.LogWarning(`Received response with ID ${payload.id} but no matching pending request type (${this.pendingRequestType})`, "Controller", "Callback", "MCPMessage", "ResponseHandling", "Unexpected"); // Replaced console.warn
                    // Handle unexpected response? Maybe show a generic error?
                    break;
            }
        } 
        // --- Handle Notifications (No ID) ---
        else if (payload.method) { 
             if (payload.method === 'logMessage') { 
                 if (payload.params && typeof payload.params.message === 'string') {
                     const level = payload.params.level || 'info';
                     this.logger?.LogInfo(`[MCP Log/${level.toUpperCase()}]: ${payload.params.message}`, "Controller", "Callback", "MCPMessage", "Notification", "MCPLog"); // Replaced console.log
                     // this.view.addLogMessage(...) // Example
                 }
            } else {
                this.logger?.LogWarning(`Unhandled MCP notification method: ${payload.method}`, "Controller", "Callback", "MCPMessage", "Notification", "Unhandled"); // Replaced console.warn
            }
        } 
        // --- Handle Unexpected Data --- 
        else {
            this.logger?.LogWarning(`Received unexpected data structure from MCP`, "Controller", "Callback", "MCPMessage", "Unexpected"); // Replaced console.warn
        }
    }

    onLogMessage(source: string, content: string): void {
        this.logger?.LogInfo(`Log from service [${source}]: ${content}`, "Controller", "Callback", "ServiceLog"); // Replaced console.log
        // TODO: Decide how/if to display proxy/service logs in the UI
        // this.view.addLogMessage(`${source}: ${content}`); // Example
    }

    // --- Helper Methods ---
    private saveConfig(config?: McpConnectionConfig): void {
        this.logger?.LogDebug("Attempting to save config...", "Controller", "Helper", "Config"); // Already updated
        try {
            const transport = config?.transport ?? this.view.getTransport();
            const command = config?.command ?? this.view.getCommand();
            const args = config?.args ?? this.view.getAllArguments();

            localStorage.setItem('mcpConfig', JSON.stringify({ transport, command, args }));
            this.logger?.LogInfo("Config saved.", "Controller", "Helper", "Config"); // Replaced console.log
        } catch (e: unknown) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            this.logger?.LogError(`Failed to save config to localStorage: ${errorMsg}`, "Controller", "Helper", "Config", "Error"); // Replaced console.error
        }
    }

    private loadAndApplyConfig(): void {
        this.logger?.LogDebug("Attempting to load config...", "Controller", "Helper", "Config"); // Replaced console.log
        try {
            const savedConfig = localStorage.getItem('mcpConfig');
            if (savedConfig) {
                const config = JSON.parse(savedConfig);
                if (config && typeof config === 'object') {
                    this.view.setTransport(config.transport || 'tcp'); // Provide default
                    this.view.setCommand(config.command || '');
                    this.view.renderArgumentInputs(config.args || []);
                    this.logger?.LogInfo("Config loaded and applied.", "Controller", "Helper", "Config"); // Replaced console.log
                } else {
                    this.logger?.LogInfo("No valid saved config found.", "Controller", "Helper", "Config"); // Replaced console.log
                }
            } else {
                 this.logger?.LogInfo("No saved config found in localStorage.", "Controller", "Helper", "Config"); // Added log for clarity
            }
        } catch (e: unknown) {
             const errorMsg = e instanceof Error ? e.message : String(e);
            this.logger?.LogError(`Failed to load or apply config from localStorage: ${errorMsg}`, "Controller", "Helper", "Config", "Error"); // Replaced console.error
        }
    }
} 