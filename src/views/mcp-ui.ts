// src/mcp-ui.ts
import { UIToolDefinition } from '../models/tool-definition.model';
import { McpUIActions } from '../controllers/mcp.controller';
import { ApplicationServiceProvider } from '../services/application-service-provider';
import { Logger } from '../services/logger-service';

// Define the server config structure locally (or import if moved to models)
export interface McpServerConfig {
    id: string; // Unique identifier
    name: string; // User-friendly name
    transport: string;
    command: string;
    args: string[];
    env: { [key: string]: string }; // Environment variables
}

export class McpUIView {
    private logger: Logger | undefined = ApplicationServiceProvider.getService(Logger);

    // --- UI Elements --- Declare properties
    private serverListUl: HTMLUListElement;
    private addServerBtn: HTMLButtonElement;
    private connectionDetailsDiv: HTMLDivElement;
    private serverNameInput: HTMLInputElement;
    private transportSelect: HTMLSelectElement;
    private commandInput: HTMLInputElement;
    private addArgBtn: HTMLButtonElement;
    private argsList: HTMLUListElement;
    private addEnvBtn: HTMLButtonElement;
    private envList: HTMLUListElement;
    private saveServerBtn: HTMLButtonElement;
    private testConnectionBtn: HTMLButtonElement;
    private statusIndicator: HTMLSpanElement;
    private errorMessageDiv: HTMLDivElement;
    private connectingOverlay: HTMLDivElement;
    private listToolsBtn: HTMLButtonElement;
    private toolsListArea: HTMLDivElement;
    private toolsListUl: HTMLUListElement;
    private toolsLoadingMsg: HTMLDivElement;
    private toolsErrorMsg: HTMLDivElement;
    private toolExecutionArea: HTMLDivElement;
    private selectedToolNameSpan: HTMLSpanElement;
    private toolParamsForm: HTMLFormElement;
    private executeToolBtn: HTMLButtonElement;
    private toolResultArea: HTMLDivElement;
    private toolResultOutput: HTMLPreElement;
    private toolResultError: HTMLDivElement;
    private toolExecutingMsg: HTMLDivElement;
    private toolSelectPrompt: HTMLDivElement;

    private actions: McpUIActions | null = null;
    private currentTools: UIToolDefinition[] = []; // Store tools locally for rendering
    private selectedTool: UIToolDefinition | null = null; // Store selected tool locally
    private isListingToolsState: boolean = false; // Track if listTools is in progress
    private currentSelectedServerId: string | null = null; // Track selected server ID

    constructor() {
        // --- Get all elements --- Assign properties in constructor
        // Throws error if any element is missing
        this.serverListUl = this.getElement('server-list', HTMLUListElement);
        this.addServerBtn = this.getElement('add-server-btn', HTMLButtonElement);
        this.connectionDetailsDiv = this.getElement('connection-details', HTMLDivElement);
        this.serverNameInput = this.getElement('server-name', HTMLInputElement);
        this.saveServerBtn = this.getElement('save-server-btn', HTMLButtonElement);
        this.transportSelect = this.getElement('transport', HTMLSelectElement);
        this.commandInput = this.getElement('command', HTMLInputElement);
        this.addArgBtn = this.getElement('add-arg-btn', HTMLButtonElement);
        this.argsList = this.getElement('args-list', HTMLUListElement);
        this.addEnvBtn = this.getElement('add-env-btn', HTMLButtonElement);
        this.envList = this.getElement('env-list', HTMLUListElement);
        this.testConnectionBtn = this.getElement('test-connection-btn', HTMLButtonElement);
        this.statusIndicator = this.getElement('status-indicator', HTMLSpanElement);
        this.errorMessageDiv = this.getElement('error-message', HTMLDivElement);
        this.connectingOverlay = this.getElement('connecting-overlay', HTMLDivElement);
        this.listToolsBtn = this.getElement('list-tools-btn', HTMLButtonElement);
        this.toolsListArea = this.getElement('tools-list-area', HTMLDivElement);
        this.toolsListUl = this.getElement('tools-list', HTMLUListElement);
        this.toolsLoadingMsg = this.getElement('tools-loading-message', HTMLDivElement);
        this.toolsErrorMsg = this.getElement('tools-error-message', HTMLDivElement);
        this.toolExecutionArea = this.getElement('tool-execution-area', HTMLDivElement);
        this.selectedToolNameSpan = this.getElement('selected-tool-name', HTMLSpanElement);
        this.toolParamsForm = this.getElement('tool-params-form', HTMLFormElement);
        this.executeToolBtn = this.getElement('execute-tool-btn', HTMLButtonElement);
        this.toolResultArea = this.getElement('tool-result-area', HTMLDivElement);
        this.toolResultOutput = this.getElement('tool-result-output', HTMLPreElement);
        this.toolResultError = this.getElement('tool-result-error', HTMLDivElement);
        this.toolExecutingMsg = this.getElement('tool-executing-message', HTMLDivElement);
        this.toolSelectPrompt = this.getElement('tool-select-prompt', HTMLDivElement);
    }

    // Helper to get elements and throw if missing
    private getElement<T extends HTMLElement>(id: string, elementType: { new(): T }): T {
        const element = document.getElementById(id);
        if (!element) {
            // Throw an error that will be caught by the orchestrator if an element is missing
            throw new Error(`Initialization Error: Required UI element with ID '${id}' is missing.`);
        }
        // Optional: More robust type checking if needed
        // if (!(element instanceof elementType)) {
        //     throw new Error(`Initialization Error: Element with ID '${id}' is not of type ${elementType.name}.`);
        // }
        return element as T;
    }

    // Register action callbacks provided by the orchestrator
    public registerActions(actions: McpUIActions): void {
        this.actions = actions;
        this.bindEventListeners(); // Bind listeners *after* actions are registered
    }

    // Bind listeners to UI elements that trigger actions
    private bindEventListeners(): void {
        // Ensure actions are registered before binding
        if (!this.actions) return;

        // --- Column 1 Listeners ---
        this.addServerBtn.addEventListener('click', () => {
            // If form is visible and no server is selected, hide it
            if (this.connectionDetailsDiv.style.display !== 'none' && !this.currentSelectedServerId) {
                this.connectionDetailsDiv.style.display = 'none';
            } else {
                this.actions!.onAddServer();
            }
        });
        this.addArgBtn.addEventListener('click', () => this.actions!.onAddArgument());
        this.addEnvBtn.addEventListener('click', () => this.actions!.onAddEnvVar());

        this.saveServerBtn.addEventListener('click', () => {
            const formData = this.getServerFormData();
            if (!formData.name) {
                this.showError("Server name is required.", false, 'col1'); // Show error in Col 1
                return;
            }
            this.actions!.onSaveServer(formData);
        });

        this.testConnectionBtn.addEventListener('click', () => {
            const currentArgs = this.getAllArguments(); // Get args from form
            this.actions!.onTestConnection(currentArgs);
        });

        this.serverListUl.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            const serverItem = target.closest('.server-item');
            if (!serverItem) return;
            const serverId = serverItem.getAttribute('data-server-id');
            if (!serverId) return;

            if (target.classList.contains('delete-btn')) {
                event.stopPropagation();
                if (confirm(`Are you sure you want to delete server "${serverItem.querySelector('span')?.textContent ?? serverId}"?`)) {
                    this.actions!.onDeleteServer(serverId);
                }
            } else if (target.classList.contains('edit-btn')) {
                 event.stopPropagation();
                 this.actions!.onSelectServer(serverId);
            }
        });

        this.serverNameInput.addEventListener('input', () => this.actions!.onConfigInputChange());
        this.transportSelect.addEventListener('change', () => this.actions!.onConfigInputChange());
        this.commandInput.addEventListener('input', () => this.actions!.onConfigInputChange());

        this.argsList.addEventListener('input', (event) => {
            if ((event.target as HTMLElement).classList.contains('arg-input-dynamic')) {
                this.actions?.onArgumentInputChange();
            }
        });
        this.argsList.addEventListener('click', (event) => {
             const target = event.target as HTMLElement;
             if (target.classList.contains('remove-arg-btn')) {
                 // Let addArgumentInput handle removal, but notify change
                 this.actions?.onArgumentInputChange();
             }
         });

        // --- Column 2 Listeners ---
        this.listToolsBtn.addEventListener('click', () => this.actions!.onListTools());

        // Tool selection listener added dynamically in renderToolList
        this.toolsListUl.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            const toolItem = target.closest('li[data-tool-index]');
            if (toolItem) {
                const toolIndex = parseInt(toolItem.getAttribute('data-tool-index') || '-1', 10);
                if (toolIndex >= 0) {
                    this.handleToolSelect(toolIndex);
                }
            }
        });
        this.toolsListUl.addEventListener('keydown', (event) => {
             const target = event.target as HTMLElement;
             if (event.key === 'Enter' || event.key === ' ') {
                 const toolItem = target.closest('li[data-tool-index]');
                 if (toolItem) {
                     const toolIndex = parseInt(toolItem.getAttribute('data-tool-index') || '-1', 10);
                     if (toolIndex >= 0) {
                         this.handleToolSelect(toolIndex);
                     }
                 }
             }
         });

        // --- Column 3 Listeners ---
        this.executeToolBtn.addEventListener('click', () => this.handleExecuteTool());

        this.toolParamsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleExecuteTool();
        });
    }

    // --- Getters for Configuration Elements (for orchestrator to add listeners) ---
    public getTransportElement(): HTMLSelectElement {
        return this.transportSelect;
    }

    public getCommandElement(): HTMLInputElement {
        return this.commandInput;
    }

    // --- Getters for Configuration Values ---
    public getTransport(): string {
        return this.transportSelect.value;
    }

    public getCommand(): string {
        return this.commandInput.value.trim();
    }

    public getAllArguments(): string[] {
        const inputs = this.argsList.querySelectorAll<HTMLInputElement>('.arg-input-dynamic');
        return Array.from(inputs).map(input => input.value.trim()).filter(value => value !== '');
    }

    public getAllEnvironmentVariables(): { [key: string]: string } {
        const envVars: { [key: string]: string } = {};
        const envItems = this.envList.querySelectorAll('.env-item');
        envItems.forEach((item) => {
            const keyInput = item.querySelector('.env-key') as HTMLInputElement;
            const valueInput = item.querySelector('.env-value') as HTMLInputElement;
            if (keyInput && valueInput) {
                const key = keyInput.value.trim();
                if (key) {
                    envVars[key] = valueInput.value.trim();
                }
            }
        });
        return envVars;
    }

    public getSelectedToolName(): string | null {
        return this.selectedTool ? this.selectedTool.name : null;
    }

    // --- Setters for Configuration (e.g., from localStorage by orchestrator) ---
    public setTransport(value: string): void {
        this.transportSelect.value = value;
    }

    public setCommand(value: string): void {
        this.commandInput.value = value;
    }

    public renderArgumentInputs(args: string[]): void {
        this.argsList.innerHTML = ''; // Clear existing args
        if (args && args.length > 0) {
            args.forEach(arg => this.addArgumentInput(arg));
        }
    }

    public renderEnvironmentVariables(env: { [key: string]: string }): void {
        this.envList.innerHTML = '';
        Object.entries(env).forEach(([key, value]) => {
            this.addEnvironmentVariableInput(key, value);
        });
    }

    public addEnvironmentVariableInput(key: string = '', value: string = ''): void {
        const li = document.createElement('li');
        li.className = 'env-item';
        li.innerHTML = `
            <input type="text" class="env-key" placeholder="Key" value="${key}">
            <input type="text" class="env-value" placeholder="Value" value="${value}">
            <button class="delete-btn" title="Delete">×</button>
        `;

        const deleteBtn = li.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                li.remove();
                this.actions?.onConfigInputChange();
            });
        }

        const inputs = li.querySelectorAll('input');
        inputs.forEach(input => {
            input.addEventListener('input', () => this.actions?.onConfigInputChange());
        });

        this.envList.appendChild(li);
    }

    // --- UI State Update Methods --- Called by Orchestrator via Callbacks

    public setInitialState(): void {
        // Column 1
        this.serverListUl.innerHTML = '';
        this.connectionDetailsDiv.style.display = 'none'; // Hide form initially
        this.clearServerForm(); // Clear form fields
        this.connectionDetailsDiv.style.display = 'none'; // Hide form explicitly after clear
        this.testConnectionBtn.disabled = true;
        this.statusIndicator.className = 'status-indicator';
        this.errorMessageDiv.style.display = 'none';
        this.connectingOverlay.style.display = 'none';

        // Column 2
        this.listToolsBtn.disabled = true;
        this.toolsListArea.style.display = 'none';
        this.toolsLoadingMsg.style.display = 'none';
        this.toolsErrorMsg.style.display = 'none';
        this.toolsListUl.innerHTML = '';

        // Column 3
        this.toolExecutionArea.style.display = 'none';
        this.toolSelectPrompt.style.display = 'block';
        this.executeToolBtn.disabled = true;
        this.toolResultArea.style.display = 'none';
        this.toolExecutingMsg.style.display = 'none';
        this.toolResultError.style.display = 'none';
        this.toolParamsForm.innerHTML = '';
        this.selectedToolNameSpan.textContent = '';

        this.isListingToolsState = false;
        this.selectedTool = null;
        this.currentSelectedServerId = null;
        this.lockUI(false); // Ensure UI is unlocked initially
    }

    public showConnecting(): void {
        this.statusIndicator.className = 'status-indicator';
        this.clearError(); // Clear all error messages
        this.connectingOverlay.style.display = 'block';
        this.lockUI(true);
    }

    public showConnected(isConnected: boolean): void {
        this.connectingOverlay.style.display = 'none';
        this.lockUI(false);

        if (isConnected) {
            this.statusIndicator.className = 'status-indicator connected';
            this.listToolsBtn.disabled = false;
            this.listToolsBtn.style.display = 'block'; // Show the list tools button
            this.clearError('col1'); // Clear connection-related errors
        } else {
            this.statusIndicator.className = 'status-indicator error';
            this.listToolsBtn.disabled = true;
            this.listToolsBtn.style.display = 'none'; // Hide the list tools button
            this.clearToolListAndExecution(); // Clear cols 2/3 on disconnect/failure
        }
        this.testConnectionBtn.disabled = !this.currentSelectedServerId;
    }

    public showDisconnected(code?: number | string): void {
        this.statusIndicator.className = 'status-indicator'; // Reset status to default/off
        this.errorMessageDiv.textContent = `Client process disconnected (Code: ${code ?? 'N/A'}). Please test connection again.`;
        this.errorMessageDiv.style.display = 'block';
        this.listToolsBtn.style.display = 'none'; // Hide tool buttons/areas
        this.listToolsBtn.disabled = true;
        this.toolsListArea.style.display = 'none';
        this.toolExecutionArea.style.display = 'none';
        this.executeToolBtn.disabled = true;
        this.connectingOverlay.style.display = 'none'; // Ensure overlay is hidden
        this.testConnectionBtn.disabled = false; // Re-enable config controls
        this.addArgBtn.disabled = false;
        this.enableArgumentInputs();
        this.currentTools = []; // Clear internal tool state
        this.selectedTool = null;
        this.isListingToolsState = false; // Reset listing state
    }

    public showError(error: string, isConnectionError: boolean, targetColumn: 'col1' | 'col2' | 'col3' = 'col1'): void {
        this.connectingOverlay.style.display = 'none'; // Hide overlay if it was shown
        this.lockUI(false); // Unlock UI on error

        let errorElement: HTMLDivElement;
        switch (targetColumn) {
            case 'col2': errorElement = this.toolsErrorMsg; break;
            case 'col3': errorElement = this.toolResultError; break;
            case 'col1':
            default: errorElement = this.errorMessageDiv; break;
        }

        if (errorElement) {
             errorElement.textContent = error;
             errorElement.style.display = 'block';
        } else {
             this.logger?.LogError(log => log(error), `Error display failed: targetDiv for ${targetColumn} not found. Message: ${error}`, "View", "ErrorHandling");
             alert(`Error: ${error}`); // Fallback
        }

        if (isConnectionError) {
            this.statusIndicator.className = 'status-indicator error';
            this.listToolsBtn.disabled = true;
            this.clearToolListAndExecution(); // Clear cols 2/3 on connection error
        }
    }

    public showLogMessage(source: string, content: string): void {
        this.logger?.LogInfo((a, b) => a(b), `Log from MCP [${source}]: ${content}`, "UI", "View", "MCPLog", source); // Replaced console.log
        // Optional: Display logs in a dedicated area in the UI
        if (source === 'stderr') {
            // Create a new element for the log entry
            const logEntry = document.createElement('div');
            logEntry.textContent = `[STDERR] ${content}`;
            logEntry.style.whiteSpace = 'pre-wrap'; // Preserve formatting
            logEntry.style.color = 'orange'; // Distinguish stderr logs
            logEntry.style.fontSize = '0.9em';
            logEntry.style.marginTop = '5px';

            // Append to a dedicated log container if it exists
            const logOutput = document.getElementById('log-output');
            if (logOutput) {
                logOutput.appendChild(logEntry);
                logOutput.scrollTop = logOutput.scrollHeight; // Auto-scroll to bottom
            } else {
                // Fallback: Append cautiously to the main error display, could get noisy
                // this.errorMessageDiv.textContent += `\n[STDERR] ${content}`;
                // this.errorMessageDiv.style.display = 'block';
            }
        }
    }

    // --- Tool Listing --- Called by Orchestrator

    public showFetchingTools(): void {
        this.clearError('col2'); // Clear previous tool errors
        this.toolsListArea.style.display = 'block';
        this.toolsLoadingMsg.textContent = 'Fetching tools...';
        this.toolsLoadingMsg.style.display = 'block';
        this.toolsListUl.innerHTML = '';
        this.toolExecutionArea.style.display = 'none';
        this.toolSelectPrompt.style.display = 'block';
        this.toolResultArea.style.display = 'none';
         this.isListingToolsState = true;
    }

    // Check if UI is currently in the process of listing tools
    public isListingTools(): boolean {
        return this.isListingToolsState; // Return the flag state
    }

    public renderToolList(tools: UIToolDefinition[]): void {
        this.logger?.LogDebug((a,b) => a(b), `renderToolList called with ${tools?.length ?? 0} tools.`, "View", "Render"); // ADDED LOG
        this.isListingToolsState = false;
        this.currentTools = tools;
        this.toolsLoadingMsg.style.display = 'none';
        this.toolsListUl.innerHTML = '';
        this.clearError('col2'); // Clear errors from previous attempts

        if (!tools || tools.length === 0) {
            this.logger?.LogDebug((a,b) => a(b), `No tools found, displaying message.`, "View", "Render"); // ADDED LOG
            this.toolsListUl.innerHTML = '<li>No tools found.</li>';
            this.toolsListArea.style.display = 'block';
             this.clearToolListAndExecution(); // Reset Col 3
            return;
        }

        this.logger?.LogDebug((a,b) => a(b), `Rendering ${tools.length} tools. Setting toolsListArea display to block.`, "View", "Render"); // ADDED LOG
        this.toolsListArea.style.display = 'block'; // Ensure visible

        tools.forEach((tool, index) => {
            const li = document.createElement('li');
            li.textContent = tool.name;
            li.title = tool.description || 'No description available';
            li.setAttribute('data-tool-index', index.toString());
            li.setAttribute('role', 'button');
            li.tabIndex = 0;
            // Click/Keydown listeners are now added in bindEventListeners using delegation
            this.toolsListUl.appendChild(li);
        });
    }

    public showToolListError(errorMessage: string): void {
        this.isListingToolsState = false;
        this.toolsLoadingMsg.style.display = 'none';
        this.toolsListArea.style.display = 'block';
        this.toolsListUl.innerHTML = '';
        this.showError(errorMessage, false, 'col2'); // Show error in Col 2 div
         this.clearToolListAndExecution(); // Reset Col 3
    }

    // --- Tool Selection and Execution --- (Internal UI Logic)

    // Called when a tool <li> element is clicked
    private handleToolSelect(toolIndex: number): void {
        if (toolIndex < 0 || toolIndex >= this.currentTools.length) return;

        this.selectedTool = this.currentTools[toolIndex];

        const items = this.toolsListUl.querySelectorAll('li');
        items.forEach((item, index) => {
            if (index === toolIndex) item.classList.add('selected');
            else item.classList.remove('selected');
        });

        this.renderToolForm(this.selectedTool);
        this.actions?.onToolSelected(toolIndex);
    }

    // Renders the parameters form based on the tool's inputSchema
    private renderToolForm(tool: UIToolDefinition): void {
        this.clearError('col3'); // Clear previous execution errors
        this.toolResultArea.style.display = 'none';
        this.toolParamsForm.innerHTML = '';
        this.selectedToolNameSpan.textContent = tool.name;

        const schema = tool.inputSchema;
        const properties = schema?.properties;
        const requiredParams = schema?.required || [];

        if (properties && Object.keys(properties).length > 0) {
            Object.entries(properties).forEach(([paramName, paramSchema]) => {
                const isRequired = requiredParams.includes(paramName);
                const formGroup = this.createFormElement(paramName, paramSchema, isRequired);
                this.toolParamsForm.appendChild(formGroup);
            });
             this.executeToolBtn.disabled = false;
             this.toolExecutionArea.style.display = 'block';
             this.toolSelectPrompt.style.display = 'none';
        } else {
            const noParamsMsg = document.createElement('p');
            noParamsMsg.textContent = 'This tool has no parameters.';
            noParamsMsg.style.fontStyle = 'italic';
            this.toolParamsForm.appendChild(noParamsMsg);
             this.executeToolBtn.disabled = false;
             this.toolExecutionArea.style.display = 'block';
             this.toolSelectPrompt.style.display = 'none';
        }
    }

    // Helper to create a label and input element for a single parameter
    private createFormElement(paramName: string, paramSchema: any, isRequired: boolean): HTMLDivElement {
        const paramType = paramSchema.type || 'any'; // Default to 'any' if type missing
        const paramDescription = paramSchema.description || '';
        const paramDefault = paramSchema.default; // Get default value if provided

        const div = document.createElement('div');
        div.className = 'form-group'; // Add class for styling
        div.style.marginBottom = '15px'; // Spacing between form groups

        const label = document.createElement('label');
        label.style.display = 'block'; // Make label take its own line
        label.style.marginBottom = '5px'; // Space between label and input
        label.style.fontWeight = 'bold';
        const requiredStar = isRequired ? '<span style="color:red;" title="Required">*</span>' : '';
        label.innerHTML = `${paramName} (${paramType})${requiredStar}:`;
        label.htmlFor = `param-${paramName}`;
        label.title = paramDescription; // Use description for tooltip

        let inputElement: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const commonStyle = 'width: 100%; padding: 8px; border: 1px solid var(--input-border); border-radius: 3px; background-color: var(--input-bg); color: var(--text-color); margin-top: 2px; box-sizing: border-box;';

        // --- Input Type Determination ---
        if (paramSchema.type === 'boolean') {
            inputElement = document.createElement('select');
            const optionTrue = document.createElement('option'); optionTrue.value = 'true'; optionTrue.text = 'True';
            const optionFalse = document.createElement('option'); optionFalse.value = 'false'; optionFalse.text = 'False';
            inputElement.appendChild(optionFalse); // Default to false unless schema default specifies otherwise
            inputElement.appendChild(optionTrue);
            // Set value based on default, ensuring it's a string 'true' or 'false'
            if (paramDefault !== undefined) {
                inputElement.value = String(paramDefault); // 'true' or 'false'
            }
        } else if (paramSchema.type === 'array' || (paramDescription || '').toLowerCase().includes('multiline')) {
             // Use textarea for arrays (comma-separated) or if description hints at multiline
            inputElement = document.createElement('textarea');
            inputElement.rows = 3;
            const itemType = paramSchema.items?.type || 'string'; // Get item type for placeholder
            inputElement.placeholder = `Enter ${paramSchema.type === 'array' ? 'comma-separated ' + itemType + 's' : 'value'}...\n${paramDescription}`;
             // Set default value for arrays, joining by comma
            if (paramDefault !== undefined && Array.isArray(paramDefault)) {
                 inputElement.value = paramDefault.join(', ');
             }
        } else { // Includes number, integer, string, or other types treated as text input
            inputElement = document.createElement('input');
            inputElement.type = (paramSchema.type === 'number' || paramSchema.type === 'integer') ? 'number' : 'text';
            inputElement.placeholder = `Enter ${paramName}... (${paramDescription})`;
             // Set default value for simple types
            if (paramDefault !== undefined) {
                 inputElement.value = String(paramDefault);
             }
             // Add step attribute for number/integer types for browser validation/UI
            if (inputElement.type === 'number') {
                 inputElement.step = paramSchema.type === 'integer' ? '1' : 'any'; // Integers step by 1, numbers allow decimals
            }
        }
        // --- Common Attributes ---
        inputElement.id = `param-${paramName}`;
        inputElement.name = paramName;
        inputElement.required = isRequired;
        inputElement.style.cssText = commonStyle;

        // --- Append to div ---
        div.appendChild(label);
        div.appendChild(inputElement);
        return div;
    }

    // Internal handler called by execute button click or form submission
    private handleExecuteTool(): void {
        if (!this.selectedTool || !this.actions) return;

        const params: { [key: string]: any } = {};
        const formElements = this.toolParamsForm.elements;
        let isValid = true;

        for (let i = 0; i < formElements.length; i++) {
            const element = formElements[i] as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
            if (!element.name) continue;

            let value: any;
            const schema = this.selectedTool.inputSchema?.properties?.[element.name];
            const type = schema?.type || 'string';

            if (element.type === 'checkbox') {
                value = (element as HTMLInputElement).checked;
            } else {
                value = element.value;
            }

            if (element.required && (value === '' || value === null || value === undefined)) {
                isValid = false;
                element.reportValidity?.(); // Use browser validation UI
                 this.logger?.LogWarning(log => log(element.name), `Empty input for required field: ${element.name}`, "View", "Validation");
            } else if (value !== '' && value !== null && value !== undefined) {
                // Type conversion
                try {
                    if (type === 'number' || type === 'integer') {
                        value = parseFloat(value);
                        if (isNaN(value)) throw new Error('Invalid number');
                    } else if (type === 'boolean' && element.type !== 'checkbox') {
                        // Handle boolean from select/text (shouldn't happen often with checkbox)
                        value = value.toLowerCase() === 'true';
                    }
                    // Add other type conversions (e.g., array from string) if needed
                } catch (e: any) {
                    isValid = false;
                    element.reportValidity?.();
                     this.logger?.LogError(log => log(element.name), `Invalid value for ${element.name}: ${e.message}`, "View", "Validation");
                }
            }
            params[element.name] = value;
        }

        if (isValid) {
            this.clearError('col3');
            this.showExecutingTool(); // Show executing message
            this.actions.onExecuteTool(params);
        } else {
             this.showError("Please fix the errors in the parameters.", false, 'col3');
        }
    }

    // Called by orchestrator before sending execute request
    public showExecutingTool(): void {
        this.clearError('col3');
        this.toolExecutingMsg.style.display = 'block';
        this.toolResultArea.style.display = 'none';
        this.executeToolBtn.disabled = true;
    }

    // Called by orchestrator when tool execution result (success/error) is received
    public displayToolResult(result: { status: 'success'; data: any } | { status: 'error'; message: string; details?: any }): void {
        this.toolExecutingMsg.style.display = 'none';
        this.toolResultArea.style.display = 'block';
        this.executeToolBtn.disabled = false;

        if (result.status === 'success') {
            this.toolResultOutput.textContent = JSON.stringify(result.data, null, 2);
            this.clearError('col3'); // Clear error display
            this.toolResultOutput.style.display = 'block';
        } else {
             const errorMsg = `${result.message}${result.details ? '\nDetails: ' + JSON.stringify(result.details, null, 2) : ''}`;
             this.showError(errorMsg, false, 'col3');
             this.toolResultOutput.style.display = 'none';
        }
         this.toolResultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // --- Argument Input Handling (Internal UI) ---

    // Adds a new argument input field to the list
    public addArgumentInput(value = ''): void {
        const li = document.createElement('li');
        const input = document.createElement('input');
        input.type = 'text';
        input.value = value;
        input.placeholder = 'Argument';
        input.classList.add('arg-input-dynamic');

        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'X';
        removeBtn.classList.add('remove-arg-btn');
        removeBtn.title = 'Remove Argument';
        removeBtn.addEventListener('click', () => {
            li.remove();
            this.actions?.onArgumentInputChange(); // Notify controller after removal
        });

        li.appendChild(input);
        li.appendChild(removeBtn);
        this.argsList.appendChild(li);
        // Should we disable based on lockUI instead?
        // input.disabled = this.testConnectionBtn.disabled;
        // removeBtn.disabled = this.testConnectionBtn.disabled;
    }

    // Disables all dynamic argument inputs and remove buttons
    private disableArgumentInputs(): void {
        this.argsList.querySelectorAll<HTMLInputElement>('.arg-input-dynamic').forEach(input => input.disabled = true);
        this.argsList.querySelectorAll<HTMLButtonElement>('.remove-arg-btn').forEach(button => button.disabled = true);
    }

    // Enables all dynamic argument inputs and remove buttons
    private enableArgumentInputs(): void {
        this.argsList.querySelectorAll<HTMLInputElement>('.arg-input-dynamic').forEach(input => input.disabled = false);
        this.argsList.querySelectorAll<HTMLButtonElement>('.remove-arg-btn').forEach(button => button.disabled = false);
    }

    // NEW Helper: Clear Columns 2 & 3 on disconnect/server change
    public clearToolListAndExecution(): void {
        this.toolsListArea.style.display = 'none';
        this.toolsListUl.innerHTML = '';
        this.toolsErrorMsg.style.display = 'none';
        this.toolExecutionArea.style.display = 'none';
        this.toolSelectPrompt.style.display = 'block';
        this.toolResultArea.style.display = 'none';
        this.toolExecutingMsg.style.display = 'none';
        this.toolResultError.style.display = 'none';
        this.selectedTool = null;
        this.currentTools = [];
        this.executeToolBtn.disabled = true;
    }

    // --- Utility / Helper Methods ---

    // lockUI (Updated selectors, added serverListUl)
    private lockUI(lock: boolean): void {
        const elementsToLock: Array<HTMLInputElement | HTMLSelectElement | HTMLButtonElement> = [
             this.serverNameInput, this.transportSelect, this.commandInput,
             this.addArgBtn, this.saveServerBtn, this.testConnectionBtn,
             this.listToolsBtn,
             this.executeToolBtn
        ];

        this.serverListUl.style.pointerEvents = lock ? 'none' : 'auto';
        this.toolsListUl.style.pointerEvents = lock ? 'none' : 'auto';
        this.argsList.style.pointerEvents = lock ? 'none' : 'auto';

        elementsToLock.forEach(el => { if (el) el.disabled = lock; });

         const columns = document.querySelectorAll('.column');
         columns.forEach(col => col.classList.toggle('locked', lock));

         // Always keep Add Server button enabled
         this.addServerBtn.disabled = false;
    }

    // NEW: Get all data from the server config form
    public getServerFormData(): McpServerConfig {
        const id = this.currentSelectedServerId || 'new';
        const name = this.serverNameInput.value.trim();
        const transport = this.transportSelect.value;
        const command = this.commandInput.value.trim();
        const args = this.getAllArguments();
        const env = this.getAllEnvironmentVariables();
        return { id, name, transport, command, args, env };
    }

    // ADDED: Highlight selected server (public)
    public setSelectedServer(serverId: string | null): void {
        this.currentSelectedServerId = serverId;
        const items = this.serverListUl.querySelectorAll('.server-item');
        items.forEach(item => {
            if (item.getAttribute('data-server-id') === serverId) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
        this.connectionDetailsDiv.style.display = serverId ? 'block' : 'none';
        // Reset connection status indicator when selection changes
        this.statusIndicator.className = 'status-indicator';
        // Only clear form if *nothing* is selected (handled by controller on Add)
        // if (!serverId) { this.clearServerForm(); }
    }

    // ADDED: Populate the form with server details (public)
    public populateServerForm(config: McpServerConfig): void {
        this.clearError(); // Clear errors when loading new data
        this.serverNameInput.value = config.name;
        this.transportSelect.value = config.transport;
        this.commandInput.value = config.command;
        this.renderArgumentInputs(config.args);
        this.renderEnvironmentVariables(config.env || {});
        this.saveServerBtn.textContent = "Update Server";
        this.connectionDetailsDiv.style.display = 'block';
        this.testConnectionBtn.disabled = false; // Enable connection test for selected server
        this.statusIndicator.className = 'status-indicator'; // Reset status on select
    }

    // ADDED: Clear the server form (public)
    public clearServerForm(): void {
        this.clearError(); // Clear Col 1 errors
        this.serverNameInput.value = '';
        this.transportSelect.value = 'STDIO';
        this.commandInput.value = '';
        this.renderArgumentInputs([]);
        this.renderEnvironmentVariables({});
        this.saveServerBtn.textContent = "Add Server";
        this.connectionDetailsDiv.style.display = 'block'; // Keep visible for adding
        this.testConnectionBtn.disabled = true; // Disable test until saved/selected
        this.statusIndicator.className = 'status-indicator';
        this.currentSelectedServerId = null; // Ensure internal view state is cleared
    }

    // Helper: Clear error messages from specified columns or all
    private clearError(targetColumn?: 'col1' | 'col2' | 'col3'): void {
        const clearDiv = (div: HTMLDivElement) => {
            if (div) {
                div.textContent = '';
                div.style.display = 'none';
            }
        };
        if (!targetColumn || targetColumn === 'col1') clearDiv(this.errorMessageDiv);
        if (!targetColumn || targetColumn === 'col2') clearDiv(this.toolsErrorMsg);
        if (!targetColumn || targetColumn === 'col3') clearDiv(this.toolResultError);
    }

    // *** NEW METHOD START ***
    /**
     * Renders the list of servers in the UI.
     * @param servers - The array of server configurations to display.
     * @param currentSelectedServerId - The ID of the server currently selected (if any).
     */
    public renderServerList(servers: McpServerConfig[], currentSelectedServerId: string | null): void {
        this.logger?.LogDebug((a,b)=>a(b), `Rendering server list with ${servers.length} servers. Selected: ${currentSelectedServerId}`, "View", "Render");
        this.serverListUl.innerHTML = ''; // Clear the current list

        if (servers.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'No servers configured. Click "+" to add one.';
            li.style.fontStyle = 'italic';
            this.serverListUl.appendChild(li);
            this.connectionDetailsDiv.style.display = 'none'; // Hide details if no servers
        }

        servers.forEach(server => {
            const li = document.createElement('li');
            li.classList.add('server-item', 'list-group-item', 'd-flex', 'justify-content-between', 'align-items-center');
            li.setAttribute('data-server-id', server.id);

            const nameSpan = document.createElement('span');
            nameSpan.textContent = server.name;
            nameSpan.classList.add('server-name'); // Add class for styling/selection

            const buttonsDiv = document.createElement('div');
            buttonsDiv.classList.add('server-item-buttons');

            const connectBtn = document.createElement('button');
            connectBtn.innerHTML = '<i class="fas fa-plug"></i>'; // Using Font Awesome icon
            connectBtn.classList.add('btn', 'btn-sm', 'connect-btn');
            connectBtn.setAttribute('aria-label', `Connect to ${server.name}`);
            connectBtn.title = `Connect to ${server.name}`; // Tooltip

            const editBtn = document.createElement('button');
            editBtn.innerHTML = '<i class="fas fa-edit"></i>'; // Using Font Awesome icon
            editBtn.classList.add('btn', 'btn-sm', 'edit-btn');
            editBtn.setAttribute('aria-label', `Edit ${server.name}`);
            editBtn.title = `Edit ${server.name}`; // Tooltip

            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>'; // Using Font Awesome icon
            deleteBtn.classList.add('btn', 'btn-sm', 'delete-btn');
            deleteBtn.setAttribute('aria-label', `Delete ${server.name}`);
            deleteBtn.title = `Delete ${server.name}`; // Tooltip

            buttonsDiv.appendChild(connectBtn);
            buttonsDiv.appendChild(editBtn);
            buttonsDiv.appendChild(deleteBtn);

            li.appendChild(nameSpan);
            li.appendChild(buttonsDiv);

            if (server.id === currentSelectedServerId) {
                li.classList.add('active'); // Bootstrap class for selected item
                // If a server is selected, ensure the details form is visible
                this.connectionDetailsDiv.style.display = '';
            }

            // Add event listeners only to the buttons
            connectBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.actions?.onConnectServer(server.id);
            });

            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.actions?.onSelectServer(server.id);
            });

            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete server "${server.name}"?`)) {
                    this.actions?.onDeleteServer(server.id);
                }
            });

            this.serverListUl.appendChild(li);
        });

        // If no server is selected after rendering, but there are servers, hide details
        if (!currentSelectedServerId && servers.length > 0) {
            // Don't hide if a server was just added/saved (controller handles showing form)
            // Only hide if explicitly no server is selected (e.g. after deletion of selected)
            // Let the controller decide visibility via populate/clear form methods
        } else if (servers.length > 0 && currentSelectedServerId) {
            this.connectionDetailsDiv.style.display = ''; // Ensure visible if selection exists
        }
    }
    // *** NEW METHOD END ***

    // ADDED: Hide the server form
    public hideServerForm(): void {
        this.connectionDetailsDiv.style.display = 'none';
    }

    // Add new method to update server connection state
    public updateServerConnectionState(serverId: string, state: 'connecting' | 'connected' | 'disconnected'): void {
        const serverItem = this.serverListUl.querySelector(`[data-server-id="${serverId}"]`);
        if (!serverItem) return;

        // Remove all connection-related classes
        serverItem.classList.remove('connecting', 'connected');

        // Add appropriate class based on state
        if (state === 'connecting') {
            serverItem.classList.add('connecting');
            // Add spinner to name span
            const nameSpan = serverItem.querySelector('.server-name');
            if (nameSpan) {
                const spinner = document.createElement('span');
                spinner.classList.add('spinner');
                nameSpan.insertBefore(spinner, nameSpan.firstChild);
            }
        } else if (state === 'connected') {
            serverItem.classList.add('connected');
            // Remove spinner if it exists
            const spinner = serverItem.querySelector('.spinner');
            if (spinner) {
                spinner.remove();
            }
        } else {
            // Remove spinner if it exists
            const spinner = serverItem.querySelector('.spinner');
            if (spinner) {
                spinner.remove();
            }
        }
    }
}

// Note: No instantiation or error handling here. Orchestrator (mcp_tester.ts) handles it.
// Removed the final console.log as it's not necessary after initialization logging. 