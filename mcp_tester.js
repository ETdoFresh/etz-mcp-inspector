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

    const currentArgs = [];

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
        statusIndicator.className = 'status-indicator'; // Reset to default
        errorMessageDiv.style.display = 'none';
        errorMessageDiv.textContent = '';

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
        // Replace this with your actual connection logic
        setTimeout(() => {
            // Simulate success or failure randomly (or based on input)
            const isSuccess = Math.random() > 0.3; // 70% chance of success for demo

            // 3. Unlock UI and hide overlay
            connectingOverlay.style.display = 'none';
            container.classList.remove('locked');
            testConnectionBtn.disabled = false;
            addArgBtn.disabled = false;

            if (isSuccess) {
                console.log('Connection successful!');
                statusIndicator.classList.add('connected'); // Green dot
            } else {
                console.error('Connection failed.');
                statusIndicator.classList.add('error'); // Red dot
                errorMessageDiv.textContent = 'Error: Failed to connect to the server. Check command and arguments.'; // Example error
                errorMessageDiv.style.display = 'block';
            }
        }, 2000); // Simulate a 2-second connection attempt
        // --- End simulation --- 
    };

    // Event listener for the Test Connection button
    testConnectionBtn.addEventListener('click', testConnection);
}); 