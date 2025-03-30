// src/controllers/mcp.controller.ts
import { McpUIView, McpServerConfig } from '../views/mcp-ui';
import { McpCommunicationService, McpCommunicationCallbacks, McpConnectionConfig } from '../services/mcp-communication';
import { McpMessagePayload } from '../models/mcp-message-payload.model'; // Needed for onMcpMessage
import { UIToolDefinition } from '../models/tool-definition.model'; // Needed for renderToolList
import { ApplicationServiceProvider } from '../services/application-service-provider'; // Added
import { Logger } from '../services/logger-service'; // Added

// Updated UIActions interface to include server management
export interface McpUIActions {
    onAddArgument: () => void; // View adds input locally, controller may save state
    onAddEnvVar: () => void; // View adds environment variable input locally
    onTestConnection: (args: string[]) => void; // Still useful to pass current args from form for test/save
    onListTools: () => void;
    onExecuteTool: (params: { [key: string]: any }) => void;
    onToolSelected: (toolIndex: number) => void;
    onArgumentInputChange: () => void; // Notify controller of arg changes

    // New Server Actions
    onAddServer: () => void; // User clicked '+'
    onSaveServer: (config: McpServerConfig) => void; // User clicked 'Save Server'
    onSelectServer: (serverId: string | null) => void; // User clicked a server item or null to clear
    onDeleteServer: (serverId: string) => void; // User clicked delete on a server item
    onConfigInputChange: () => void; // User changed name, transport, command, or args
    onConnectServer: (serverId: string) => void; // User clicked connect button
}

export class McpController implements McpUIActions, McpCommunicationCallbacks {
    private view: McpUIView;
    private communicationService: McpCommunicationService;
    private logger: Logger | undefined = ApplicationServiceProvider.getService(Logger); // Added
    // State to track the type of request pending a response
    private pendingRequestType: 'listTools' | 'executeTool' | null = null;
    
    // --- State Management ---
    private servers: McpServerConfig[] = []; // List of saved servers
    private currentSelectedServerId: string | null = null; // ID of the selected server
    private isConnectedToServer: boolean = false; // Track connection status
    private readonly localStorageKey = 'mcpServersConfig'; // Key for localStorage
    private readonly lastSelectedServerKey = 'mcpLastSelectedServerId'; // Key for last selection

    constructor() {
        this.view = new McpUIView();
        this.communicationService = new McpCommunicationService();

        // Register the controller's methods as actions for the view
        this.view.registerActions(this);

        // Initialize the view state
        this.view.setInitialState();
        // Potentially load saved config and render args here?
        this.loadServers();

        this.logger?.LogInfo((a, b) => a(b), "McpController initialized.", "Controller", "Initialization"); // Replaced console.log
    }

    // --- Implementation of McpUIActions ---

    onAddArgument(): void {
        // View handles adding the input visually.
        this.view.addArgumentInput();
        this.logger?.LogDebug((a, b) => a(b), "Added new argument input", "Controller", "Action", "UIEvent");
    }

    onConfigInputChange(): void {
        // Called when server name, transport, command, or args change in the form
        this.logger?.LogDebug((a, b) => a(b), "onConfigInputChange triggered", "Controller", "Action", "UIEvent");
        // If a server is selected, maybe indicate unsaved changes?
        // We don't save automatically here, user must click Save/Update.
        // Might need to disable Test Connection if changes are unsaved?
    }

    // Called when user clicks [+] Add Server button
    onAddServer(): void {
        this.logger?.LogInfo((a, b) => a(b), "onAddServer triggered", "Controller", "Action", "UIEvent");
        this.disconnectCurrent(); // Disconnect if connected to another server
        this.currentSelectedServerId = null; // Deselect any current server
        this.view.setSelectedServer(null); // Update visual selection
        this.view.clearServerForm(); // Clear form for new entry
        this.view.clearToolListAndExecution(); // Clear columns 2 & 3
    }

    // Called when user clicks Save/Update button
    onSaveServer(formData: McpServerConfig): void {
        this.logger?.LogInfo((a, b) => a(b), `onSaveServer triggered for ID: ${formData.id}`, "Controller", "Action", "UIEvent");

        let serverToSave: McpServerConfig;
        const existingIndex = this.servers.findIndex(s => s.id === formData.id);

        if (existingIndex > -1) {
            // Update existing server
            serverToSave = { ...this.servers[existingIndex], ...formData };
            this.servers[existingIndex] = serverToSave;
            this.logger?.LogDebug((a, b) => a(b), `Updating server: ${serverToSave.name} (${serverToSave.id})`, "Controller", "ServerManagement");
            this.view.hideServerForm(); // <<< ADDED: Hide form after successful update
        } else {
            // Add new server - generate a unique ID
            serverToSave = { ...formData, id: this.generateUniqueId() };
            this.servers.push(serverToSave);
            this.logger?.LogDebug((a, b) => a(b), `Adding new server: ${serverToSave.name} (${serverToSave.id})`, "Controller", "ServerManagement");
            // Keep form visible after adding a new server
        }

        this.currentSelectedServerId = serverToSave.id; // Select the newly saved/updated server
        this.saveServersToStorage(); // Persist changes
        this.view.renderServerList(this.servers, this.currentSelectedServerId); // Re-render list
        // Don't re-populate form if we just hid it for an update
        if (existingIndex === -1) { // Only populate form if adding new
             this.view.populateServerForm(serverToSave);
        }
        this.view.setSelectedServer(this.currentSelectedServerId); // Ensure visual selection in the list
    }

    // Called when user clicks on a server item in the list (or the Edit button)
    onSelectServer(serverId: string | null): void {
        this.logger?.LogDebug((a,b)=>a(b), `Server selection changed to: ${serverId}`, "Controller", "ServerSelection");

        // If clicking the same server again, hide the form and clear selection
        if (serverId === this.currentSelectedServerId) {
            this.view.hideServerForm();
            this.currentSelectedServerId = null;
            this.view.setSelectedServer(null);
            return;
        }

        // Otherwise, proceed with normal selection
        if (serverId) {
            const server = this.servers.find(s => s.id === serverId);
            if (server) {
                this.view.populateServerForm(server);
                this.view.setSelectedServer(serverId);
                this.currentSelectedServerId = serverId;
            } else {
                this.logger?.LogError(log => log(serverId), `Server not found: ${serverId}`, "Controller", "ServerSelection");
            }
        } else {
            this.view.clearServerForm();
            this.view.setSelectedServer(null);
            this.currentSelectedServerId = null;
        }
    }

    // Called when user clicks the Delete button on a server item
    onDeleteServer(serverId: string): void {
        this.logger?.LogInfo((a, b) => a(b), `onDeleteServer triggered for ID: ${serverId}`, "Controller", "Action", "UIEvent");
        const serverIndex = this.servers.findIndex(s => s.id === serverId);
        if (serverIndex === -1) return; // Not found

        const serverName = this.servers[serverIndex].name;
        this.servers.splice(serverIndex, 1); // Remove from array

        // If the deleted server was selected, deselect and clear form
        if (this.currentSelectedServerId === serverId) {
            this.disconnectCurrent(); // Disconnect first
            this.currentSelectedServerId = null;
            this.view.clearServerForm();
            this.view.setSelectedServer(null);
            this.saveLastSelectedServerId(null); // Clear last selected
        }

        this.saveServersToStorage(); // Persist deletion
        this.view.renderServerList(this.servers, this.currentSelectedServerId); // Re-render list
        this.logger?.LogDebug((a, b) => a(b), `Deleted server: ${serverName} (${serverId})`, "Controller", "ServerManagement");

        // If no servers left, ensure form is hidden/cleared appropriately
        if (this.servers.length === 0) {
            this.view.setSelectedServer(null);
            // clearServerForm might already hide it, or do it explicitly
            // this.view.connectionDetailsDiv.style.display = 'none';
        }
    }

    // Called when Test Connection button is clicked (uses selected server)
    onTestConnection(argsFromForm: string[]): void {
        this.logger?.LogInfo((a, b) => a(b), `onTestConnection triggered for selected server: ${this.currentSelectedServerId}`, "Controller", "Action", "UIEvent");

        if (!this.currentSelectedServerId) {
            this.view.showError("No server selected to test.", true);
            return;
        }

        const server = this.servers.find(s => s.id === this.currentSelectedServerId);
        if (!server) {
            this.view.showError(`Selected server (${this.currentSelectedServerId}) not found.`, true);
            return;
        }

        // Use current form data to allow testing changes before saving
        const formData = this.view.getServerFormData();
        const configToUse: McpConnectionConfig = {
            transport: formData.transport,
            command: formData.command,
            args: formData.args,
            env: formData.env || {}
        };

        this.logger?.LogDebug((a,b)=>a(b), `Attempting connection with config: ${JSON.stringify(configToUse)}`, "Controller", "Connection")

        this.view.showConnecting();
        this.disconnectCurrent(); // Ensure any previous connection is closed

        // Reset pending request state before connecting
        this.pendingRequestType = null;
        this.isConnectedToServer = false; // Assume disconnected until successful

        // Connect using the service, passing this controller as the callback handler
        this.communicationService.connect(configToUse, this);
    }

    onListTools(): void {
        this.logger?.LogInfo((a, b) => a(b), "onListTools triggered", "Controller", "Action", "UIEvent");
        if (!this.isConnectedToServer) { // Check internal connection state
            this.view.showToolListError("Cannot list tools: Not connected.");
            return;
        }
        this.view.showFetchingTools();
        this.pendingRequestType = 'listTools';
        this.communicationService.sendRequestToBackend('tools/list', {});
        this.logger?.LogDebug((a, b) => a(b), `Sent tools/list request`, "Controller", "Action", "MCPRequest");
    }

    onExecuteTool(params: { [key: string]: any }): void {
        this.logger?.LogInfo((a, b) => a(b), `onExecuteTool triggered`, "Controller", "Action", "UIEvent", "ToolExecution");
        if (!this.isConnectedToServer) { // Check internal connection state
            this.view.displayToolResult({ status: 'error', message: "Cannot execute tool: Not connected." });
            return;
        }

        const selectedToolName = this.view.getSelectedToolName();
        if (!selectedToolName) {
            this.view.displayToolResult({ status: 'error', message: "Cannot execute: No tool selected or name unavailable." });
            return;
        }

        this.view.showExecutingTool();
        this.pendingRequestType = 'executeTool';
        this.communicationService.sendRequestToBackend('tools/call', {
            name: selectedToolName,
            arguments: params
        });
        this.logger?.LogDebug((a, b) => a(b), `Sent tools/call request for ${selectedToolName}`, "Controller", "Action", "MCPRequest", "ToolExecution");
    }

    onToolSelected(toolIndex: number): void {
        this.logger?.LogDebug((a, b) => a(b), `onToolSelected triggered with index: ${toolIndex}`, "Controller", "Action", "UIEvent", "ToolSelection");
        // View handles displaying the form. Controller state for selected tool isn't strictly needed yet.
    }

    onArgumentInputChange(): void {
        // Called when individual args change in the form
        this.logger?.LogDebug((a, b) => a(b), "onArgumentInputChange triggered", "Controller", "Action", "UIEvent");
        // Trigger general config change handler
        this.onConfigInputChange();
    }

    onAddEnvVar(): void {
        this.view.addEnvironmentVariableInput();
        this.logger?.LogDebug((a, b) => a(b), "Added new environment variable input", "Controller", "Action", "UIEvent");
    }

    // Called when user clicks the Connect button on a server item
    onConnectServer(serverId: string): void {
        this.logger?.LogInfo((a, b) => a(b), `onConnectServer triggered for ID: ${serverId}`, "Controller", "Action", "UIEvent");
        const server = this.servers.find(s => s.id === serverId);
        if (!server) {
            this.logger?.LogError((a, b) => a(b), `Server ID ${serverId} not found in list!`, "Controller", "ServerManagement", "Error");
            return;
        }

        // If already connected to this server, do nothing
        if (this.currentSelectedServerId === serverId && this.isConnectedToServer) {
            return;
        }

        // If connected to a different server, disconnect first
        if (this.isConnectedToServer) {
            this.disconnectCurrent();
        }

        // Update UI to show connecting state
        this.view.updateServerConnectionState(serverId, 'connecting');
        this.currentSelectedServerId = serverId;
        this.view.setSelectedServer(serverId);

        // Get the current server configuration
        const config: McpConnectionConfig = {
            transport: server.transport,
            command: server.command,
            args: server.args,
            env: server.env
        };

        // Attempt to connect
        this.communicationService.connect(config, this);
    }

    // --- Implementation of McpCommunicationCallbacks ---

    onConnecting(): void {
        // Already handled by updateServerConnectionState
    }

    onConnected(): void {
        this.isConnectedToServer = true;
        if (this.currentSelectedServerId) {
            this.view.updateServerConnectionState(this.currentSelectedServerId, 'connected');
            this.view.showConnected(true);
            this.logger?.LogInfo((a, b) => a(b), `Successfully connected to server: ${this.currentSelectedServerId}`, "Controller", "Connection");
        }
    }

    onDisconnected(code?: number | string): void {
        this.isConnectedToServer = false;
        if (this.currentSelectedServerId) {
            this.view.updateServerConnectionState(this.currentSelectedServerId, 'disconnected');
            this.view.showConnected(false);
            this.logger?.LogInfo((a, b) => a(b), `Disconnected from server: ${this.currentSelectedServerId} (Code: ${code ?? 'N/A'})`, "Controller", "Connection");
        }
    }

    onError(error: string, isConnectionError: boolean): void {
        this.logger?.LogError((a, b) => a(b), `Service Error: ${error}. Is connection error: ${isConnectionError}`, "Controller", "Callback", "CommunicationError");
        this.isConnectedToServer = false;
        this.pendingRequestType = null; // Reset pending request on error
        this.view.showError(error, isConnectionError);
         // If it was a connection error, showConnected(false) should be called by view
         if (isConnectionError) {
             this.view.showConnected(false);
         }
    }

    onMcpMessage(payload: McpMessagePayload): void {
        this.logger?.LogDebug((a, b) => a(b), `Received MCP message: ${JSON.stringify(payload)}`, "Controller", "Callback", "MCPMessage");

        // Check if it's a response (has an ID)
        if (payload.id) {
            switch (this.pendingRequestType) {
                case 'listTools':
                    this.logger?.LogDebug((a, b) => a(b), `Handling response for pending request: ${this.pendingRequestType} (ID: ${payload.id})`, "Controller", "Callback", "MCPMessage", "ResponseHandling");
                    if (payload.result?.tools && Array.isArray(payload.result.tools)) {
                        this.view.renderToolList(payload.result.tools as UIToolDefinition[]);
                    } else if (payload.error) {
                        this.view.showToolListError(`Error listing tools: ${payload.error.message} (Code: ${payload.error.code})`);
                    } else {
                        this.view.showToolListError('Received invalid response format for listTools.');
                    }
                    this.pendingRequestType = null;
                    break;

                case 'executeTool':
                    this.logger?.LogDebug((a, b) => a(b), `Handling response for pending request: ${this.pendingRequestType} (ID: ${payload.id})`, "Controller", "Callback", "MCPMessage", "ResponseHandling");
                     if (payload.result !== undefined) {
                         this.view.displayToolResult({ status: 'success', data: payload.result });
                     } else if (payload.error) {
                         this.view.displayToolResult({ status: 'error', message: payload.error.message, details: payload.error.data });
                     } else {
                         this.view.displayToolResult({ status: 'error', message: 'Received invalid response format for executeTool.' });
                     }
                    this.pendingRequestType = null;
                    break;

                default:
                    this.logger?.LogWarning((a, b) => a(b), `Received response with ID ${payload.id} but no matching pending request type (${this.pendingRequestType})`, "Controller", "Callback", "MCPMessage", "ResponseHandling", "Unexpected");
                    break;
            }
        } else if (payload.method) { // Handle Notifications
             if (payload.method === 'logMessage' && payload.params?.message) {
                 const level = payload.params.level || 'info';
                 this.logger?.LogInfo((a, b) => a(b), `[MCP Log/${level.toUpperCase()}]: ${payload.params.message}`, "Controller", "Callback", "MCPMessage", "Notification", "MCPLog");
             } else {
                  this.logger?.LogWarning((a, b) => a(b), `Received unhandled MCP notification: ${payload.method}`, "Controller", "Callback", "MCPMessage", "Notification", "Unexpected");
             }
        }
    }

    // Log messages from the communication service itself (e.g., transport specific logs)
    onLogMessage(source: string, content: string): void {
        this.logger?.LogDebug((a, b) => a(b), `[${source}] ${content}`, "Controller", "Callback", "ServiceLog");
        // Optionally pass to view if a log panel exists: this.view.showLogMessage(source, content);
    }

    // --- Helper Methods ---

    private generateUniqueId(): string {
        // Simple unique ID generation (consider a more robust library if needed)
        return Date.now().toString(36) + Math.random().toString(36).substring(2);
    }

    private saveServersToStorage(): void {
        try {
            localStorage.setItem(this.localStorageKey, JSON.stringify(this.servers));
            this.logger?.LogDebug((a, b) => a(b), "Server configurations saved to localStorage.", "Controller", "Persistence");
        } catch (error: any) {
            this.logger?.LogError((a, b) => a(b), `Failed to save servers to localStorage: ${error.message}`, "Controller", "Persistence", "Error");
            // Optionally inform the user via the view
            // this.view.showError("Could not save server configurations.", false);
        }
    }

    private loadServers(): void {
        try {
            const savedServers = localStorage.getItem(this.localStorageKey);
            if (savedServers) {
                this.servers = JSON.parse(savedServers);
                this.logger?.LogInfo((a, b) => a(b), `Loaded ${this.servers.length} server(s) from localStorage.`, "Controller", "Persistence");
            } else {
                this.servers = []; // Initialize as empty array if nothing saved
            }
        } catch (error: any) {
            this.logger?.LogError((a, b) => a(b), `Failed to load servers from localStorage: ${error.message}`, "Controller", "Persistence", "Error");
            this.servers = []; // Start with empty list on error
            // Optionally inform the user
            // this.view.showError("Could not load saved server configurations.", false);
        }

        // Load last selected server ID
        const lastSelectedId = localStorage.getItem(this.lastSelectedServerKey);
        let serverToSelect: McpServerConfig | undefined = undefined;

        if (lastSelectedId) {
             serverToSelect = this.servers.find(s => s.id === lastSelectedId);
        }

        // If no last selection or last selected not found, select first server if available
        if (!serverToSelect && this.servers.length > 0) {
             serverToSelect = this.servers[0];
        }

        // Render the list and select the appropriate server
        this.currentSelectedServerId = serverToSelect ? serverToSelect.id : null;
        this.view.renderServerList(this.servers, this.currentSelectedServerId);
        this.view.setSelectedServer(this.currentSelectedServerId); // Highlight selection in list
        // Ensure form is hidden initially
        this.view.hideServerForm();
    }

    private saveLastSelectedServerId(serverId: string | null): void {
        try {
            if (serverId) {
                localStorage.setItem(this.lastSelectedServerKey, serverId);
            } else {
                localStorage.removeItem(this.lastSelectedServerKey);
            }
        } catch (error: any) {
            this.logger?.LogError((a, b) => a(b), `Failed to save last selected server ID: ${error.message}`, "Controller", "Persistence", "Error");
        }
    }

    private disconnectCurrent(): void {
        if (this.communicationService.isConnected) {
            this.logger?.LogInfo((a, b) => a(b), "Disconnecting from current server...", "Controller", "Connection");
            this.communicationService.disconnect();
            this.isConnectedToServer = false;
            // View updates are handled in onDisconnected callback
        }
    }

    /* // Old save/load - replaced by server list management
    private saveConfig(config?: McpConnectionConfig): void {
        try {
            const configToSave = config || {
                transport: this.view.getTransport(),
                command: this.view.getCommand(),
                args: this.view.getAllArguments()
            };
            localStorage.setItem(this.localStorageKey, JSON.stringify(configToSave));
             this.logger?.LogDebug((a, b) => a(b), "Configuration saved.", "Controller", "Persistence");
        } catch (error: any) {
             this.logger?.LogError((a, b) => a(b), `Failed to save config: ${error.message}`, "Controller", "Persistence", "Error");
        }
    }

    private loadAndApplyConfig(): void {
        try {
            const savedConfig = localStorage.getItem(this.localStorageKey);
            if (savedConfig) {
                const config = JSON.parse(savedConfig);
                this.view.setTransport(config.transport || 'STDIO');
                this.view.setCommand(config.command || '');
                this.view.renderArgumentInputs(config.args || []);
                 this.logger?.LogInfo((a, b) => a(b), "Configuration loaded.", "Controller", "Persistence");
            } else {
                 this.logger?.LogInfo((a, b) => a(b), "No saved configuration found.", "Controller", "Persistence");
            }
        } catch (error: any) {
             this.logger?.LogError((a, b) => a(b), `Failed to load config: ${error.message}`, "Controller", "Persistence", "Error");
        }
    }
    */
} 