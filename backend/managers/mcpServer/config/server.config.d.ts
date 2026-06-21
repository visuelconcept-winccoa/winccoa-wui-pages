/**
 * Server Deployment Configuration
 *
 * Configuration for HTTP/STDIO server modes, authentication, CORS, SSL, and security.
 */
import type { ServerConfig, SslCertificates } from '../types/index.js';
export declare const serverConfig: ServerConfig;
/**
 * Helper function to load SSL certificates
 * @returns SSL certificate data or null if SSL is disabled or loading fails
 */
export declare function loadSSLConfig(): SslCertificates | null;
/**
 * Validate configuration
 * @returns Array of validation error messages (empty if valid)
 */
export declare function validateConfig(): string[];
//# sourceMappingURL=server.config.d.ts.map