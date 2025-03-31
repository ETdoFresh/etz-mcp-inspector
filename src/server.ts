import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import http from 'http';
import url, { fileURLToPath } from 'url';

// Import specific SDK components from subpaths with .js extension
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport as McpTransport } from '@modelcontextprotocol/sdk/shared/transport.js'; // Use 'import type' and alias
import { findActualExecutable } from 'spawn-rx';
// Import the strict JSONRPCMessage type from the SDK
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

// Keep standard import for shell-quote (Node ESM should resolve this)
import { parse as shellParseArgs } from 'shell-quote';

interface SseClient {
    id: string;
    response: Response; // Express Response object for SSE
    // mcpTransport will be managed externally now
}

interface JsonRpcMessage {
    jsonrpc: string;
    method?: string;
    result?: any;
    error?: any;
    params?: any;
    id?: string | number | null;
}

// --- Environment --- 
// Get default environment from SDK, potentially merged with custom vars later
const defaultEnvironment = {
    ...getDefaultEnvironment(), // Use direct import
    // Add any base environment variables for your proxy here if needed
    // ...(process.env.MCP_PROXY_ENV_VARS ? JSON.parse(process.env.MCP_PROXY_ENV_VARS) : {}),
};

// --- MCP Proxy Handler Class ---

class McpProxyHandler {
    private clients = new Map<string, SseClient>();
    // Store MCP transports separately, keyed by client ID
    private clientTransports = new Map<string, McpTransport>(); // Use aliased type

    private generateClientId(): string {
        return Math.random().toString(36).substring(2, 15);
    }

    private sendSseMessage(client: SseClient, type: string, payload: any): void {
        // Ensure client is still valid before sending
        if (!this.clients.has(client.id) || !client.response.writable) {
             console.warn(`[MCP Proxy WARN] Attempted to send SSE to disconnected/invalid client ${client.id}.`);
             this.cleanupClient(client.id);
             return;
        }
        try {
            // Ensure payload is serializable
            const message = JSON.stringify({ type, payload }, (key, value) => {
                 if (value instanceof Error) {
                     // Serialize errors in a meaningful way
                     return { name: value.name, message: value.message, stack: value.stack };
                 }
                 if (typeof value === 'function') {
                    return '[Function]'; // Or undefined
                 }
                 return value;
             });
            console.log(`[MCP Proxy SSE] > Client ${client.id}: Type=${type}`);
            client.response.write(`data: ${message}\n\n`);
            if ((client.response as any).flush) {
                (client.response as any).flush();
            }
        } catch (e) {
            // Type the caught error
            const error = e instanceof Error ? e : new Error(String(e));
            console.error(`[MCP Proxy ERROR] Failed to stringify/send SSE message for ${client.id}:`, error);
            this.cleanupClient(client.id);
        }
    }

    private cleanupClient(clientId: string): void {
        const client = this.clients.get(clientId);
        const mcpTransport = this.clientTransports.get(clientId);

        console.log(`[MCP Proxy] Cleaning up client ${clientId}.`);

        // Close MCP Transport if it exists and hasn't been closed
        if (mcpTransport) {
            console.log(`[MCP Proxy] Closing MCP transport for client ${clientId}.`);
            this.clientTransports.delete(clientId); // Remove transport first to prevent race conditions
            mcpTransport.close().catch((err: Error) => {
                console.error(`[MCP Proxy] Error closing MCP transport for ${clientId}:`, err);
            });
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
        if (this.clients.delete(clientId)) {
             console.log(`[MCP Proxy] Client ${clientId} removed from active clients.`);
        }
        console.log(`[MCP Proxy] Client ${clientId} cleanup finished.`);
    }

    // Handler for GET /mcp-proxy/sse
    async handleSseConnection(req: Request, res: Response): Promise<void> {
        console.log('[MCP Proxy] GET /mcp-proxy/sse - New SSE connection request');
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            // Optional: Add CORS headers if needed, though often handled globally
            // 'Access-Control-Allow-Origin': '*'
        });
        res.flushHeaders();

        const clientId = this.generateClientId();
        const newClient: SseClient = { id: clientId, response: res };
        this.clients.set(clientId, newClient);
        console.log(`[MCP Proxy] Client ${clientId} connected via SSE.`);
        
        // ---> ADDED: Send the client its assigned ID <---
        this.sendSseMessage(newClient, 'clientIdAssigned', { clientId: clientId });
        // ---> END ADDED <---

        // --- Connection Logic (from original handleGetRequest) ---
        const parsedUrl = url.parse(req.url || '', true);
        const { transport, command, args: argsString, env: envString } = parsedUrl.query;

        // --- Parameter Validation ---
        if (typeof command !== 'string' || !command) {
            this.sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: 'Missing or invalid "command" query parameter.' });
            this.cleanupClient(clientId);
            console.error(`[MCP Proxy] Client ${clientId} disconnected: Bad configuration (command).`);
            return;
        }

        let origArgs: string[] = []; // Arguments should be a JSON array string
        if (typeof argsString === 'string') {
            try {
                // Parse the JSON stringified array from the query parameter
                origArgs = JSON.parse(argsString);
                if (!Array.isArray(origArgs) || !origArgs.every(arg => typeof arg === 'string')) {
                    throw new Error('Args query parameter must be a JSON array of strings.');
                }
                // No need for shellParseArgs here if client sends JSON array
                // const parsedShellArgs = shellParseArgs(argsString);
                // origArgs = parsedShellArgs.filter((arg): arg is string => typeof arg === 'string');
            } catch (e) {
                // Type the caught error
                const error = e instanceof Error ? e : new Error(String(e));
                const errMsg = error.message;
                this.sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: `Invalid "args" query parameter format: ${errMsg}` });
                this.cleanupClient(clientId);
                console.error(`[MCP Proxy] Client ${clientId} disconnected: Bad args format.`);
                return;
            }
        }

        let queryEnv: Record<string, string | undefined> = {}; // Environment from query string
        if (typeof envString === 'string') {
            try {
                queryEnv = JSON.parse(envString);
                if (typeof queryEnv !== 'object' || queryEnv === null) throw new Error('Env must be a JSON object.');
            } catch (e) {
                 // Type the caught error
                const error = e instanceof Error ? e : new Error(String(e));
                const errMsg = error.message;
                this.sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: `Invalid "env" query parameter (must be JSON object): ${errMsg}` });
                this.cleanupClient(clientId);
                console.error(`[MCP Proxy] Client ${clientId} disconnected: Bad env format.`);
                return;
            }
        }

        console.log(`[MCP Proxy] Client ${clientId} Config: transport=${transport}, command=${command}, args=${JSON.stringify(origArgs)}, env=${JSON.stringify(queryEnv)}`);

        // --- Transport Creation and Proxying ---
        let mcpTransportInstance: McpTransport | null = null; // Use aliased type
        try {
            const transportLower = typeof transport === 'string' ? transport.toLowerCase() : '';
            if (transportLower !== 'stdio') {
                // TODO: Add support for SSE transport if needed in the future
                throw new Error(`Unsupported transport type: ${transport}. Only 'stdio' is currently supported.`);
            }

            // Use default environment from the main SDK import
            const sdkDefaultEnvironment = getDefaultEnvironment(); // Use direct import
            // Filter out undefined values from process.env
            const processEnvFiltered: Record<string, string> = {};
            for (const key in process.env) {
                if (Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key] !== undefined) {
                    processEnvFiltered[key] = process.env[key] as string;
                }
            }
            // Filter queryEnv as well
            const queryEnvFiltered: Record<string, string> = {};
            for (const key in queryEnv) {
                if (Object.prototype.hasOwnProperty.call(queryEnv, key) && queryEnv[key] !== undefined) {
                    queryEnvFiltered[key] = queryEnv[key] as string;
                }
            }
            const finalEnv = { ...processEnvFiltered, ...sdkDefaultEnvironment, ...queryEnvFiltered };

            // Use required findActualExecutable directly
            // const spawnRx = await import('spawn-rx');
            // const findActualExecutable = spawnRx.findActualExecutable || spawnRx.default?.findActualExecutable;
            // if (!findActualExecutable) {
            //     throw new Error('Could not load findActualExecutable from spawn-rx');
            // }

            // Assuming findActualExecutable returns { cmd: string, args: string[] }
            const { cmd, args }: { cmd: string, args: string[] } = findActualExecutable(command, origArgs);
            console.log(`[MCP Proxy] Resolved command for client ${clientId}: ${cmd} ${args.join(' ')}`);

            // ---> ADD DETAILED LOGGING HERE <---
            console.log(`[MCP Proxy DEBUG] Launching command details for client ${clientId}:`);
            console.log(`  -> CWD: ${process.cwd()}`);
            console.log(`  -> Command: ${cmd}`);
            console.log(`  -> Arguments: ${JSON.stringify(args)}`);
            console.log(`  -> Environment (showing subset for brevity):`, {
                 PATH: finalEnv.PATH,
                 // Add any other potentially relevant env vars here if you suspect them
                 // e.g., HOME: finalEnv.HOME, USERPROFILE: finalEnv.USERPROFILE
                 MCP_SPECIFIC_VAR: finalEnv.MCP_SPECIFIC_VAR, // Replace with actual var name if relevant
            });
            // For more intense debugging, uncomment the next line, but BEWARE it can log sensitive info!
            // console.log(`  -> Full Environment: ${JSON.stringify(finalEnv)}`);
            // ---> END DETAILED LOGGING <---

            // Use StdioClientTransport from the main SDK import
            mcpTransportInstance = new StdioClientTransport({ // Use direct import
                command: cmd,
                args,
                env: finalEnv,
                stderr: "pipe",
            });

            this.clientTransports.set(clientId, mcpTransportInstance);

            // Handle stderr - Check if it's an StdioClientTransport first
            if (mcpTransportInstance instanceof StdioClientTransport && mcpTransportInstance.stderr) {
                mcpTransportInstance.stderr.on('data', (data: Buffer) => {
                    const message = data.toString();
                    console.error(`[MCP Process STDERR Client ${clientId}] ${message}`);
                    // Check if client still exists before sending
                    const currentClient = this.clients.get(clientId);
                    if(currentClient) {
                        this.sendSseMessage(currentClient, 'logMessage', { source: 'stderr', content: message });
                    }
                });
                mcpTransportInstance.stderr.on('error', (err: Error) => {
                     console.error(`[MCP Process STDERR ERROR Client ${clientId}] ${err.message}`);
                     const currentClient = this.clients.get(clientId);
                     if (currentClient) {
                         this.sendSseMessage(currentClient, 'logMessage', { source: 'stderr', content: `Stderr stream error: ${err.message}`});
                     }
                });
            } else {
                 console.warn(`[MCP Proxy WARN] Stdio transport for ${clientId} has no stderr stream or is not StdioClientTransport.`);
            }

            // Setup message proxying
            mcpTransportInstance.onmessage = (message: JsonRpcMessage) => {
                const currentClient = this.clients.get(clientId);
                if (currentClient) {
                    this.sendSseMessage(currentClient, 'mcpMessage', message);
                }
            };

            mcpTransportInstance.onerror = (error: Error) => {
                console.error(`[MCP Proxy] MCP Transport Error for client ${clientId}:`, error);
                const currentClient = this.clients.get(clientId);
                 if (currentClient) {
                    this.sendSseMessage(currentClient, 'connectionStatus', { status: 'error', error: `MCP Transport error: ${error.message}` });
                 }
                this.cleanupClient(clientId);
            };

            mcpTransportInstance.onclose = () => {
                 // Exit code is not directly available here
                 // const exitCode = (mcpTransportInstance as StdioClientTransport)?.exitCode ?? 'N/A'; // Use direct import for type
                 console.log(`[MCP Proxy] MCP Transport Closed for client ${clientId}.`); // Removed exit code access
                 const currentClient = this.clients.get(clientId);
                 if (currentClient) {
                      this.sendSseMessage(currentClient, 'connectionStatus', { status: 'disconnected' }); // Send simple disconnected status
                 }
                 this.cleanupClient(clientId);
            };

            await mcpTransportInstance.start();
            console.log(`[MCP Proxy] Started StdioClientTransport for client ${clientId}.`);
            this.sendSseMessage(newClient, 'connectionStatus', { status: 'connected' });

        } catch (error) {
            // Type the caught error
            const typedError = error instanceof Error ? error : new Error(String(error));
            const errorMsg = typedError.message;
            console.error(`[MCP Proxy] Failed to setup MCP transport for client ${clientId}:`, errorMsg);
            this.sendSseMessage(newClient, 'connectionStatus', { status: 'error', error: `Failed to start MCP process: ${errorMsg}` });
            this.cleanupClient(clientId);
        }

        // Cleanup when SSE client disconnects
         req.on('close', () => {
            console.log(`[MCP Proxy] Client ${clientId} disconnected (SSE connection closed).`);
            this.cleanupClient(clientId);
        });

    }

    // Handler for POST /mcp-proxy/message
    handleClientMessage(req: Request, res: Response): void {
        const clientId = req.query.clientId as string;
        // Use the imported JSONRPCMessage type
        const message = req.body as JSONRPCMessage;

        if (!clientId || !message) {
            console.error('[MCP Proxy POST] Invalid request: Missing clientId or message body');
            res.status(400).send('Bad Request: Missing clientId or message body');
            return;
        }

        const mcpTransportInstance = this.clientTransports.get(clientId);
        const sseClient = this.clients.get(clientId);

        if (!mcpTransportInstance || !sseClient) {
            console.warn(`[MCP Proxy POST] Client ${clientId} not found or MCP transport not ready.`);
            res.status(404).send('Client session not found or not fully connected');
            // Attempt cleanup just in case
            this.cleanupClient(clientId);
            return;
        }

        // Safely access properties for logging
        const methodForLog = 'method' in message ? message.method : 'response/error';
        const idForLog = 'id' in message ? message.id : 'N/A';
        console.log(`[MCP Proxy POST] < Client ${clientId}: Type=${methodForLog} ID=${idForLog}`);

        // Send message to the MCP server process
        mcpTransportInstance.send(message)
            .then(() => {
                res.status(200).send('OK');
            })
            .catch((error: Error) => {
                console.error(`[MCP Proxy POST] Error sending message to MCP transport for ${clientId}:`, error);
                res.status(500).send(`Failed to send message to MCP server: ${error.message}`);
                // Consider if we should clean up the client on send failure
                // this.cleanupClient(clientId);
            });
    }

    // Graceful shutdown handler
    shutdown(): void {
        console.log('[MCP Proxy] Initiating graceful shutdown...');
        const cleanupPromises: Promise<void>[] = [];
        // Create a copy of client IDs to iterate over, as cleanupClient modifies the map
        const clientIds = Array.from(this.clients.keys());
        clientIds.forEach((clientId) => {
             console.log(`[MCP Proxy Shutdown] Cleaning up client ${clientId}`);
             // cleanupClient already handles closing transport and response
             this.cleanupClient(clientId);
             // Note: cleanupClient is mostly synchronous in its map deletions
             // but transport.close() is async. We don't strictly wait here,
             // assuming best-effort close is sufficient for shutdown.
        });
         console.log('[MCP Proxy] All clients signaled for cleanup.');
        // Reset maps after signaling cleanup (already done in cleanupClient)
        // this.clients.clear();
        // this.clientTransports.clear();
         console.log('[MCP Proxy] Shutdown process complete.');
    }
}

// --- Server Setup ---
const app = express();
const port = process.env.PORT || 3000; // Use environment variable or default to 3000
const mcpProxyHandler = new McpProxyHandler();

// --- Static File Serving ---
// Get current directory in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve files from the 'public' directory relative to the current file's directory
const publicPath = path.resolve(__dirname, '../public');
const distPath = path.resolve(__dirname, '../dist');
console.log(`[Server] Serving static files from: ${publicPath}`);
console.log(`[Server] Serving dist files from: ${distPath}`);
app.use(express.static(publicPath));
app.use('/dist', express.static(distPath));

// --- MCP Proxy Routes ---
// Use .bind to ensure 'this' context is correct inside the handler methods
app.get('/mcp-proxy/sse', mcpProxyHandler.handleSseConnection.bind(mcpProxyHandler));
// Make sure to use express.json() middleware for POST requests with JSON bodies
app.post('/mcp-proxy/message', express.json(), mcpProxyHandler.handleClientMessage.bind(mcpProxyHandler));

// --- Basic Routes ---
// Redirect root to index.html
app.get('/', (req: Request, res: Response) => {
    // Assuming index.html is served by the static middleware above
    res.sendFile(path.join(publicPath, 'index.html'));
});

// --- Server Startup ---
const server = http.createServer(app);

server.listen(port, () => {
    console.log(`[Server] Listening on http://localhost:${port}`);
});

// --- Graceful Shutdown ---
let isShuttingDown = false;
const gracefulShutdown = () => {
    if (isShuttingDown) return; // Prevent multiple shutdowns
    isShuttingDown = true;
    console.log('[Server] Received shutdown signal.');
    mcpProxyHandler.shutdown(); // Clean up MCP connections

    console.log('[Server] Closing HTTP server...');
    server.close((err) => {
        if (err) {
            console.error('[Server] Error closing HTTP server:', err);
            process.exit(1);
        } else {
            console.log('[Server] HTTP server closed.');
            process.exit(0); // Exit cleanly
        }
    });

    // Force close server after a timeout if graceful shutdown fails
    setTimeout(() => {
        console.error('[Server] Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000); // 10 seconds timeout
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown); // Handle Ctrl+C 