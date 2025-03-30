document.addEventListener('DOMContentLoaded', () => {
    const transportSelect = document.getElementById('transport');
    const commandInput = document.getElementById('command');
    const argInput = document.getElementById('arg-input');
    const addArgBtn = document.getElementById('add-arg-btn');
    const argsList = document.getElementById('args-list');
    const testConnectionBtn = document.getElementById('test-connection-btn');
    const statusIndicator = document.getElementById('status-indicator');
    const errorMessageDiv = document.getElementById('error-message');
    const connectingOverlay = document.getElementById('connecting-overlay');
    const container = document.getElementById('mcp-tester-container');
    const listToolsBtn = document.getElementById('list-tools-btn');
    const toolsListArea = document.getElementById('tools-list-area');
    const toolsListUl = document.getElementById('tools-list');
    const toolsLoadingMsg = document.getElementById('tools-loading-message');
    const toolsErrorMsg = document.getElementById('tools-error-message');

    const currentArgs = [];
    let isConnected = false;

    // Function to add argument to the list
    const addArgument = () => {
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
    addArgBtn.addEventListener('click', addArgument);

    // Event listener for pressing Enter in the argument input field
    argInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // Prevent form submission if it were in a form
            addArgument();
        }
    });

    // Function to simulate testing the connection
    const testConnection = () => {
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

            // 3. Unlock UI and hide overlay
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
    testConnectionBtn.addEventListener('click', testConnection);

    // Event listener for the List Tools button
    listToolsBtn.addEventListener('click', listTools);
}); 