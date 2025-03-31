const http = require('http');
const url = require('url');
// Try requiring the main SDK entry point
const mcpSdk = require('@modelcontextprotocol/sdk');
const { StdioClientTransport, getDefaultEnvironment } = mcpSdk.client.stdio;
const { findActualExecutable } = require('spawn-rx');
const { parse: shellParseArgs } = require('shell-quote');

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('@modelcontextprotocol/sdk/shared/transport').Transport} McpTransport
 */

/**
 * @typedef {object} SseClient
 * @property {string} id
 * @property {Response} response - Express Response object for SSE
 * @property {McpTransport | null} mcpTransport - Transport to the MCP server process
 */

/**
 * @typedef {object} JsonRpcRequest
 * @property {string} jsonrpc
 * @property {string} method
 * @property {any} [params]
 * @property {string | number} [id]
 */

// Get default environment from SDK, potentially merged with custom vars later
const defaultEnvironment = {
  ...getDefaultEnvironment(),
  // Add any base environment variables for your proxy here if needed
  // ...(process.env.MCP_PROXY_ENV_VARS ? JSON.parse(process.env.MCP_PROXY_ENV_VARS) : {}),
};

class McpProxyHandler {
    constructor() {
        /** @type {Map<string, SseClient>} */
        this.clients = new Map();
        /** @type {Map<string, McpTransport>} */
        this.clientTransports = new Map(); // Store MCP transports separately
    }

    generateClientId() {
        return Math.random().toString(36).substring(2, 15);
    }

    /**
     * @param {SseClient} client
     * @param {string} type
     * @param {any} payload
     */
    sendSseMessage(client, type, payload) {
        // Ensure client is still valid before sending
        if (!this.clients.has(client.id) || !client.response.writable) {
             console.warn(`[MCP Proxy WARN] Attempted to send SSE to disconnected/invalid client ${client.id}.`);
             this.cleanupClient(client); // Clean up if detected here
             return;
        }
        const message = JSON.stringify({ type, payload });
        console.log(`[MCP Proxy SSE] > Client ${client.id}: Type=${type}`);
        client.response.write(`data: ${message}\n\n`);
    }

    /**
     * @param {SseClient | undefined | string} clientOrId
     */
    cleanupClient(clientOrId) {
        const clientId = typeof clientOrId === 'string' ? clientOrId : clientOrId?.id;
        if (!clientId) return;

        const client = this.clients.get(clientId);
        const mcpTransport = this.clientTransports.get(clientId);

        console.log(`[MCP Proxy] Cleaning up client ${clientId}.`);

        // Close MCP Transport if it exists and hasn't been closed
        if (mcpTransport) {
            console.log(`[MCP Proxy] Closing MCP transport for client ${clientId}.`);
            mcpTransport.close().catch(err => {
                console.error(`[MCP Proxy] Error closing MCP transport for ${clientId}:`, err);
            });
            this.clientTransports.delete(clientId);
        }

        // Close SSE Response stream if it exists and is writable
        if (client && client.response.writable) {
            try {
                console.log(`[MCP Proxy] Ending SSE response stream for client ${clientId}.`);
                client.response.end();
            } catch (e) {
                console.error(`[MCP Proxy] Error ending response stream for client ${clientId}:`, e);
            }
        }

        // Remove client from map
        this.clients.delete(clientId);
        console.log(`[MCP Proxy] Client ${clientId} fully cleaned up.`);
    }

    /**
     * @param {Request} req
     * @param {Response} res
     */
    async handleGetRequest(req, res) { // Make async
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.flushHeaders();

        const clientId = this.generateClientId();
        /** @type {SseClient} */
        const newClient = { id: clientId, response: res, mcpTransport: null }; // mcpTransport will be set later
        this.clients.set(clientId, newClient);
        console.log(`[MCP Proxy] Client ${clientId} connected via SSE.`);

        req.on('close', () => {
            console.log(`[MCP Proxy] Client ${clientId} disconnected (SSE connection closed).`);
            this.cleanupClient(clientId); // Use ID for cleanup
        });

        const parsedUrl = url.parse(req.url || '', true);
        const { transport, command, args: argsString, env: envString } = parsedUrl.query;

        // --- Parameter Validation ---
        if (typeof command !== 'string' || !command) {
            this.sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: 'Missing or invalid "command" query parameter.' });
            this.cleanupClient(clientId);
            console.error(`[MCP Proxy] Client ${clientId} disconnected: Bad configuration (command).`);
            return;
        }

        let origArgs = []; // Use shell-quote for args
        if (typeof argsString === 'string') {
            try {
                // Use shellParseArgs for robust argument parsing
                const parsedShellArgs = shellParseArgs(argsString);
                // shellParseArgs returns an array of strings or objects for comments/globs, filter for strings
                origArgs = parsedShellArgs.filter(arg => typeof arg === 'string');
            } catch (e) {
                const errMsg = e instanceof Error ? e.message : String(e);
                this.sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: `Invalid "args" query parameter format: ${errMsg}` });
                this.cleanupClient(clientId);
                console.error(`[MCP Proxy] Client ${clientId} disconnected: Bad args format.`);
                return;
            }
        }

        let queryEnv = {}; // Environment from query string
        if (typeof envString === 'string') {
            try {
                queryEnv = JSON.parse(envString);
                if (typeof queryEnv !== 'object' || queryEnv === null) throw new Error('Env must be a JSON object.');
            } catch (e) {
                 const errMsg = e instanceof Error ? e.message : String(e);
                this.sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: `Invalid "env" query parameter (must be JSON object): ${errMsg}` });
                this.cleanupClient(clientId);
                console.error(`[MCP Proxy] Client ${clientId} disconnected: Bad env format.`);
                return;
            }
        }

        console.log(`[MCP Proxy] Client ${clientId} Config: transport=${transport}, command=${command}, args=${JSON.stringify(origArgs)}, env=${JSON.stringify(queryEnv)}`);

        // --- Transport Creation and Proxying ---
        try {
            const transportLower = typeof transport === 'string' ? transport.toLowerCase() : '';
            if (transportLower !== 'stdio') {
                throw new Error(`Unsupported transport type: ${transport}. Only 'stdio' is currently supported.`);
            }

            // Merge environments: process.env < defaultEnvironment < queryEnv
            const finalEnv = { ...process.env, ...defaultEnvironment, ...queryEnv };

            // Use findActualExecutable from spawn-rx
            const { cmd, args } = findActualExecutable(command, origArgs);
            console.log(`[MCP Proxy] Resolved command for client ${clientId}: ${cmd} ${args.join(' ')}`);

            // Create StdioClientTransport instance
            const mcpTransport = new StdioClientTransport({
                command: cmd,
                args,
                env: finalEnv,
                stderr: "pipe", // Pipe stderr to capture it
            });

            this.clientTransports.set(clientId, mcpTransport); // Store the transport
            // newClient.mcpTransport = mcpTransport; // Update client object (though we mainly use clientTransports map)

            // Handle stderr
            if (mcpTransport.stderr) {
                mcpTransport.stderr.on('data', (data) => {
                    const message = data.toString();
                    console.error(`[MCP Process STDERR Client ${clientId}] ${message}`);
                    this.sendSseMessage(newClient, 'logMessage', { source: 'stderr', content: message });
                });
                mcpTransport.stderr.on('error', (err) => {
                     console.error(`[MCP Process STDERR ERROR Client ${clientId}] ${err.message}`);
                     this.sendSseMessage(newClient, 'logMessage', { source: 'stderr', content: `Stderr stream error: ${err.message}`});
                });
            } else {
                 console.warn(`[MCP Proxy WARN] Stdio transport for ${clientId} has no stderr stream.`);
            }

            // Setup message proxying
            mcpTransport.onmessage = (message) => {
                // Forward messages from MCP server to SSE client
                this.sendSseMessage(newClient, 'mcpMessage', message);
            };

            mcpTransport.onerror = (error) => {
                console.error(`[MCP Proxy] MCP Transport Error for client ${clientId}:`, error);
                this.sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: `MCP Transport error: ${error.message}` });
                this.cleanupClient(clientId);
            };

            mcpTransport.onclose = () => {
                console.log(`[MCP Proxy] MCP Transport Closed for client ${clientId}.`);
                // Don't send disconnected here, wait for SSE close or explicit disconnect command?
                // Or maybe send disconnected if the client is still connected?
                if (this.clients.has(clientId)) {
                     this.sendSseMessage(newClient, 'connectionStatus', { status: 'disconnected', code: mcpTransport.exitCode ?? 'N/A' });
                }
                this.cleanupClient(clientId); // Ensure full cleanup
            };

            // Start the transport (spawns the process)
            await mcpTransport.start();
            console.log(`[MCP Proxy] Started StdioClientTransport for client ${clientId}.`);
            // Send connected status *after* transport starts successfully
             this.sendSseMessage(newClient, 'connectionStatus', { status: 'connected' });

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[MCP Proxy] Failed to setup MCP transport for client ${clientId}:`, errorMsg);
            this.sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: `Failed to start MCP process: ${errorMsg}` });
            this.cleanupClient(clientId);
        }
    }

    /**
     * @param {Request} req
     * @param {Response} res
     */
    handlePostRequest(req, res) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => { // Make async
            console.log(`[MCP Proxy] Received POST data: ${body}`);
            /** @type {JsonRpcRequest} */
            let jsonRpcRequest;
            try {
                const requestData = JSON.parse(body);

                // Check if it's already a JSON-RPC request
                if (typeof requestData === 'object' && requestData !== null && 'jsonrpc' in requestData && 'method' in requestData) {
                    jsonRpcRequest = requestData;
                    jsonRpcRequest.id = requestData.id || `req-${Date.now()}`; // Ensure ID exists
                }
                // Otherwise, assume legacy format and convert
                else if (typeof requestData === 'object' && requestData !== null && typeof requestData.type === 'string') {
                    jsonRpcRequest = {
                        jsonrpc: "2.0",
                        id: requestData.id || `req-${Date.now()}`,
                        method: requestData.type,
                        params: requestData.payload
                    };
                } else {
                    throw new Error('Invalid request format. Must be JSON-RPC or {type, payload}.');
                }
            } catch (e) {
                const errMsg = e instanceof Error ? e.message : String(e);
                console.error('[MCP Proxy] Invalid POST JSON or format:', errMsg);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: `Invalid request body: ${errMsg}` }));
                return;
            }

            // --- Find Target Client and Transport ---
            /** @type {SseClient | undefined} */
            let targetClient;
            /** @type {McpTransport | undefined} */
            let targetTransport;

            // Simplified logic: Assume only one client connection is managed by this proxy instance for now.
            // A more robust implementation might use a session ID or other identifier from the POST request.
            if (this.clients.size === 1) {
                targetClient = this.clients.values().next().value;
                if (targetClient) {
                     targetTransport = this.clientTransports.get(targetClient.id);
                }
                 if (!targetClient || !targetTransport) {
                     console.error(`[MCP Proxy] POST failed: Client map size is 1 but failed to retrieve client or transport.`);
                     res.writeHead(500, { 'Content-Type': 'application/json' });
                     res.end(JSON.stringify({ status: 'error', message: 'Internal server error: Failed to find active connection.' }));
                     return;
                 }
            } else {
                const status = this.clients.size === 0 ? 409 : 501; // 409 Conflict (no connection), 501 Not Implemented (multiple clients)
                const message = this.clients.size === 0
                    ? 'No active MCP connection.'
                    : 'Multiple clients active; cannot route command. Request routing not implemented.';
                console.error(`[MCP Proxy] POST failed: ${message} (${this.clients.size} clients)`);
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message }));
                return;
            }

            // --- Send Request to MCP Server via Transport ---
            if (!targetTransport) { // Should be caught above, but double check
                 console.error(`[MCP Proxy] Cannot handle POST for client ${targetClient.id}: Transport unavailable.`);
                 res.writeHead(409, { 'Content-Type': 'application/json' }); // 409 Conflict
                 res.end(JSON.stringify({ status: 'error', message: `MCP transport is not available for this connection.` }));
                 return;
            }

            try {
                 console.log(`[MCP Proxy StdioClientTransport] > Client ${targetClient.id}: ${JSON.stringify(jsonRpcRequest)}`);
                 // Use the transport's send method
                 await targetTransport.send(jsonRpcRequest);

                 console.log(`[MCP Proxy] Successfully sent command '${jsonRpcRequest.method}' via transport for client ${targetClient.id}`);
                 if (!res.headersSent && res.writable) {
                     res.writeHead(200, { 'Content-Type': 'application/json' });
                     res.end(JSON.stringify({ status: 'success', message: 'Command sent to MCP process.' }));
                 } else if (!res.writable) {
                    console.warn(`[MCP Proxy WARN] Cannot send POST success response; stream not writable.`);
                 }

            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                 console.error(`[MCP Proxy] Error sending command via transport for client ${targetClient.id}:`, errorMsg);
                  // Send error back via SSE if possible
                 if (this.clients.has(targetClient.id)) {
                     this.sendSseMessage(targetClient, 'commandError', { type: jsonRpcRequest.method, error: `Failed to send command to process: ${errorMsg}` });
                 }
                  // Send error back via POST response
                  if (!res.headersSent && res.writable) {
                     res.writeHead(500, { 'Content-Type': 'application/json' });
                     res.end(JSON.stringify({ status: 'error', message: `Failed to send command to MCP process: ${errorMsg}` }));
                  } else if (!res.writable) {
                     console.warn(`[MCP Proxy WARN] Cannot send POST error response; stream not writable.`);
                  }
            }
        });
    }

    /**
     * @returns {(req: Request, res: Response, next: NextFunction) => void}
     */
    getMiddleware() {
        // Return a function that keeps `this` bound correctly
        return (req, res, next) => {
            const parsedUrl = url.parse(req.url || '', true);

            if (parsedUrl.pathname !== '/mcp-proxy') {
                return next(); // Not for us
            }

            console.log(`[MCP Proxy] Handling ${req.method} for ${req.url}`);

            if (req.method === 'GET') {
                this.handleGetRequest(req, res).catch(err => { // Add catch block
                   console.error("[MCP Proxy] Unhandled error in handleGetRequest:", err);
                   if (!res.headersSent && res.writable) {
                       res.writeHead(500);
                       res.end("Internal Server Error");
                   } else if (!res.writable) {
                       console.error("[MCP Proxy] Cannot send error response for GET request; stream not writable.");
                   }
                });
            } else if (req.method === 'POST') {
                this.handlePostRequest(req, res); // Already has internal error handling
            } else {
                console.log(`[MCP Proxy] Unsupported method: ${req.method}`);
                res.writeHead(405); // Method Not Allowed
                res.end();
            }
        };
    }
}

const proxyInstance = new McpProxyHandler();
// Export the middleware function directly
module.exports = proxyInstance.getMiddleware(); 