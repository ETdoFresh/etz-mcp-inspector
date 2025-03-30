import './theme-toggle';

document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements --- Get all elements first
    const transportSelect = document.getElementById('transport') as HTMLSelectElement | null;
    const commandInput = document.getElementById('command') as HTMLInputElement | null;
    const addArgBtn = document.getElementById('add-arg-btn') as HTMLButtonElement | null;
    const argsList = document.getElementById('args-list') as HTMLUListElement | null;
    const testConnectionBtn = document.getElementById('test-connection-btn') as HTMLButtonElement | null;
    const statusIndicator = document.getElementById('status-indicator') as HTMLSpanElement | null;
    const errorMessageDiv = document.getElementById('error-message') as HTMLDivElement | null;
    const connectingOverlay = document.getElementById('connecting-overlay') as HTMLDivElement | null;
    const container = document.getElementById('mcp-tester-container') as HTMLDivElement | null;
    const listToolsBtn = document.getElementById('list-tools-btn') as HTMLButtonElement | null;
    const toolsListArea = document.getElementById('tools-list-area') as HTMLDivElement | null;
    const toolsListUl = document.getElementById('tools-list') as HTMLUListElement | null;
    const toolsLoadingMsg = document.getElementById('tools-loading-message') as HTMLDivElement | null;
    const toolsErrorMsg = document.getElementById('tools-error-message') as HTMLDivElement | null;
    const toolExecutionArea = document.getElementById('tool-execution-area') as HTMLDivElement | null;
    const selectedToolNameSpan = document.getElementById('selected-tool-name') as HTMLSpanElement | null;
    const toolParamsForm = document.getElementById('tool-params-form') as HTMLFormElement | null;
    const executeToolBtn = document.getElementById('execute-tool-btn') as HTMLButtonElement | null;
    const toolResultArea = document.getElementById('tool-result-area') as HTMLDivElement | null;
    const toolResultOutput = document.getElementById('tool-result-output') as HTMLPreElement | null;
    const toolResultError = document.getElementById('tool-result-error') as HTMLDivElement | null;
    const toolExecutingMsg = document.getElementById('tool-executing-message') as HTMLDivElement | null;

    // --- Check all elements --- Fail early if any are missing
    if (!transportSelect || !commandInput || !addArgBtn || !argsList || !testConnectionBtn ||
        !statusIndicator || !errorMessageDiv || !connectingOverlay || !container || !listToolsBtn ||
        !toolsListArea || !toolsListUl || !toolsLoadingMsg || !toolsErrorMsg || !toolExecutionArea ||
        !selectedToolNameSpan || !toolParamsForm || !executeToolBtn || !toolResultArea || !toolResultOutput ||
        !toolResultError || !toolExecutingMsg)
    {
        console.error("MCP Tester initialization failed: One or more required UI elements are missing from the DOM.");
        document.body.innerHTML = '<p style="color: red; font-weight: bold;">Initialization Error: Required UI elements are missing. Check the console.</p>';
        return;
    }

    // --- Define interfaces for clarity ---
    interface ToolParameter {
        name: string;
        type?: string; // e.g., 'string', 'number', 'boolean', 'array'
        itemType?: string; // Used when type is 'array'
        description: string;
        required?: boolean;
    }

    interface ToolDefinition {
        name: string;
        description: string;
        inputSchema?: any; // Add the actual field (using any for simplicity, could be more specific JSONSchema type)
    }
    // --- End Interfaces ---

    // --- State Variables ---
    let isConnected = false; // Reflects SSE connection to backend proxy
    let currentTools: ToolDefinition[] = [];
    let selectedTool: ToolDefinition | null = null;
    let eventSource: EventSource | null = null;
    const MCP_PROXY_PATH = '/mcp-proxy'; // Path for SSE and POST requests

    // --- Helper Functions ---
    function addArgumentInput(value = '') {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.marginBottom = '5px';

        const input = document.createElement('input');
        input.type = 'text'; input.value = value; input.placeholder = 'Enter argument';
        input.className = 'arg-input-dynamic';
        input.style.cssText = 'flex-grow: 1; margin-right: 5px; padding: 8px; border: 1px solid var(--input-border); border-radius: 3px; background-color: var(--input-bg); color: var(--text-color);';

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '-'; removeBtn.title = 'Remove Argument'; removeBtn.className = 'remove-arg-btn'; removeBtn.type = 'button';
        removeBtn.style.cssText = 'padding: 5px 8px; background-color: var(--button-bg); color: var(--button-text); border: none; border-radius: 3px; cursor: pointer; font-size: 0.9em; line-height: 1;';
        removeBtn.addEventListener('click', () => li.remove());

        li.appendChild(input); li.appendChild(removeBtn);
        argsList!.appendChild(li);
        input.focus();
    }

    function getAllArguments(): string[] {
        const inputs = argsList!.querySelectorAll<HTMLInputElement>('.arg-input-dynamic');
        return Array.from(inputs).map(input => input.value.trim()).filter(value => value !== '');
    }

    // --- Core Interaction Functions ---
    const testConnection = () => {
        // Reset UI
        isConnected = false;
        statusIndicator!.className = 'status-indicator';
        errorMessageDiv!.style.display = 'none'; errorMessageDiv!.textContent = '';
        listToolsBtn!.style.display = 'none'; listToolsBtn!.disabled = true;
        toolsListArea.style.display = 'none';
        toolExecutionArea.style.display = 'none'; executeToolBtn.disabled = true;
        connectingOverlay.style.display = 'flex';
        container.classList.add('locked');
        testConnectionBtn.disabled = true;
        addArgBtn.disabled = true;

        // Get config
        const transport = transportSelect.value;
        const command = commandInput.value.trim();
        const args = getAllArguments();

        console.log('Attempting SSE connection to backend proxy...');
        console.log('Config:', { transport, command, args });

        // Close old connection
        if (eventSource) { eventSource.close(); eventSource = null; }

        // Start new connection
        try {
            const urlParams = new URLSearchParams({ transport, command, args: JSON.stringify(args) });
            const sseUrl = `${MCP_PROXY_PATH}?${urlParams.toString()}`;
            console.log('SSE URL:', sseUrl);
            eventSource = new EventSource(sseUrl);

            eventSource.onopen = () => {
                console.log('SSE connection opened.'); isConnected = true;
                connectingOverlay.style.display = 'none'; container.classList.remove('locked');
                testConnectionBtn.disabled = false; addArgBtn.disabled = false;
                statusIndicator!.className = 'status-indicator connected';
                errorMessageDiv!.style.display = 'none'; errorMessageDiv!.textContent = '';
                listToolsBtn!.style.display = 'inline-block'; listToolsBtn!.disabled = false;
                executeToolBtn.disabled = true; // Keep disabled until tool selected
            };

            eventSource.onerror = (error) => {
                console.error('SSE connection error:', error);
                isConnected = false; if (eventSource) { eventSource.close(); eventSource = null; }
                connectingOverlay.style.display = 'none'; container.classList.remove('locked');
                testConnectionBtn.disabled = false; addArgBtn.disabled = false;
                statusIndicator!.className = 'status-indicator error';
                errorMessageDiv!.textContent = 'Error: SSE connection failed. Is the backend server running? Check console.';
                errorMessageDiv!.style.display = 'block';
                listToolsBtn!.style.display = 'none'; listToolsBtn!.disabled = true;
                toolsListArea.style.display = 'none'; toolExecutionArea.style.display = 'none'; executeToolBtn.disabled = true;
            };

            eventSource.onmessage = (event) => {
                console.log('SSE message received:', event.data);
                try { handleServerMessage(JSON.parse(event.data)); }
                catch (e) { console.error('Failed to parse SSE message:', e, 'Data:', event.data); }
            };
        } catch (e) {
            console.error('Failed to initialize EventSource:', e);
            isConnected = false;
            connectingOverlay.style.display = 'none'; container.classList.remove('locked');
            testConnectionBtn.disabled = false; addArgBtn.disabled = false;
            statusIndicator!.className = 'status-indicator error';
            errorMessageDiv!.textContent = 'Error: Could not initiate connection. Check console.';
            errorMessageDiv!.style.display = 'block';
            listToolsBtn!.style.display = 'none'; listToolsBtn!.disabled = true; executeToolBtn.disabled = true;
        }
    };

    async function sendRequestToBackend(type: string, payload: any) {
        if (!isConnected) {
            console.error('Cannot send request: Not connected.');
            errorMessageDiv!.textContent = 'Error: Not connected to backend.'; errorMessageDiv!.style.display = 'block';
            return;
        }
        console.log(`Sending '${type}' request to backend:`, payload);
        try {
            const response = await fetch(MCP_PROXY_PATH, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, payload }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Backend request error: ${response.status}`, errorText);
                errorMessageDiv!.textContent = `Error sending '${type}' request: ${errorText || response.statusText}`;
                errorMessageDiv!.style.display = 'block';
            } else {
                console.log(`'${type}' request sent successfully.`);
                // Clear transient errors on success
                if (errorMessageDiv!.textContent?.startsWith("Error: Not connected")) {
                    errorMessageDiv!.style.display = 'none'; errorMessageDiv!.textContent = '';
                }
            }
        } catch (error) {
            console.error('Network error sending request:', error);
            errorMessageDiv!.textContent = `Network error sending '${type}' request. Check console.`;
            errorMessageDiv!.style.display = 'block';
        }
    }

    function handleServerMessage(message: any) {
        if (!message || !message.type) { console.warn('SSE message missing type:', message); return; }
        console.log(`Handling message type: ${message.type}`, message.payload);

        switch (message.type) {
            // --- Direct messages from the proxy --- //
            case 'connectionStatus': // Update based on spawned client status OR proxy connection itself
                console.log('Connection status update:', message.payload);
                if (message.payload.status === 'error') {
                     statusIndicator!.className = 'status-indicator error';
                     errorMessageDiv!.textContent = `Connection error: ${message.payload.error || 'Unknown error'}`;
                     errorMessageDiv!.style.display = 'block';
                     listToolsBtn!.style.display = 'none'; listToolsBtn!.disabled = true;
                     isConnected = false; // Backend proxy reported client disconnected/errored OR initial connection failed
                     // Close SSE connection if the error originated from the proxy/process management
                     if (message.payload.error && !message.payload.error.startsWith('stderr:')) { // Don't close for stderr messages
                         if (eventSource) { console.log("Closing SSE due to critical error report."); eventSource.close(); eventSource = null; }
                     }
                } else if (message.payload.status === 'connected') {
                     statusIndicator!.className = 'status-indicator connected';
                     listToolsBtn!.style.display = 'inline-block'; listToolsBtn!.disabled = false;
                     errorMessageDiv!.style.display = 'none'; // Clear previous errors on successful connect
                     isConnected = true;
                } else if (message.payload.status === 'disconnected') {
                     statusIndicator!.className = 'status-indicator';
                     errorMessageDiv!.textContent = `Client process disconnected (Code: ${message.payload.code ?? 'N/A'}). Please test connection again.`;
                     errorMessageDiv!.style.display = 'block';
                     listToolsBtn!.style.display = 'none'; listToolsBtn!.disabled = true;
                     toolExecutionArea!.style.display = 'none';
                     isConnected = false;
                     if (eventSource) { console.log("Closing SSE connection as client process ended."); eventSource.close(); eventSource = null; }
                }
                break;
            case 'logMessage':
                console.log(`Server Log (${message.payload.source}):`, message.payload.content);
                // Optional: Display logs in a dedicated area in the UI
                // We might want to display stderr logs more prominently
                if (message.payload.source === 'stderr') {
                    // Append to error message div or a dedicated log area
                    const logEntry = document.createElement('div');
                    logEntry.textContent = `[STDERR] ${message.payload.content}`;
                    logEntry.style.whiteSpace = 'pre-wrap'; // Preserve formatting
                    logEntry.style.color = 'orange'; // Distinguish stderr logs
                    // Append to a log container if exists, otherwise maybe error div
                    // Example: document.getElementById('log-output')?.appendChild(logEntry);
                    // For now, let's append to the main error display, but this could get noisy
                    // errorMessageDiv!.textContent += `\n[STDERR] ${message.payload.content}`;
                    // errorMessageDiv!.style.display = 'block';
                }
                break;
             case 'commandError': // Error reported from backend when trying to POST command to MCP
                console.error(`Backend command error for type ${message.payload.type}:`, message.payload.error);
                errorMessageDiv!.textContent = `Backend Error: Failed to send command '${message.payload.type}' to MCP process. ${message.payload.error}`;
                errorMessageDiv!.style.display = 'block';
                // Potentially disable execute button again if this happens
                executeToolBtn!.disabled = true;
                toolExecutingMsg!.style.display = 'none'; // Added !
                break;

            // --- Messages originating from the MCP process (parsed & wrapped by proxy) --- //
            case 'mcpMessage':
                console.log('Received wrapped MCP message:', message.payload);
                handleMcpProcessMessage(message.payload);
                break;

            default:
                console.warn('Unhandled SSE message type from proxy:', message.type);
        }
    }

    // New function to handle messages *from* the MCP process itself (JSON-RPC responses/notifications)
    function handleMcpProcessMessage(mcpData: any) {
        // Assuming MCP uses a structure like JSON-RPC with result/error or method/params
        if (mcpData.result !== undefined || mcpData.error !== undefined) {
             // This looks like a JSON-RPC Response
             console.log(`Handling MCP Response (ID: ${mcpData.id})`);
             // We need to correlate this response to a request (e.g., listTools, executeTool)

             // Check specifically for the tools/list response structure
             if (mcpData.result && Array.isArray(mcpData.result.tools)) {
                 // This IS the response to 'tools/list'
                 updateToolList(mcpData.result.tools as ToolDefinition[]);
             } else if (mcpData.result) {
                 // Likely the response to 'executeTool' (success)
                 // (Or some other method returning a non-array/non-tools result)
                 displayToolResult({ status: 'success', data: mcpData.result });
             } else if (mcpData.error) {
                 // Likely the response to 'executeTool' (error)
                 console.error('MCP Error Response:', mcpData.error);
                 displayToolResult({ status: 'error', message: mcpData.error.message || 'Unknown MCP Error', details: mcpData.error.data });
             } else {
                 console.warn('Unhandled MCP Response format:', mcpData);
             }
        } else if (mcpData.method) {
             // This looks like a JSON-RPC Notification (server->client without request)
             console.log(`Handling MCP Notification (Method: ${mcpData.method})`);
             // Add specific handlers here if the MCP server sends notifications
             // switch (mcpData.method) {
             //    case 'someNotification':
             //        // handle
             //        break;
             // }
        } else {
            console.warn('Received unknown data structure from MCP via proxy:', mcpData);
            // Maybe display as raw log?
            // sendSseMessage({response: null, id:'mcp', mcpProcess: null}, 'logMessage', { source: 'mcp_raw', content: JSON.stringify(mcpData) });
        }
    }

    const listTools = () => {
        toolsListArea.style.display = 'block'; toolsListUl.innerHTML = '';
        toolsErrorMsg.style.display = 'none';
        toolsLoadingMsg!.textContent = 'Fetching tools...'; toolsLoadingMsg!.style.display = 'block';
        listToolsBtn!.disabled = true;
        toolExecutionArea!.style.display = 'none';
        sendRequestToBackend('tools/list', {});
    };

    function updateToolList(tools: ToolDefinition[]) {
         console.log('Updating UI with tools:', tools);
         toolsLoadingMsg!.style.display = 'none'; listToolsBtn!.disabled = false;
         currentTools = tools;
         toolsListUl!.innerHTML = ''; toolsErrorMsg!.style.display = 'none';

         if (!tools || tools.length === 0) {
            toolsLoadingMsg!.textContent = 'No tools available from the client.';
            toolsLoadingMsg!.style.display = 'block';
        } else {
            tools.forEach((tool, index) => {
                const li = document.createElement('li');
                li.style.cssText = 'margin-bottom: 10px; cursor: pointer;';
                li.setAttribute('data-tool-index', index.toString());
                li.title = 'Click to select this tool';

                const toolInfo = document.createElement('div');
                toolInfo.innerHTML = `<strong>${tool.name}:</strong> ${tool.description}`;
                li.appendChild(toolInfo);

                // Updated logic to handle inputSchema as a JSON Schema object
                if (tool.inputSchema && typeof tool.inputSchema === 'object' && tool.inputSchema.properties) {
                    const properties = tool.inputSchema.properties as { [key: string]: any };
                    const requiredParams = tool.inputSchema.required || [];
                    const paramNames = Object.keys(properties);

                    if (paramNames.length > 0) {
                        const paramsUl = document.createElement('ul');
                        paramsUl.style.cssText = 'margin-left: 20px; margin-top: 5px; list-style-type: circle;';

                        paramNames.forEach((paramName) => {
                            const paramSchema = properties[paramName];
                            const isRequired = requiredParams.includes(paramName);
                            const paramType = paramSchema.type || 'any';
                            const paramDescription = paramSchema.description || ''; // Get description if available

                            const paramLi = document.createElement('li');
                            paramLi.style.cssText = 'font-size: 0.9em; margin-bottom: 3px;';
                            const requiredStar = isRequired ? '<span style="color:red;" title="Required">*</span>' : '';
                            // Display name, type, required status, and description
                            paramLi.innerHTML = `<em>${paramName} (${paramType})${requiredStar}</em>: ${paramDescription}`;
                            paramsUl.appendChild(paramLi);
                        });
                        li.appendChild(paramsUl);
                    } else {
                         // Optional: Add a note if schema/properties exist but are empty
                         const noParamsMsg = document.createElement('div');
                         noParamsMsg.textContent = ' (No input parameters defined)';
                         noParamsMsg.style.cssText = 'font-size: 0.9em; font-style: italic; margin-left: 20px;';
                         li.appendChild(noParamsMsg);
                    }
                }
                li.addEventListener('click', () => handleToolSelect(index));
                toolsListUl!.appendChild(li);
            });
        }
    }

    const handleToolSelect = (toolIndex: number) => {
        if (toolIndex < 0 || toolIndex >= currentTools.length) { console.error('Invalid tool index:', toolIndex); return; }
        selectedTool = currentTools[toolIndex];
        console.log('Selected tool:', selectedTool);

        selectedToolNameSpan.textContent = selectedTool.name;
        toolParamsForm.innerHTML = '';
        toolResultArea.style.display = 'none'; toolResultOutput.textContent = '';
        toolResultError.style.display = 'none'; toolResultError.textContent = '';
        executeToolBtn.disabled = !isConnected; // Should be connected to execute
        toolExecutingMsg.style.display = 'none';

        if (selectedTool.inputSchema && selectedTool.inputSchema.length > 0) {
            selectedTool.inputSchema.forEach((param: ToolParameter) => {
                const div = document.createElement('div'); div.className = 'form-group';
                const label = document.createElement('label');
                const requiredStar = param.required ? '<span style="color:red;" title="Required">*</span>' : '';
                label.innerHTML = `${param.name} (${param.type || 'any'})${requiredStar}:`;
                label.htmlFor = `param-${param.name}`; label.title = param.description;

                let inputElement: HTMLInputElement | HTMLTextAreaElement;
                const commonStyle = 'width: 100%; padding: 8px; border: 1px solid var(--input-border); border-radius: 3px; background-color: var(--input-bg); color: var(--text-color); margin-top: 5px; box-sizing: border-box;'; // Added box-sizing

                if (param.type === 'array' || (param.description || '').toLowerCase().includes('multiline')) {
                    inputElement = document.createElement('textarea'); inputElement.rows = 3;
                    inputElement.placeholder = `Enter ${param.type === 'array' ? 'comma-separated ' + (param.itemType || 'string') + 's' : 'value'}...
${param.description}`;
                } else {
                    inputElement = document.createElement('input');
                    inputElement.type = (param.type === 'number') ? 'number' : 'text';
                    inputElement.placeholder = `Enter ${param.name}... (${param.description})`;
                }
                inputElement.id = `param-${param.name}`; inputElement.name = param.name;
                inputElement.required = param.required || false;
                inputElement.style.cssText = commonStyle;

                div.appendChild(label); div.appendChild(inputElement);
                toolParamsForm.appendChild(div);
            });
        } else {
            toolParamsForm.innerHTML = '<p><em>This tool takes no parameters.</em></p>';
        }
        toolExecutionArea.style.display = 'block';
        toolExecutionArea.scrollIntoView({ behavior: 'smooth' });
    };

    const executeTool = () => {
        if (!selectedTool) { console.error("Execute error: No tool selected."); return; }
        if (!isConnected) {
             errorMessageDiv!.textContent = 'Error: Not connected. Cannot execute tool.'; errorMessageDiv!.style.display = 'block';
             console.error("Execute error: Not connected."); return;
        }
        if (!toolParamsForm.checkValidity()) { toolParamsForm.reportValidity(); return; }

        toolResultArea.style.display = 'none'; toolResultOutput.textContent = '';
        toolResultError.style.display = 'none'; toolResultError.textContent = '';
        toolExecutingMsg.style.display = 'block'; executeToolBtn.disabled = true;

        const formData = new FormData(toolParamsForm);
        const params: { [key: string]: any } = {};
        selectedTool.inputSchema?.forEach((param: ToolParameter) => {
            const value = formData.get(param.name) as string | null;
            if (value !== null && value !== '') { // Only include params with values
                 if (param.type === 'number') { params[param.name] = parseFloat(value); }
                 else if (param.type === 'boolean') { params[param.name] = value.toLowerCase() === 'true'; }
                 else if (param.type === 'array') { params[param.name] = value.split(',').map(s => s.trim()); }
                 else { params[param.name] = value; }
            }
        });

        sendRequestToBackend('executeTool', { toolName: selectedTool.name, params });
    };

    function displayToolResult(result: any) {
        console.log('Displaying tool result:', result);
        toolExecutingMsg!.style.display = 'none'; executeToolBtn!.disabled = !isConnected; // Re-enable button only if still connected
        toolResultArea!.style.display = 'block';

        if (result.status === 'success') {
            let outputData = '';
            if (typeof result.data === 'object' && result.data !== null) {
                try { outputData = JSON.stringify(result.data, null, 2); } catch { outputData = String(result.data); }
            } else { outputData = String(result.data ?? ''); }
            toolResultOutput!.textContent = outputData;
            toolResultError!.style.display = 'none'; toolResultError!.textContent = '';
        } else {
            toolResultOutput!.textContent = '';
            toolResultError!.textContent = `Error: ${result.message || 'Execution failed'}`;
            let detailsString = '';
            if (result.details) {
                if (typeof result.details === 'object') { try { detailsString = JSON.stringify(result.details, null, 2); } catch { detailsString = String(result.details); } } // Pretty print details too
                else { detailsString = String(result.details); }
                toolResultError!.textContent += `
Details: ${detailsString}`;
            }
            toolResultError!.style.display = 'block';
        }
        toolResultArea!.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // --- Event Listeners ---
    addArgBtn.addEventListener('click', () => addArgumentInput());
    testConnectionBtn.addEventListener('click', testConnection);
    listToolsBtn.addEventListener('click', listTools);
    executeToolBtn.addEventListener('click', executeTool);
    toolParamsForm.addEventListener('submit', (e) => { e.preventDefault(); executeTool(); });

    // --- Initial State --- (e.g., disable buttons)
    listToolsBtn.disabled = true;
    executeToolBtn.disabled = true;

    console.log("MCP Tester script loaded and initialized.");
}); 