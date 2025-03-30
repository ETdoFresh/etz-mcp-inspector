export interface McpMessagePayload {
    id?: string | number; // Optional ID for JSON-RPC correlation
    result?: any;
    error?: {
        message: string;
        data?: any;
        code?: number;
    };
    method?: string; // For notifications
    params?: any;
} 