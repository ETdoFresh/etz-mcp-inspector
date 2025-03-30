import './theme-toggle';
import { McpCommunicator, McpConnectionConfig, McpMessagePayload, McpCommunicationCallbacks } from './mcp-communication';
import { McpUIController, McpUIActions, UIToolDefinition } from './mcp-ui'; // Import the new UI controller

document.addEventListener('DOMContentLoaded', () => {
    // --- localStorage Keys ---
    const LS_TRANSPORT_KEY = 'mcpTesterTransport';
    const LS_COMMAND_KEY = 'mcpTesterCommand';
    const LS_ARGS_KEY = 'mcpTesterArgs';

    // --- Initialize Core Components ---
    let uiController: McpUIController;
    const mcpCommunicator = new McpCommunicator();

    try {
        // Instantiate UI controller - this finds and verifies all DOM elements
        uiController = new McpUIController();
        // Set the initial UI state right after construction
        uiController.setInitialState();
    } catch (error: any) {
        console.error("Failed to initialize UI Controller:", error);
        // UI Controller constructor already handles displaying the error in the body if elements are missing
        return; // Stop execution if UI fails
    }

    // --- State Variables (Orchestrator Level) ---
    // These track the state received from the communicator or selected via UI actions
    let currentTools: UIToolDefinition[] = []; // Store the latest tool list from communicator
    let selectedTool: UIToolDefinition | null = null; // Store the selected tool detail

    // --- Load Settings from localStorage ---
    // Use UI controller methods to apply saved settings
    const savedTransport = localStorage.getItem(LS_TRANSPORT_KEY);
    if (savedTransport) { uiController.setTransport(savedTransport); }

    const savedCommand = localStorage.getItem(LS_COMMAND_KEY);
    if (savedCommand) { uiController.setCommand(savedCommand); }

    const savedArgsString = localStorage.getItem(LS_ARGS_KEY);
    if (savedArgsString) {
        try {
            const savedArgs = JSON.parse(savedArgsString);
            if (Array.isArray(savedArgs)) {
                // Use UI controller method to populate argument fields
                uiController.renderArgumentInputs(savedArgs);
            } else {
                 localStorage.removeItem(LS_ARGS_KEY); // Clear invalid data
            }
        } catch (e) {
            console.error("Failed to parse saved arguments from localStorage:", e);
            localStorage.removeItem(LS_ARGS_KEY); // Clear invalid data
        }
    } else {
         // Ensure the UI reflects no saved args if none are found
         uiController.renderArgumentInputs([]);
    }


    // --- Define UI Actions (Callbacks passed TO the UI Controller) ---
    // These functions are called BY the UI controller when the user interacts with elements
    const uiActions: McpUIActions = {
        // Called by UI when Add Argument button is clicked (after UI adds the input)
        onAddArgument: () => {
            saveCurrentArguments(); // Save args whenever one is added
        },
        // Called by UI when Test Connection button is clicked
        onTestConnection: (currentArgs: string[]) => {
            saveCurrentArguments(currentArgs); // Save config just before connecting
            attemptConnection(); // Trigger the connection process
        },
        // Called by UI when List Tools button is clicked
        onListTools: () => {
            listTools(); // Trigger the tool listing process
        },
        // Called by UI when Execute Tool button or form is submitted (after UI collects params)
        onExecuteTool: (params: { [key: string]: any }) => {
            executeTool(params); // Trigger the tool execution process
        },
        // Called by UI when a tool is clicked in the list
        onToolSelected: (toolIndex: number) => {
            // Update orchestrator's internal state based on UI selection
            if (toolIndex >= 0 && toolIndex < currentTools.length) {
                selectedTool = currentTools[toolIndex];
                console.log("Orchestrator state updated for selected tool:", selectedTool);
            } else {
                 console.error("Invalid tool index received from UI:", toolIndex);
                 selectedTool = null; // Reset if index is invalid
            }
             // UI controller already updated its internal state and rendered the form
        },
         // Called by UI whenever an argument input changes or is added/removed
        onArgumentInputChange: () => {
             // Save the current arguments whenever they change
             const currentArgs = uiController.getAllArguments();
             saveCurrentArguments(currentArgs);
             return currentArgs; // Return them (might be useful for UI controller if needed)
        }
    };
    // --- Register Actions with UI Controller ---
    // This allows the UI controller to call the functions defined above
    uiController.registerActions(uiActions);

    // --- Define Communication Callbacks (Callbacks passed TO the Communicator) ---
    // These functions are called BY the Communicator when events occur on the SSE connection or during POST requests
    const communicationCallbacks: McpCommunicationCallbacks = {
        // Called when communicator starts attempting connection
        onConnecting: () => {
            uiController.showConnecting(); // Update UI to show "Connecting..." state
        },
        // Called when SSE connection is successfully opened
        onConnected: () => {
            console.log("Orchestrator: onConnected callback triggered.");
            uiController.showConnected(true); // Update UI to show "Connected" state
        },
        // Called when the underlying client process disconnects or communicator closes connection
        onDisconnected: (code) => {
            uiController.showDisconnected(code); // Update UI to show "Disconnected" state
            currentTools = []; // Clear tool state on disconnect
            selectedTool = null;
        },
        // Called on SSE errors or errors sending POST requests
        onError: (error, isConnectionError) => {
            uiController.showError(error, isConnectionError); // Update UI to show error message
             if (isConnectionError) {
                 currentTools = []; // Clear tool state on connection error
                 selectedTool = null;
             }
             // UI controller handles disabling buttons etc. based on error type
        },
        // Called when a message from the MCP process itself is received via the proxy
        onMcpMessage: (mcpData) => {
            handleMcpProcessMessage(mcpData); // Pass the parsed MCP message to the handler
        },
        // Called when the proxy sends a log message (e.g., stderr from client)
        onLogMessage: (source, content) => {
            uiController.showLogMessage(source, content); // Pass log to UI for display
        }
        // Optional: onCommandError callback could be added if specific handling is needed
    };

    // --- Core Logic / Orchestration Functions ---

    // Saves the current arguments from the UI to localStorage
    function saveCurrentArguments(args?: string[]): void {
        try {
            const argsToSave = args ?? uiController.getAllArguments();
            localStorage.setItem(LS_ARGS_KEY, JSON.stringify(argsToSave));
        } catch (e) {
             console.error("Error saving arguments to localStorage:", e);
        }
    }

    // Initiates the connection process using the communicator
    const attemptConnection = () => {
        // Get connection details from the UI controller's current state
        const config: McpConnectionConfig = {
            transport: uiController.getTransport(),
            command: uiController.getCommand(),
            args: uiController.getAllArguments() // Get potentially updated args
        };
        // Start the connection attempt, providing the callbacks
        mcpCommunicator.connect(config, communicationCallbacks);
    };

    // Handles messages originating from the MCP client process (received via proxy & communicator)
    function handleMcpProcessMessage(mcpData: McpMessagePayload) {
        console.log(`Orchestrator handling MCP Message (ID: ${mcpData.id}, Method: ${mcpData.method})`, mcpData);

        if (mcpData.result !== undefined || mcpData.error !== undefined) {
            // --- JSON-RPC Response ---
            // We assume responses are for either 'tools/list' or 'tools/call'
            // TODO: Implement request ID correlation for robust handling if multiple requests can be in flight

            // Heuristic: Check if the result looks like a 'tools/list' response
            if (mcpData.result?.tools && Array.isArray(mcpData.result.tools)) {
                // Update orchestrator's tool list state
                currentTools = mcpData.result.tools as UIToolDefinition[];
                selectedTool = null; // Reset selected tool when list updates
                // Tell UI controller to render the new list
                uiController.renderToolList(currentTools);
            }
            // Heuristic: Assume other successful results are from 'tools/call'
            else if (mcpData.result !== undefined) {
                // Tell UI controller to display the successful result
                uiController.displayToolResult({ status: 'success', data: mcpData.result });
            }
            // Handle error responses
            else if (mcpData.error) {
                 console.error('MCP Error Response:', mcpData.error);
                 // Heuristic: Check if UI was in 'listing tools' state when error arrived
                 if (uiController.isListingTools()) {
                     // Tell UI controller to show an error in the tool list area
                     uiController.showToolListError(mcpData.error.message || 'Unknown MCP Error');
                 } else {
                    // Assume error was for tool execution, tell UI controller to display error in result area
                    uiController.displayToolResult({ status: 'error', message: mcpData.error.message || 'Unknown MCP Error', details: mcpData.error.data });
                 }
                 currentTools = []; // Clear tools on any MCP error for safety? Maybe too broad.
                 selectedTool = null;
            } else {
                // Should not happen if (mcpData.result !== undefined || mcpData.error !== undefined) is true
                console.warn('Received MCP response with undefined result/error despite check:', mcpData);
            }

        } else if (mcpData.method) {
            // --- JSON-RPC Notification ---
            // Handle notifications sent *from* the MCP process *to* the UI
            console.log(`Handling MCP Notification (Method: ${mcpData.method})`);
            // Example:
            // switch (mcpData.method) {
            //    case 'taskProgressUpdate':
            //        uiController.showProgress(mcpData.params); // Need to add showProgress to UIController
            //        break;
            //    case 'logMessage': // If MCP sends logs via notifications
            //        uiController.showLogMessage('mcp_notification', mcpData.params?.message || JSON.stringify(mcpData.params));
            //        break;
            //    default:
            //         console.warn("Unhandled MCP notification method:", mcpData.method);
            // }
        } else {
            // Message doesn't fit JSON-RPC Response or Notification structure
            console.warn('Received unknown data structure from MCP via proxy:', mcpData);
            uiController.showLogMessage('mcp_raw', `Received unknown data structure: ${JSON.stringify(mcpData)}`);
        }
    }

    // Initiates the 'tools/list' request
    const listTools = () => {
        // Check connection state via communicator before sending
        if (!mcpCommunicator.isConnected) {
            uiController.showError("Not connected. Cannot list tools.", false);
            return;
        }
        // Tell UI to show the "Fetching tools..." state
        uiController.showFetchingTools();
        // Send the request via the communicator
        mcpCommunicator.sendRequestToBackend('tools/list', {});
        // The response will arrive asynchronously and be handled by handleMcpProcessMessage via the onMcpMessage callback
    };

    // Initiates the 'tools/call' request
    const executeTool = async (params: { [key: string]: any }) => {
        // Ensure a tool is actually selected in the orchestrator state
        if (!selectedTool) {
            console.error("Execute error: No tool selected in orchestrator state.");
            uiController.showError("Internal Error: No tool selected.", false); // Show error in UI
            return;
        }
        // Check connection state via communicator
        if (!mcpCommunicator.isConnected) {
            uiController.showError("Not connected. Cannot execute tool.", false);
            return;
        }

        // UI controller already called showExecutingTool() before calling this action via uiActions.onExecuteTool

        // Send the 'tools/call' request via the communicator
        const result = await mcpCommunicator.sendRequestToBackend('tools/call', {
            name: selectedTool.name, // Use name from orchestrator state
            arguments: params       // Use params collected by UI controller
        });

        // If the sendRequestToBackend itself failed (e.g., network error before sending),
        // the onError callback will have already triggered uiController.showError.
        // If the send was successful (result.success is true), we simply wait for the
        // MCP response message to arrive via the SSE connection, which will trigger
        // handleMcpProcessMessage -> uiController.displayToolResult.
        if (!result.success) {
             // Log the failure, UI error is handled by the onError callback
             console.error("Failed to send 'tools/call' request:", result.error);
             // Ensure UI is not stuck in 'executing' state if send failed immediately
             // (onError callback should handle this, but double-check needed?)
             // uiController.displayToolResult({ status: 'error', message: `Failed to send request: ${result.error}` });
        }
    };

    // --- Event Listeners (Configuration Persistence) ---
    // Add listeners to the config elements obtained from the UI controller
    // Save changes to localStorage when these inputs change
    uiController.getTransportElement().addEventListener('change', () => {
        localStorage.setItem(LS_TRANSPORT_KEY, uiController.getTransport());
    });
    uiController.getCommandElement().addEventListener('input', () => {
        localStorage.setItem(LS_COMMAND_KEY, uiController.getCommand());
    });
    // Argument saving is handled by the onArgumentInputChange callback in uiActions

    // --- Final Initialization Log ---
    console.log("MCP Tester orchestrator initialized and ready.");
});
