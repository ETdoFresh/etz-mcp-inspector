const http = require('http');
const { spawn } = require('child_process');
const url = require('url');

// JSDoc types for clarity (optional but helpful)
/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {import('child_process').ChildProcessWithoutNullStreams} ChildProcess
 */

/**
 * @typedef {object} SseClient
 * @property {string} id
 * @property {Response} response
 * @property {ChildProcess | null} mcpProcess
 */

/**
 * @typedef {object} PostRequestData
 * @property {string} type
 * @property {any} payload
 * @property {string | number} [id]
 */

class McpProxyHandler {
    constructor() {
        /** @type {Map<string, SseClient>} */
        this.clients = new Map();
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
        const message = JSON.stringify({ type, payload });
        console.log(`[MCP Proxy SSE] > Client ${client.id}: Type=${type}`);

        if (client.response.writable) {
            client.response.write(`data: ${message}\n\n`);
        } else {
            console.warn(`[MCP Proxy WARN] Attempted to write to closed SSE stream for client ${client.id}. Cleaning up.`);
            this.cleanupClient(client);
        }
    }

    /**
     * @param {SseClient | undefined} client
     */
    cleanupClient(client) {
        if (!client) return;

        console.log(`[MCP Proxy] Cleaning up client ${client.id}.`);
        if (client.mcpProcess && !client.mcpProcess.killed) {
            console.log(`[MCP Proxy] Killing MCP process (PID: ${client.mcpProcess.pid}) for client ${client.id}.`);
            client.mcpProcess.kill();
        }
        this.clients.delete(client.id);
        if (client.response.writable) {
            try {
                 client.response.end();
            } catch (e) {
                 console.error(`[MCP Proxy] Error ending response stream for client ${client.id}:`, e);
            }
        }
    }

    /**
     * @param {Request} req
     * @param {Response} res
     */
    handleGetRequest(req, res) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.flushHeaders();

        const clientId = this.generateClientId();
        /** @type {SseClient} */
        const newClient = { id: clientId, response: res, mcpProcess: null };
        this.clients.set(clientId, newClient);
        console.log(`[MCP Proxy] Client ${clientId} connected via SSE.`);

        const parsedUrl = url.parse(req.url || '', true);
        const { transport, command, args: argsString } = parsedUrl.query;

        if (typeof command !== 'string' || !command) {
            this.sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: 'Missing or invalid "command" query parameter.' });
            this.cleanupClient(newClient);
            console.error(`[MCP Proxy] Client ${clientId} disconnected: Bad configuration (command).`);
            return;
        }

        let parsedArgs = [];
        if (typeof argsString === 'string') {
            try {
                parsedArgs = JSON.parse(argsString);
                if (!Array.isArray(parsedArgs)) throw new Error('Args must be a JSON array.');
            } catch (e) {
                this.sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: `Invalid "args" query parameter (must be JSON array): ${e.message}` });
                this.cleanupClient(newClient);
                console.error(`[MCP Proxy] Client ${clientId} disconnected: Bad args format.`);
                return;
            }
        }

        console.log(`[MCP Proxy] Client ${clientId} Config: transport=${transport}, command=${command}, args=${JSON.stringify(parsedArgs)}`);
        this.spawnMcpProcess(newClient, command, parsedArgs, transport);

        req.on('close', () => {
            console.log(`[MCP Proxy] Client ${clientId} disconnected (SSE connection closed).`);
            this.cleanupClient(this.clients.get(clientId));
        });
    }

    /**
     * @param {SseClient} client
     * @param {string} command
     * @param {string[]} args
     * @param {string | string[] | undefined} transport
     */
    spawnMcpProcess(client, command, args, transport) {
        const transportLower = typeof transport === 'string' ? transport.toLowerCase() : '';
        if (transportLower !== 'stdio') {
            const errorMsg = `Unsupported transport type: ${transport}. Only 'stdio' is currently supported.`;
            console.error(`[MCP Proxy] ${errorMsg} for client ${client.id}`);
            this.sendSseMessage(client, 'connectionStatus', { status: 'error', error: errorMsg });
            this.cleanupClient(client);
            return;
        }

        try {
            console.log(`[MCP Proxy] Spawning process for client ${client.id}: ${command} ${args.join(' ')}`);
            const mcpProcess = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: true });
            client.mcpProcess = mcpProcess;

            this.sendSseMessage(client, 'connectionStatus', { status: 'connected' });
            console.log(`[MCP Proxy] Process spawned for client ${client.id} (PID: ${mcpProcess.pid})`);

            mcpProcess.stdout.on('data', (data) => {
                const lines = data.toString().split(/\r?\n/);
                lines.forEach((line) => {
                    if (line.trim()) {
                        console.log(`[MCP Process ${mcpProcess.pid} STDOUT] ${line}`);
                        try {
                            const jsonMessage = JSON.parse(line);
                            this.sendSseMessage(client, 'mcpMessage', jsonMessage);
                        } catch (e) {
                            console.warn(`[MCP Proxy WARN] Non-JSON output from PID ${mcpProcess.pid}: ${line}`);
                            this.sendSseMessage(client, 'logMessage', { source: 'stdout', content: line });
                        }
                    }
                });
            });

            mcpProcess.stderr.on('data', (data) => {
                const message = data.toString();
                console.error(`[MCP Process ${mcpProcess.pid} STDERR] ${message}`);
                this.sendSseMessage(client, 'logMessage', { source: 'stderr', content: message });
            });

            mcpProcess.on('error', (err) => {
                console.error(`[MCP Process ${mcpProcess.pid || 'unknown'} ERROR] Failed to start or runtime error:`, err);
                if (this.clients.has(client.id)) {
                    this.sendSseMessage(client, 'connectionStatus', { status: 'error', error: `Process error: ${err.message}` });
                }
                this.cleanupClient(client);
            });

            mcpProcess.on('close', (code) => {
                console.log(`[MCP Process ${mcpProcess.pid || 'unknown'} CLOSE] Exited with code ${code}`);
                if (this.clients.has(client.id)) {
                    this.sendSseMessage(client, 'connectionStatus', { status: 'disconnected', code: code });
                }
                this.cleanupClient(client);
            });

        } catch (error) {
            console.error(`[MCP Proxy] Failed to spawn process for client ${client.id}:`, error);
            if (this.clients.has(client.id)) {
                this.sendSseMessage(client, 'connectionStatus', { status: 'error', error: `Failed to spawn process: ${error.message}` });
            }
            this.cleanupClient(client);
        }
    }

    /**
     * @param {Request} req
     * @param {Response} res
     */
    handlePostRequest(req, res) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            console.log(`[MCP Proxy] Received POST data: ${body}`);
            /** @type {PostRequestData} */
            let requestData;
            try {
                requestData = JSON.parse(body);
                if (typeof requestData !== 'object' || requestData === null || typeof requestData.type !== 'string') {
                    throw new Error('Invalid request format. Missing or invalid "type".');
                }
            } catch (e) {
                console.error('[MCP Proxy] Invalid POST JSON or format:', e.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: `Invalid request body: ${e.message}` }));
                return;
            }

            /** @type {SseClient | undefined} */
            let targetClient;
            if (this.clients.size === 1) {
                targetClient = this.clients.values().next().value;
                if (!targetClient) {
                     console.error(`[MCP Proxy] POST failed: Client map size is 1 but failed to retrieve client.`);
                     res.writeHead(500, { 'Content-Type': 'application/json' });
                     res.end(JSON.stringify({ status: 'error', message: 'Internal server error: Failed to find client.' }));
                     return;
                }
            } else {
                const status = this.clients.size === 0 ? 409 : 501;
                const message = this.clients.size === 0
                    ? 'No active MCP connection.'
                    : 'Multiple clients active; cannot route command.';
                console.error(`[MCP Proxy] POST failed: ${message}`);
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message }));
                return;
            }

            if (!targetClient.mcpProcess || targetClient.mcpProcess.killed || !targetClient.mcpProcess.stdin.writable) {
                const reason = !targetClient.mcpProcess ? "No MCP process object" :
                               targetClient.mcpProcess.killed ? "MCP process killed" :
                               !targetClient.mcpProcess.stdin.writable ? "MCP process stdin not writable" :
                               "Unknown reason";
                console.error(`[MCP Proxy] Cannot handle POST for client ${targetClient.id}: MCP process unavailable (${reason}).`);
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: `MCP process is not running or connection lost (${reason}).` }));
                return;
            }

            const jsonRpcRequest = {
                jsonrpc: "2.0",
                id: requestData.id || `req-${Date.now()}`,
                method: requestData.type,
                params: requestData.payload
            };
            const messageString = JSON.stringify(jsonRpcRequest) + '\n';

            console.log(`[MCP Proxy STDIN] > PID ${targetClient.mcpProcess.pid}: ${messageString.trim()}`);
            if (targetClient.mcpProcess) {
                targetClient.mcpProcess.stdin.write(messageString, (err) => {
                    if (err) {
                        console.error(`[MCP Proxy] Error writing to MCP stdin (PID: ${targetClient?.mcpProcess?.pid}):`, err);
                         if (targetClient && this.clients.has(targetClient.id)) {
                             this.sendSseMessage(targetClient, 'commandError', { type: requestData.type, error: `Failed to write to process stdin: ${err.message}` });
                         }
                        try {
                            if (!res.headersSent) {
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                            }
                            if (res.writable) {
                                 res.end(JSON.stringify({ status: 'error', message: `Failed to send command to MCP process: ${err.message}` }));
                            } else {
                                console.warn(`[MCP Proxy WARN] Cannot send POST error response; stream not writable.`);
                            }
                        } catch (e) { console.error("[MCP Proxy] Error sending POST error response:", e); }
                    } else {
                        console.log(`[MCP Proxy] Successfully sent command '${requestData.type}' to MCP process (PID: ${targetClient?.mcpProcess?.pid})`);
                         try {
                             if (!res.headersSent) {
                                 res.writeHead(200, { 'Content-Type': 'application/json' });
                             }
                              if (res.writable) {
                                 res.end(JSON.stringify({ status: 'success', message: 'Command sent to MCP process.' }));
                             } else {
                                 console.warn(`[MCP Proxy WARN] Cannot send POST success response; stream not writable.`);
                             }
                         } catch (e) { console.error("[MCP Proxy] Error sending POST success response:", e); }
                    }
                });
            } else {
                 console.error(`[MCP Proxy] Cannot handle POST for client ${targetClient.id}: MCP process is null unexpectedly.`);
                 if (!res.headersSent) {
                      res.writeHead(500, { 'Content-Type': 'application/json' });
                 }
                 if (res.writable) {
                      res.end(JSON.stringify({ status: 'error', message: 'Internal server error: MCP process reference lost.' }));
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
                this.handleGetRequest(req, res);
            } else if (req.method === 'POST') {
                this.handlePostRequest(req, res);
            } else {
                console.log(`[MCP Proxy] Unsupported method: ${req.method}`);
                res.writeHead(405); // Method Not Allowed
                res.end();
            }
        };
    }
}

const proxyInstance = new McpProxyHandler();
module.exports = { mcpProxyHandler: proxyInstance.getMiddleware() }; 