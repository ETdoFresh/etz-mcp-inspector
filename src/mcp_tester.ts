import './theme-toggle';

document.addEventListener('DOMContentLoaded', () => {
    const transportSelect = document.getElementById('transport') as HTMLSelectElement | null;
    const commandInput = document.getElementById('command') as HTMLInputElement | null;
    const argInput = document.getElementById('arg-input') as HTMLInputElement | null;
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

    // Early exit if essential elements are missing
    if (!transportSelect || !commandInput || !argInput || !addArgBtn || !argsList || !testConnectionBtn ||
        !statusIndicator || !errorMessageDiv || !connectingOverlay || !container || !listToolsBtn ||
        !toolsListArea || !toolsListUl || !toolsLoadingMsg || !toolsErrorMsg) {
        console.error("MCP Tester initialization failed: One or more required elements are missing from the DOM.");
        return;
    }

    const currentArgs: string[] = [];
    let isConnected = false;

    // Function to add argument to the list
    const addArgument = () => {
        // Null checks already performed at the top level
        const argValue = argInput.value.trim();
        if (argValue) {
            currentArgs.push(argValue);
            const listItem = document.createElement('li');
            listItem.textContent = argValue;
            argsList.appendChild(listItem);
            argInput.value = ''; // Clear input field
            argInput.focus();
        }
    };

    // Event listener for the Add Argument button
    // Null check performed at top level
    addArgBtn.addEventListener('click', addArgument);

    // Event listener for pressing Enter in the argument input field
    // Null check performed at top level
    argInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // Prevent form submission if it were in a form
            addArgument();
        }
    });

    // Function to simulate testing the connection
    const testConnection = () => {
        // Null checks performed at top level
        // 1. Reset status
        isConnected = false;
        statusIndicator.className = 'status-indicator'; // Reset to default
        errorMessageDiv.style.display = 'none';
        errorMessageDiv.textContent = '';
        listToolsBtn.style.display = 'none';
        toolsListArea.style.display = 'none';

        // 2. Lock UI and show overlay
        connectingOverlay.style.display = 'flex';
        container.classList.add('locked');
        testConnectionBtn.disabled = true;
        addArgBtn.disabled = true;

        // Get current values
        const transport = transportSelect.value;
        const command = commandInput.value.trim();

        console.log('Attempting connection with:');
        console.log('Transport:', transport);
        console.log('Command:', command);
        console.log('Arguments:', currentArgs);

        // --- Simulate asynchronous connection attempt ---
        setTimeout(() => {
            const isSuccess = Math.random() > 0.3; // 70% chance of success for demo

            // 3. Unlock UI and hide overlay (check elements again just in case, though unlikely needed after top check)
            if (!connectingOverlay || !container || !testConnectionBtn || !addArgBtn || !statusIndicator || !errorMessageDiv || !listToolsBtn) return;

            connectingOverlay.style.display = 'none';
            container.classList.remove('locked');
            testConnectionBtn.disabled = false;
            addArgBtn.disabled = false;

            if (isSuccess) {
                console.log('Connection successful!');
                isConnected = true;
                statusIndicator.classList.add('connected'); // Green dot
                listToolsBtn.style.display = 'inline-block';
            } else {
                console.error('Connection failed.');
                isConnected = false;
                statusIndicator.classList.add('error'); // Red dot
                errorMessageDiv.textContent = 'Error: Failed to connect to the server. Check command and arguments.'; // Example error
                errorMessageDiv.style.display = 'block';
                listToolsBtn.style.display = 'none';
            }
        }, 2000); // Simulate a 2-second connection attempt
        // --- End simulation ---
    };

    // --- Function to simulate listing tools ---
    const listTools = () => {
        // Null checks performed at top level
        if (!isConnected) {
            toolsErrorMsg.textContent = 'Error: Not connected to server.';
            toolsErrorMsg.style.display = 'block';
            toolsListArea.style.display = 'block';
            toolsListUl.innerHTML = '';
            toolsLoadingMsg.style.display = 'none';
            return;
        }

        // Show loading state
        toolsListArea.style.display = 'block';
        toolsListUl.innerHTML = '';
        toolsErrorMsg.style.display = 'none';
        toolsLoadingMsg.textContent = 'Fetching tools...';
        toolsLoadingMsg.style.display = 'block';
        listToolsBtn.disabled = true;

        console.log('Requesting tool list...');

        // Simulate async fetch
        setTimeout(() => {
            // Check elements again before manipulating in async callback
             if (!toolsLoadingMsg || !listToolsBtn || !toolsErrorMsg || !toolsListUl) return;

            const fetchSuccess = Math.random() > 0.2; // 80% chance of success for demo

            toolsLoadingMsg.style.display = 'none';
            listToolsBtn.disabled = false;

            if (fetchSuccess) {
                console.log('Tool list received.');
                // Example tool data - replace with actual data from server
                const exampleTools = [
                    { name: 'readFile', description: 'Reads a file from the local system.' },
                    { name: 'writeFile', description: 'Writes content to a file.' },
                    { name: 'runCommand', description: 'Executes a shell command.' },
                    { name: 'listFiles', description: 'Lists files in a directory.' }
                ];

                if (exampleTools.length === 0) {
                    toolsLoadingMsg.textContent = 'No tools available on this server.';
                    toolsLoadingMsg.style.display = 'block';
                } else {
                    exampleTools.forEach(tool => {
                        const li = document.createElement('li');
                        li.textContent = `${tool.name}: ${tool.description}`;
                        toolsListUl.appendChild(li);
                    });
                }
            } else {
                console.error('Failed to fetch tool list.');
                toolsErrorMsg.textContent = 'Error: Could not retrieve tool list from the server.';
                toolsErrorMsg.style.display = 'block';
            }
        }, 1500); // Simulate 1.5 second fetch time
    };
    // --- End list tools function ---

    // Event listener for the Test Connection button
    // Null check performed at top level
    testConnectionBtn.addEventListener('click', testConnection);

    // Event listener for the List Tools button
    // Null check performed at top level
    listToolsBtn.addEventListener('click', listTools);
});

console.log("MCP Tester script loaded."); // Example placeholder 