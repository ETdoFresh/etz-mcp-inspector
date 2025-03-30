// src/mcp-ui.ts

// Define the structure for tool definitions needed by the UI
// (Could be shared in a types file later)
export interface UIToolDefinition {
    name: string;
    description: string;
    inputSchema?: any; // Keeping schema handling logic within UI for now
}

// Define the structure for callbacks the UI needs to trigger actions
export interface McpUIActions {
    onAddArgument: () => void;
    onTestConnection: (args: string[]) => void; // Passes current args
    onListTools: () => void;
    onExecuteTool: (params: { [key: string]: any }) => void;
    onToolSelected: (toolIndex: number) => void; // To notify the orchestrator
    onArgumentInputChange: () => string[]; // Callback to get current args for saving
}

export class McpUIController {
    // --- UI Elements --- Declare properties
    private transportSelect: HTMLSelectElement;
    private commandInput: HTMLInputElement;
    private addArgBtn: HTMLButtonElement;
    private argsList: HTMLUListElement;
    private testConnectionBtn: HTMLButtonElement;
    private statusIndicator: HTMLSpanElement;
    private errorMessageDiv: HTMLDivElement;
    private connectingOverlay: HTMLDivElement;
    private container: HTMLDivElement;
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

    private actions: McpUIActions | null = null;
    private currentTools: UIToolDefinition[] = []; // Store tools locally for rendering
    private selectedTool: UIToolDefinition | null = null; // Store selected tool locally
    private isListingToolsState: boolean = false; // Track if listTools is in progress

    constructor() {
        // --- Get all elements --- Assign properties in constructor
        // Throws error if any element is missing
        this.transportSelect = this.getElement('transport', HTMLSelectElement);
        this.commandInput = this.getElement('command', HTMLInputElement);
        this.addArgBtn = this.getElement('add-arg-btn', HTMLButtonElement);
        this.argsList = this.getElement('args-list', HTMLUListElement);
        this.testConnectionBtn = this.getElement('test-connection-btn', HTMLButtonElement);
        this.statusIndicator = this.getElement('status-indicator', HTMLSpanElement);
        this.errorMessageDiv = this.getElement('error-message', HTMLDivElement);
        this.connectingOverlay = this.getElement('connecting-overlay', HTMLDivElement);
        this.container = this.getElement('mcp-tester-container', HTMLDivElement);
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

        // Do not bind listeners here; wait for actions to be registered.
        // this.setInitialState(); // Call explicitly after construction if needed
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

        // --- Configuration Listeners ---
        this.addArgBtn.addEventListener('click', () => {
            this.addArgumentInput(); // Add input field locally
            // No need to call action here, onArgumentInputChange handles notifying orchestrator
        });

        this.testConnectionBtn.addEventListener('click', () => {
            const currentArgs = this.getAllArguments();
            // Notify orchestrator to save args and attempt connection
            this.actions!.onTestConnection(currentArgs);
        });

        // Listener for changes in argument inputs or removals
        this.argsList.addEventListener('input', (event) => {
            if ((event.target as HTMLElement).classList.contains('arg-input-dynamic')) {
                this.actions?.onArgumentInputChange(); // Notify orchestrator that args changed
            }
        });
        this.argsList.addEventListener('click', (event) => {
             if ((event.target as HTMLElement).classList.contains('remove-arg-btn')) {
                 // Removal is handled within addArgumentInput's listener
                 // But we still notify that args changed overall
                 this.actions?.onArgumentInputChange();
             }
         });

        // --- Tool Interaction Listeners ---
        this.listToolsBtn.addEventListener('click', () => this.actions!.onListTools());

        this.executeToolBtn.addEventListener('click', () => this.handleExecuteTool());

        this.toolParamsForm.addEventListener('submit', (e) => {
            e.preventDefault(); // Prevent default form submission
            this.handleExecuteTool(); // Trigger execution logic
        });

        // Note: Tool selection listener is added dynamically in renderToolList
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
        } else {
             // Optionally add one empty input if list is empty?
             // this.addArgumentInput('');
        }
    }

    // --- UI State Update Methods --- Called by Orchestrator via Callbacks

    public setInitialState(): void {
        this.listToolsBtn.disabled = true;
        this.listToolsBtn.style.display = 'none';
        this.executeToolBtn.disabled = true;
        this.connectingOverlay.style.display = 'none';
        this.container.classList.remove('locked');
        this.errorMessageDiv.style.display = 'none';
        this.toolsListArea.style.display = 'none';
        this.toolExecutionArea.style.display = 'none';
        this.toolResultArea.style.display = 'none';
        this.toolExecutingMsg.style.display = 'none';
        this.toolsLoadingMsg.style.display = 'none';
        this.toolsErrorMsg.style.display = 'none';
        this.statusIndicator.className = 'status-indicator'; // Reset status
        this.isListingToolsState = false;
    }

    public showConnecting(): void {
        this.statusIndicator.className = 'status-indicator'; // Reset to default (pulsing)
        this.errorMessageDiv.style.display = 'none'; // Hide previous errors
        this.errorMessageDiv.textContent = '';
        this.listToolsBtn.style.display = 'none'; // Hide buttons
        this.listToolsBtn.disabled = true;
        this.toolsListArea.style.display = 'none'; // Hide tool areas
        this.toolExecutionArea.style.display = 'none';
        this.executeToolBtn.disabled = true;
        this.connectingOverlay.style.display = 'flex'; // Show overlay
        this.container.classList.add('locked'); // Lock container inputs
        this.testConnectionBtn.disabled = true; // Disable connection button
        this.addArgBtn.disabled = true; // Disable arg button
        this.disableArgumentInputs(); // Disable arg inputs/remove buttons
        this.isListingToolsState = false; // Reset listing state
    }

    public showConnected(isConnected: boolean): void {
        console.log(`[UI] showConnected called with isConnected: ${isConnected}`);
        this.connectingOverlay.style.display = 'none'; // Hide overlay
        this.container.classList.remove('locked'); // Unlock container
        this.testConnectionBtn.disabled = false; // Enable connection button
        this.addArgBtn.disabled = false; // Enable arg button
        this.enableArgumentInputs(); // Enable arg inputs

        console.log(`[UI] Current statusIndicator className BEFORE change: ${this.statusIndicator.className}`);
        if (isConnected) {
            this.statusIndicator.className = 'status-indicator connected';
            console.log(`[UI] Set statusIndicator className to: ${this.statusIndicator.className}`);
            // Clear transient connection errors if they were displayed
            if (this.errorMessageDiv.textContent?.includes('connection failed') || this.errorMessageDiv.textContent?.includes('Could not initiate')) {
                this.errorMessageDiv.style.display = 'none';
                this.errorMessageDiv.textContent = '';
            }
            this.listToolsBtn.style.display = 'inline-block'; // Show list tools button
            this.listToolsBtn.disabled = false; // Enable it
            // Keep execute button disabled until a tool is selected
            this.executeToolBtn.disabled = !this.selectedTool;
        } else {
            // This block shouldn't run when called with `true`
            this.statusIndicator.className = 'status-indicator error'; // Show error status
            console.log(`[UI] Set statusIndicator className to (error state): ${this.statusIndicator.className}`);
        }
        this.isListingToolsState = false; // Reset listing state
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
        this.container.classList.remove('locked'); // Ensure container is unlocked
        this.testConnectionBtn.disabled = false; // Re-enable config controls
        this.addArgBtn.disabled = false;
        this.enableArgumentInputs();
        this.currentTools = []; // Clear internal tool state
        this.selectedTool = null;
        this.isListingToolsState = false; // Reset listing state
    }

    public showError(error: string, isConnectionError: boolean): void {
        this.errorMessageDiv.textContent = `Error: ${error}`; // Display the error message
        this.errorMessageDiv.style.display = 'block';

        // Reset UI elements based on the type of error
        if (isConnectionError) {
            // If it's a fundamental connection error, reset to a disconnected-like state
            this.connectingOverlay.style.display = 'none'; // Hide overlay
            this.container.classList.remove('locked'); // Unlock container
            this.testConnectionBtn.disabled = false; // Enable config controls
            this.addArgBtn.disabled = false;
            this.enableArgumentInputs();
            this.statusIndicator.className = 'status-indicator error'; // Show error status
            // Ensure tool/execution areas are hidden
            this.listToolsBtn.style.display = 'none';
            this.listToolsBtn.disabled = true;
            this.toolsListArea.style.display = 'none';
            this.toolExecutionArea.style.display = 'none';
            this.executeToolBtn.disabled = true;
        } else {
             // For non-connection errors (e.g., failed POST, command error during execution)
             this.toolExecutingMsg.style.display = 'none'; // Ensure executing message is hidden
             // Re-enable execute button *only if* a tool is still selected (connection state managed by orchestrator)
             this.executeToolBtn.disabled = !this.selectedTool;
        }
        this.isListingToolsState = false; // Reset listing state on any error
    }

     public showLogMessage(source: string, content: string): void {
         console.log(`UI Log (${source}): ${content}`); // Keep console log for debugging
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
        this.isListingToolsState = true; // Set listing state flag
        this.toolsListArea.style.display = 'block'; // Show the area
        this.toolsListUl.innerHTML = ''; // Clear previous list results
        this.toolsErrorMsg.style.display = 'none'; // Hide previous errors
        this.toolsLoadingMsg.textContent = 'Fetching tools...'; // Show loading message
        this.toolsLoadingMsg.style.display = 'block';
        this.listToolsBtn.disabled = true; // Disable button while fetching
        this.toolExecutionArea.style.display = 'none'; // Hide execution area
        this.currentTools = []; // Reset internal tool state
        this.selectedTool = null;
    }

    // Check if UI is currently in the process of listing tools
    public isListingTools(): boolean {
        return this.isListingToolsState; // Return the flag state
    }

    public renderToolList(tools: UIToolDefinition[]): void {
        this.isListingToolsState = false; // Reset listing state flag
        this.toolsLoadingMsg.style.display = 'none'; // Hide loading message
        this.listToolsBtn.disabled = false; // Re-enable list button
        this.toolsListUl.innerHTML = ''; // Clear previous list/loading
        this.toolsErrorMsg.style.display = 'none'; // Hide error message
        this.currentTools = tools; // Store tools locally for rendering form later

        if (!tools || tools.length === 0) {
            this.toolsLoadingMsg.textContent = 'No tools available from the client.'; // Show message
            this.toolsLoadingMsg.style.display = 'block';
        } else {
            tools.forEach((tool, index) => {
                const li = document.createElement('li');
                // Basic styling, can be enhanced with CSS classes
                li.style.cssText = 'margin-bottom: 10px; cursor: pointer; padding: 8px; border-radius: 4px; border: 1px solid transparent;';
                li.setAttribute('data-tool-index', index.toString());
                li.title = 'Click to select this tool';

                const toolInfo = document.createElement('div');
                toolInfo.innerHTML = `<strong>${tool.name}:</strong> ${tool.description || '<em>No description provided</em>'}`;
                li.appendChild(toolInfo);

                // Render parameters from inputSchema (expects JSON Schema object)
                if (tool.inputSchema && typeof tool.inputSchema === 'object' && tool.inputSchema.properties) {
                    this.renderSchemaParamsList(li, tool.inputSchema);
                } else {
                     const noParamsMsg = document.createElement('div');
                     noParamsMsg.textContent = ' (No input parameters defined)';
                     noParamsMsg.style.cssText = 'font-size: 0.9em; font-style: italic; margin-left: 20px;';
                     li.appendChild(noParamsMsg);
                }

                // Add click listener for selection
                li.addEventListener('click', () => {
                    // Remove highlight from previously selected item
                    this.toolsListUl.querySelectorAll('li').forEach(item => {
                        item.style.backgroundColor = 'transparent';
                        item.style.border = '1px solid transparent';
                    });
                    // Highlight newly selected item
                    li.style.backgroundColor = 'var(--hover-bg)'; // Use a theme variable for highlight
                    li.style.border = '1px solid var(--input-border)';
                    // Call internal handler to update state and render form
                    this.handleToolSelect(index);
                });
                this.toolsListUl.appendChild(li);
            });
        }
    }

    // Helper to render parameter list for display within the tool list item
    private renderSchemaParamsList(parentLi: HTMLLIElement, schema: any): void {
         const properties = schema.properties as { [key: string]: any };
         const requiredParams = schema.required || [];
         const paramNames = Object.keys(properties);

         if (paramNames.length > 0) {
             const paramsUl = document.createElement('ul');
             paramsUl.style.cssText = 'margin-left: 20px; margin-top: 5px; list-style-type: circle;';

             paramNames.forEach((paramName) => {
                 const paramSchema = properties[paramName];
                 const isRequired = requiredParams.includes(paramName);
                 const paramType = paramSchema.type || 'any';
                 const paramDescription = paramSchema.description || ''; // Get description

                 const paramLi = document.createElement('li');
                 paramLi.style.cssText = 'font-size: 0.9em; margin-bottom: 3px;';
                 const requiredStar = isRequired ? '<span style="color:red;" title="Required">*</span>' : '';
                 // Display name, type, required status, and description
                 paramLi.innerHTML = `<em>${paramName} (${paramType})${requiredStar}</em>: ${paramDescription}`;
                 paramsUl.appendChild(paramLi);
             });
             parentLi.appendChild(paramsUl);
         } else {
             // Optionally indicate if schema exists but has no properties
             const noParamsMsg = document.createElement('div');
             noParamsMsg.textContent = ' (No input parameters defined in schema)';
             noParamsMsg.style.cssText = 'font-size: 0.9em; font-style: italic; margin-left: 20px;';
             parentLi.appendChild(noParamsMsg);
         }
    }


    public showToolListError(errorMessage: string): void {
        this.isListingToolsState = false; // Reset listing state flag
        this.toolsLoadingMsg.style.display = 'none'; // Hide loading message
        this.toolsErrorMsg.textContent = `Failed to list tools: ${errorMessage}`; // Show error
        this.toolsErrorMsg.style.display = 'block';
        this.listToolsBtn.disabled = false; // Re-enable list button so user can try again
        this.toolsListUl.innerHTML = ''; // Clear any potential partial list
        this.currentTools = []; // Reset internal state
        this.selectedTool = null;
    }

    // --- Tool Selection and Execution --- (Internal UI Logic)

    // Called when a tool <li> element is clicked
    private handleToolSelect(toolIndex: number): void {
        if (toolIndex < 0 || toolIndex >= this.currentTools.length) {
            console.error('Invalid tool index selected in UI:', toolIndex);
            return;
        }
        this.selectedTool = this.currentTools[toolIndex]; // Update internal selected tool state
        console.log('UI selected tool:', this.selectedTool);

        // Notify the orchestrator about the selection
        this.actions?.onToolSelected(toolIndex);

        // Update UI elements for the selected tool
        this.selectedToolNameSpan.textContent = this.selectedTool.name;
        this.toolParamsForm.innerHTML = ''; // Clear old form fields
        this.toolResultArea.style.display = 'none'; // Hide previous results
        this.toolResultOutput.textContent = '';
        this.toolResultError.style.display = 'none';
        this.toolResultError.textContent = '';
        this.toolExecutingMsg.style.display = 'none'; // Hide executing message
        // Enable execute button (connection status is handled by orchestrator enable/disable)
        this.executeToolBtn.disabled = false;

        // Render the form based on the selected tool's schema
        this.renderToolForm(this.selectedTool);

        // Show the execution area and scroll to it
        this.toolExecutionArea.style.display = 'block';
        this.toolExecutionArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Renders the parameters form based on the tool's inputSchema
    private renderToolForm(tool: UIToolDefinition): void {
        // Expect inputSchema to be a JSON Schema object with properties
        if (tool.inputSchema && typeof tool.inputSchema === 'object' && tool.inputSchema.properties) {
            const properties = tool.inputSchema.properties as { [key: string]: any };
            const requiredParams = new Set(tool.inputSchema.required || []);
            const paramNames = Object.keys(properties);

            if (paramNames.length > 0) {
                paramNames.forEach((paramName) => {
                    const paramSchema = properties[paramName];
                    // Create the form group (label + input) for this parameter
                    const formGroup = this.createFormElement(paramName, paramSchema, requiredParams.has(paramName));
                    this.toolParamsForm.appendChild(formGroup);
                });
            } else {
                this.toolParamsForm.innerHTML = '<p><em>This tool takes no parameters (schema properties empty).</em></p>';
            }
        } else {
            // Handle cases where schema is missing, not an object, or has no properties
            console.warn("Tool schema is not a valid JSON Schema object or is missing. Cannot render form accurately.", tool.inputSchema);
             this.toolParamsForm.innerHTML = '<p><em>This tool takes no defined parameters.</em></p>';
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
        if (!this.selectedTool) { console.error("UI Execute error: No tool selected."); return; }

        // Use HTML5 form validation before proceeding
        if (!this.toolParamsForm.checkValidity()) {
             this.toolParamsForm.reportValidity(); // Show browser validation messages
             return;
        }

        // Update UI to show executing state *before* calling action
        this.showExecutingTool();

        // Collect parameters from the form
        const formData = new FormData(this.toolParamsForm);
        const params: { [key: string]: any } = {};

        // Process parameters based on the *selected tool's schema*
        if (this.selectedTool.inputSchema && typeof this.selectedTool.inputSchema === 'object' && this.selectedTool.inputSchema.properties) {
            const properties = this.selectedTool.inputSchema.properties as { [key: string]: any };
            Object.keys(properties).forEach((paramName) => {
                const paramSchema = properties[paramName];
                const value = formData.get(paramName) as string | null; // Get raw value from form

                // Only include parameters that have a non-empty value
                // Check required fields are handled by checkValidity()
                if (value !== null && value !== '') {
                    const paramType = paramSchema.type || 'string'; // Default to string
                    try {
                        // --- Type Conversion based on Schema ---
                        if (paramType === 'number' || paramType === 'integer') {
                            const numValue = parseFloat(value);
                            if (!isNaN(numValue)) { // Ensure conversion is valid
                                params[paramName] = numValue;
                            } else {
                                console.warn(`Invalid number input for ${paramName}: '${value}'. Skipping.`);
                                // Optionally show an error to the user here instead of just console warning
                            }
                        } else if (paramType === 'boolean') {
                            // Handle 'true'/'false' strings from select dropdown
                            params[paramName] = value.toLowerCase() === 'true';
                        } else if (paramType === 'array') {
                            // Split by comma, trim whitespace, filter empty strings
                             const itemType = paramSchema.items?.type || 'string';
                             params[paramName] = value.split(',')
                                .map(s => s.trim()) // Trim whitespace
                                .filter(s => s !== '') // Remove empty strings
                                .map(item => { // Attempt type conversion for array items if needed
                                     if (itemType === 'number' || itemType === 'integer') {
                                         const numItem = parseFloat(item);
                                         return isNaN(numItem) ? null : numItem; // Return null if conversion fails
                                     }
                                     if (itemType === 'boolean') return item.toLowerCase() === 'true';
                                     // TODO: Handle nested objects/arrays if schema allows?
                                     return item; // Default to string
                                 })
                                 .filter(item => item !== null); // Filter out items that failed conversion (e.g., NaN)

                        } else { // Default to string (includes 'string' type)
                            params[paramName] = value;
                        }
                    } catch (e) {
                        console.error(`Error processing parameter ${paramName} with value '${value}':`, e);
                        // Optionally show an error to the user
                        this.showError(`Error processing parameter ${paramName}. Check console.`, false);
                    }
                }
                 // If value is null or empty, but the field was *required*, checkValidity should have caught it.
                 // If it was optional and empty, we simply don't include it in the params.
            });
        } else {
             // This case should ideally not happen if a tool was selected, but log it.
             console.warn("Cannot collect parameters: Tool inputSchema is missing, not an object, or has no properties.", this.selectedTool.inputSchema);
        }

        // Notify the orchestrator to actually execute the tool with the collected params
        this.actions?.onExecuteTool(params);
    }

    // Called by orchestrator before sending execute request
    public showExecutingTool(): void {
        this.toolResultArea.style.display = 'none'; // Hide previous results
        this.toolResultOutput.textContent = '';
        this.toolResultError.style.display = 'none';
        this.toolResultError.textContent = '';
        this.toolExecutingMsg.style.display = 'block'; // Show "Executing..." indicator
        this.executeToolBtn.disabled = true; // Disable button while executing
    }

    // Called by orchestrator when tool execution result (success/error) is received
    public displayToolResult(result: { status: 'success'; data: any } | { status: 'error'; message: string; details?: any }): void {
        this.toolExecutingMsg.style.display = 'none'; // Hide "Executing..."
        // Re-enable execute button (orchestrator checks connection status)
        this.executeToolBtn.disabled = false;
        this.toolResultArea.style.display = 'block'; // Show result area

        if (result.status === 'success') {
            let outputData = '';
            // Attempt to pretty-print JSON objects/arrays
            if (typeof result.data === 'object' && result.data !== null) {
                try { outputData = JSON.stringify(result.data, null, 2); } // Pretty print with 2 spaces
                catch { outputData = String(result.data); } // Fallback for complex objects that fail stringify
            } else {
                outputData = String(result.data ?? ''); // Handle null/undefined/primitive types
            }
            this.toolResultOutput.textContent = outputData; // Display in output area
            this.toolResultError.style.display = 'none'; // Hide error area
            this.toolResultError.textContent = '';
        } else { // status === 'error'
            this.toolResultOutput.textContent = ''; // Clear success output area
            let errorContent = `Error: ${result.message || 'Execution failed'}`;
            if (result.details) {
                let detailsString = '';
                // Try to pretty-print error details if they are object/array
                if (typeof result.details === 'object' && result.details !== null) {
                    try { detailsString = JSON.stringify(result.details, null, 2); }
                    catch { detailsString = String(result.details); } // Fallback
                } else {
                    detailsString = String(result.details);
                }
                errorContent += `\nDetails: ${detailsString}`;
            }
            this.toolResultError.textContent = errorContent; // Display error content
            this.toolResultError.style.display = 'block'; // Show error area
        }
        // Scroll the results area into view
        this.toolResultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }


    // --- Argument Input Handling (Internal UI) ---

    // Adds a new argument input field to the list
    public addArgumentInput(value = ''): void {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.marginBottom = '5px';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = value;
        input.placeholder = 'Enter argument';
        input.className = 'arg-input-dynamic'; // Class for identification and event delegation
        input.style.cssText = 'flex-grow: 1; margin-right: 5px; padding: 8px; border: 1px solid var(--input-border); border-radius: 3px; background-color: var(--input-bg); color: var(--text-color);';
        // Check if input should be disabled (e.g., during connection attempt)
        input.disabled = this.testConnectionBtn.disabled; // Disable if connect button is disabled

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '-';
        removeBtn.title = 'Remove Argument';
        removeBtn.className = 'remove-arg-btn'; // Class for identification
        removeBtn.type = 'button'; // Important: Prevent form submission if argsList is somehow inside a form
        removeBtn.style.cssText = 'padding: 5px 8px; background-color: var(--button-bg); color: var(--button-text); border: none; border-radius: 3px; cursor: pointer; font-size: 0.9em; line-height: 1;';
        // Disable button based on connection button state
        removeBtn.disabled = this.testConnectionBtn.disabled;

        // Add listener to remove the <li> element when remove button is clicked
        removeBtn.addEventListener('click', () => {
             li.remove();
             // No need to call action here, parent listener on argsList handles notification
        });

        li.appendChild(input);
        li.appendChild(removeBtn);
        this.argsList.appendChild(li);

        // Focus the newly added input field
        if (!input.disabled) { // Only focus if not disabled
             input.focus();
        }

        // Notify orchestrator AFTER adding the input (via delegated listener is better)
        // this.actions?.onArgumentInputChange?.();
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
}

// Note: No instantiation or error handling here. Orchestrator (mcp_tester.ts) handles it.
console.log("McpUIController class defined."); 