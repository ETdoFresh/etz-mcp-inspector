// No longer need express types, rely on JS duck typing or JSDoc if needed
const http = require('http');
const { spawn } = require('child_process');
const url = require('url');

/**
 * @typedef {object} SseClient
 * @property {string} id
 * @property {import('express').Response} response
 * @property {import('child_process').ChildProcessWithoutNullStreams | null} mcpProcess
 */

/** @type {Map<string, SseClient>} */
const clients = new Map();

function generateClientId() {
    return Math.random().toString(36).substring(2, 15);
}

/**
 * @param {SseClient} client
 * @param {string} type
 * @param {any} payload
 */
function sendSseMessage(client, type, payload) {
    const message = JSON.stringify({ type, payload });
    console.log(`SSE > Client ${client.id}:`, message);
    // Check if response stream is still writable
    if (client.response.writable) {
        client.response.write(`data: ${message}\n\n`);
    } else {
        console.warn(`[MCP Proxy] Attempted to write to closed SSE stream for client ${client.id}`);
        // Optional: Clean up client if stream is closed unexpectedly
        if (client.mcpProcess) {
            console.log(`[MCP Proxy] Killing MCP process (PID: ${client.mcpProcess.pid}) due to closed SSE stream for client ${client.id}.`);
            client.mcpProcess.kill();
        }
        clients.delete(client.id);
    }
}

// --- Main Middleware Function ---
/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function mcpProxyHandler(req, res, next) {
    console.log(`[MCP Proxy Handler] Incoming request: ${req.method} ${req.url}`);

    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname !== '/mcp-proxy') {
        // Not our path, pass to next middleware (e.g., static file serving)
        console.log(`[MCP Proxy Handler] Path ${parsedUrl.pathname} does not match /mcp-proxy. Passing to next().`);
        return next();
    }

    console.log(`[MCP Proxy] Handling ${req.method} request for ${req.url}`);

    // --- Handle SSE Connection (GET) ---
    if (req.method === 'GET') {
        // --- Initial SSE Setup ---
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.flushHeaders(); // Ensure headers are sent immediately

        const clientId = generateClientId();
        /** @type {SseClient} */
        const newClient = { id: clientId, response: res, mcpProcess: null };
        clients.set(clientId, newClient);
        console.log(`[MCP Proxy] Client ${clientId} connected via SSE.`);

        // --- Extract Config from Query ---
        const { transport, command, args: argsString } = parsedUrl.query;

        if (typeof command !== 'string' || !command) {
            sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: 'Missing or invalid "command" query parameter.' });
            if (res.writable) res.end(); // Close connection if config is bad
            clients.delete(clientId);
            console.error(`[MCP Proxy] Client ${clientId} disconnected: Bad configuration.`);
            return;
        }

        let parsedArgs = [];
        if (typeof argsString === 'string') {
            try {
                parsedArgs = JSON.parse(argsString);
                if (!Array.isArray(parsedArgs)) throw new Error('Args must be a JSON array.');
            } catch (e) {
                sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: `Invalid "args" query parameter (must be JSON array): ${e.message}` });
                if (res.writable) res.end();
                clients.delete(clientId);
                console.error(`[MCP Proxy] Client ${clientId} disconnected: Bad args format.`);
                return;
            }
        }

        console.log(`[MCP Proxy] Client ${clientId} Config: transport=${transport}, command=${command}, args=${JSON.stringify(parsedArgs)}`);

        // --- Spawn MCP Process (Only STDIO supported for now) ---
        // Convert transport to lowercase for case-insensitive comparison
        const transportLower = typeof transport === 'string' ? transport.toLowerCase() : '';

        if (transportLower === 'stdio') {
            try {
                console.log(`[MCP Proxy] Spawning process for client ${clientId}: ${command} ${parsedArgs.join(' ')}`);
                // Add { shell: true } option for Windows compatibility with commands like npx
                const mcpProcess = spawn(command, parsedArgs, {
                     stdio: ['pipe', 'pipe', 'pipe'],
                     shell: true
                });
                newClient.mcpProcess = mcpProcess; // Assign the process to the client state

                sendSseMessage(newClient, 'connectionStatus', { status: 'connected' });
                console.log(`[MCP Proxy] Process spawned for client ${clientId} (PID: ${mcpProcess.pid})`);

                // --- Handle STDIO ---
                mcpProcess.stdout.on('data', (data) => {
                    const lines = data.toString().split(/\r?\n/); // Split by newline, handle CRLF
                    lines.forEach((line) => {
                        if (line.trim()) {
                             console.log(`[MCP Process ${mcpProcess.pid} STDOUT] ${line}`);
                             try {
                                // Attempt to parse as JSON, assuming JSON-RPC messages
                                const jsonMessage = JSON.parse(line);
                                // Re-wrap for SSE transport
                                sendSseMessage(newClient, 'mcpMessage', jsonMessage);
                             } catch (e) {
                                // If not JSON, send as a generic log message
                                console.warn(`[MCP Proxy] Non-JSON output from PID ${mcpProcess.pid}: ${line}`);
                                sendSseMessage(newClient, 'logMessage', { source: 'stdout', content: line });
                             }
                        }
                    });
                });

                mcpProcess.stderr.on('data', (data) => {
                    const message = data.toString();
                    console.error(`[MCP Process ${mcpProcess.pid} STDERR] ${message}`);
                    sendSseMessage(newClient, 'logMessage', { source: 'stderr', content: message });
                });

                mcpProcess.on('error', (err) => {
                    console.error(`[MCP Process ${mcpProcess.pid || 'unknown'} ERROR] Failed to start or runtime error:`, err);
                    // Check if client still exists before sending message
                    if (clients.has(clientId)) {
                        sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: `Process error: ${err.message}` });
                    }
                    clients.delete(clientId);
                    newClient.mcpProcess = null; // Ensure no further interaction
                    if (res.writable) res.end(); // Close SSE connection
                });

                mcpProcess.on('close', (code) => {
                    console.log(`[MCP Process ${mcpProcess.pid || 'unknown'} CLOSE] Exited with code ${code}`);
                    // Check if client still exists before sending message
                    if (clients.has(clientId)) {
                         sendSseMessage(newClient, 'connectionStatus', { status: 'disconnected', code: code });
                    }
                    clients.delete(clientId);
                    newClient.mcpProcess = null;
                    if (res.writable) res.end(); // Close SSE connection
                });

            } catch (error) {
                console.error(`[MCP Proxy] Failed to spawn process for client ${clientId}:`, error);
                 // Check if client still exists before sending message
                 if (clients.has(clientId)) {
                    sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: `Failed to spawn process: ${error.message}` });
                 }
                clients.delete(clientId);
                if (res.writable) res.end();
            }
        } else {
            // Handle other transports (e.g., 'sse' to MCP server) or error
            const errorMsg = `Unsupported transport type: ${transport}. Only 'stdio' is currently supported.`;
            console.error(`[MCP Proxy] ${errorMsg} for client ${clientId}`);
            sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: errorMsg });
            clients.delete(clientId);
            if (res.writable) res.end();
        }

        // --- Handle Client Disconnect ---
        req.on('close', () => {
            console.log(`[MCP Proxy] Client ${clientId} disconnected (SSE connection closed).`);
            const client = clients.get(clientId);
            if (client?.mcpProcess) {
                console.log(`[MCP Proxy] Killing MCP process (PID: ${client.mcpProcess.pid}) for client ${clientId}.`);
                client.mcpProcess.kill(); // Terminate the child process
            }
            clients.delete(clientId);
        });

    // --- Handle Commands (POST) ---
    } else if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            console.log(`[MCP Proxy] Received POST data: ${body}`);
            let requestData;
            try {
                requestData = JSON.parse(body);
            } catch (e) {
                console.error('[MCP Proxy] Invalid POST JSON:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON in request body.' }));
                return;
            }

            // --- Find the target client/process ---
            // !! Assumption: Only one client/process active for simplicity !!
            /** @type {SseClient | undefined} */
            let targetClient;
            if (clients.size === 1) {
                targetClient = clients.values().next().value;
            } else if (clients.size === 0) {
                 console.error('[MCP Proxy] POST received but no active clients/processes.');
                 res.writeHead(409, { 'Content-Type': 'application/json' }); // 409 Conflict
                 res.end(JSON.stringify({ status: 'error', message: 'No active MCP connection.' }));
                 return;
            } else {
                 console.error('[MCP Proxy] POST received but multiple clients connected. Routing not implemented.');
                 res.writeHead(501, { 'Content-Type': 'application/json' }); // 501 Not Implemented
                 res.end(JSON.stringify({ status: 'error', message: 'Multiple clients active; cannot route command.' }));
                 return;
            }


            if (!targetClient || !targetClient.mcpProcess || targetClient.mcpProcess.killed || !targetClient.mcpProcess.stdin.writable) {
                 const reason = !targetClient ? "No target client" :
                                !targetClient.mcpProcess ? "No MCP process object" :
                                targetClient.mcpProcess.killed ? "MCP process killed" :
                                !targetClient.mcpProcess.stdin.writable ? "MCP process stdin not writable" :
                                "Unknown reason";
                console.error(`[MCP Proxy] Cannot handle POST for client ${targetClient?.id}: MCP process unavailable (${reason}).`);
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: `MCP process is not running or connection lost (${reason}).` }));
                return;
            }

            // --- Construct JSON-RPC message and send to MCP stdin ---
             const jsonRpcRequest = {
                 jsonrpc: "2.0",
                 id: requestData.id || `req-${Date.now()}`, // Use provided ID or generate one
                 method: requestData.type, // e.g., "listTools", "executeTool"
                 params: requestData.payload // e.g., {}, { toolName: "...", params: {...} }
             };

             const messageString = JSON.stringify(jsonRpcRequest) + '\n'; // Add newline delimiter

             console.log(`[MCP Proxy] > MCP Process ${targetClient.mcpProcess.pid} STDIN: ${messageString.trim()}`);

             try {
                targetClient.mcpProcess.stdin.write(messageString, (err) => {
                     if (err) {
                         console.error(`[MCP Proxy] Error writing to MCP process ${targetClient?.mcpProcess?.pid} stdin:`, err);
                          if (clients.has(targetClient.id)) { // Check if client still connected
                             sendSseMessage(targetClient, 'commandError', { type: requestData.type, error: `Failed to write to MCP process: ${err.message}` });
                          }
                         // Avoid writing headers if already sent
                         if (!res.headersSent) {
                             res.writeHead(500, { 'Content-Type': 'application/json' });
                             res.end(JSON.stringify({ status: 'error', message: `Internal server error writing to process: ${err.message}` }));
                         }
                     } else {
                         console.log(`[MCP Proxy] Successfully sent command '${requestData.type}' to MCP process ${targetClient?.mcpProcess?.pid}.`);
                         // Avoid writing headers if already sent
                          if (!res.headersSent) {
                             res.writeHead(200, { 'Content-Type': 'application/json' });
                             res.end(JSON.stringify({ status: 'success', message: `Command '${requestData.type}' sent to MCP.` }));
                         }
                     }
                 });
             } catch (error) {
                console.error(`[MCP Proxy] Exception writing to MCP process ${targetClient?.mcpProcess?.pid} stdin:`, error);
                if (clients.has(targetClient.id)) {
                    sendSseMessage(targetClient, 'commandError', { type: requestData.type, error: `Internal exception writing to MCP process: ${error.message}` });
                }
                // Avoid writing headers if already sent
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: `Internal server exception writing to process: ${error.message}` }));
                }
             }
        });

    // --- Handle other methods ---
    } else {
        console.warn(`[MCP Proxy] Unsupported method: ${req.method}`);
        res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET, POST' }); // Method Not Allowed
        res.end(JSON.stringify({ status: 'error', message: `Method ${req.method} not allowed for /mcp-proxy.` }));
    }
}

// Export using CommonJS module.exports
module.exports = { mcpProxyHandler }; 