/**
 * MCP Server Initialization
 *
 * Initializes the MCP server with WinCC OA manager, resources, and tools.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WinccoaManager } from "winccoa-manager";
import { loadAllTools } from "./tool_loader.js";
import { readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
let winccoa = null;
let fieldContent = null;
let activeFieldName = "default";
let projectContent = null;
let systemPrompt = null;
/**
 * Load system prompt from systemprompt.md file
 * @returns System prompt content or null if file doesn't exist
 */
function loadSystemPrompt() {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const systemPromptPath = join(__dirname, "systemprompt.md");
        console.log("🔄 Loading system prompt from:", systemPromptPath);
        const content = readFileSync(systemPromptPath, "utf8");
        console.log("✅ System prompt loaded successfully");
        return content;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn("⚠️ Could not load system prompt:", errorMessage);
        return null;
    }
}
/**
 * Load field content for the active field
 * @param fieldName - Name of the field to load
 * @returns Field content
 */
async function loadFieldContent(fieldName) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const fieldPath = path.join(__dirname, "fields", `${fieldName}.md`);
    try {
        // Read the field file
        const content = await fs.readFile(fieldPath, "utf8");
        console.log(`Loaded field content: ${fieldName}`);
        return content;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error loading field ${fieldName}:`, errorMessage);
        // Return default content if field not found
        return "# Default Configuration\n\nNo specific field instructions available.";
    }
}
/**
 * Load project-specific content if available
 * @returns Project content or null
 */
async function loadProjectContent() {
    const projectPath = process.env.WINCCOA_PROJECT_INSTRUCTIONS;
    if (!projectPath) {
        console.log("No project configuration specified (WINCCOA_PROJECT_INSTRUCTIONS not set)");
        return null;
    }
    try {
        // Resolve the path (could be absolute or relative)
        const resolvedPath = path.resolve(projectPath);
        // Read the project file
        const content = await fs.readFile(resolvedPath, "utf8");
        console.log(`Loaded project content from: ${resolvedPath}`);
        return content;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error loading project configuration from ${projectPath}:`, errorMessage);
        return null;
    }
}
/**
 * Initialize the MCP server with all tools and resources
 * @returns Configured MCP server
 */
export async function initializeServer() {
    console.log("🔄 Starting MCP server initialization...");
    try {
        // Initialize WinCC OA manager
        console.log("🔄 Initializing WinCC OA manager...");
        winccoa = new WinccoaManager();
        console.log("✅ WinCC OA manager initialized");
        // Get active field name
        console.log("🔄 Getting active field...");
        activeFieldName = process.env.WINCCOA_FIELD || "default";
        console.log("✅ Active field:", activeFieldName);
        // Load field and project content
        console.log("🔄 Loading field content...");
        fieldContent = await loadFieldContent(activeFieldName);
        console.log("✅ Field content loaded");
        console.log("🔄 Loading project content...");
        projectContent = await loadProjectContent();
        console.log("✅ Project content loaded:", projectContent ? "YES" : "NO");
        console.log("🔄 Loading system prompt...");
        systemPrompt = loadSystemPrompt();
        console.log("✅ System prompt loaded:", systemPrompt ? "SUCCESS" : "NONE");
        // Create server instance
        console.log("🔄 Creating MCP server instance...");
        const server = new McpServer({
            name: "WinCC OA Extended with CNS/UNS",
            version: "3.0.0",
        });
        console.log("✅ MCP server instance created");
        // Create context object for sharing state
        console.log("🔄 Creating context object...");
        const context = {
            winccoa,
            fieldContent: fieldContent || "",
            activeFieldName,
            projectContent,
            systemPrompt,
        };
        console.log("✅ Context object created");
        // Register resources for the 3 instruction levels
        console.log("🔄 Registering resources...");
        // Resource: System prompt
        if (systemPrompt) {
            server.resource("instructions://system", "System-level prompt and instructions", async () => {
                return {
                    contents: [
                        {
                            uri: "instructions://system",
                            mimeType: "text/markdown",
                            text: systemPrompt,
                        },
                    ],
                };
            });
        }
        // Resource: Field instructions
        server.resource("instructions://field", "Field-specific instructions", async () => {
            return {
                contents: [
                    {
                        uri: "instructions://field",
                        mimeType: "text/markdown",
                        text: fieldContent || "",
                    },
                ],
            };
        });
        // Resource: Project instructions
        if (projectContent) {
            server.resource("instructions://project", "Project-specific instructions", async () => {
                return {
                    contents: [
                        {
                            uri: "instructions://project",
                            mimeType: "text/markdown",
                            text: projectContent,
                        },
                    ],
                };
            });
        }
        // Resource: Combined instructions (all 3 levels merged)
        server.resource("instructions://combined", "All instructions combined (system + field + project)", async () => {
            let combined = "";
            if (systemPrompt) {
                combined +=
                    "# System Instructions\n\n" + systemPrompt + "\n\n---\n\n";
            }
            combined +=
                "# Field Instructions (" +
                    activeFieldName +
                    ")\n\n" +
                    (fieldContent || "");
            if (projectContent) {
                combined += "\n\n---\n\n# Project Instructions\n\n" + projectContent;
                combined +=
                    "\n\n---\n\n## Note\nProject instructions take precedence over field instructions.";
            }
            return {
                contents: [
                    {
                        uri: "instructions://combined",
                        mimeType: "text/markdown",
                        text: combined,
                    },
                ],
            };
        });
        console.log("✅ Resources registered");
        // Load and register all tools
        console.log("🔄 Loading and registering tools...");
        await loadAllTools(server, context);
        console.log("✅ Tools loaded and registered");
        console.log(`✅ MCP Server initialized successfully. Active field: ${activeFieldName}`);
        if (projectContent) {
            console.log(`✅ Project configuration loaded from: ${process.env.WINCCOA_PROJECT_INSTRUCTIONS}`);
        }
        return server;
    }
    catch (error) {
        console.error("❌ Error during MCP server initialization:", error);
        if (error instanceof Error) {
            console.error("❌ Initialization error stack:", error.stack);
        }
        throw error;
    }
}
/**
 * Get the current context (for testing or debugging)
 * @returns Current server context
 */
export function getContext() {
    return {
        winccoa: winccoa,
        fieldContent: fieldContent || "",
        activeFieldName,
        projectContent,
        systemPrompt,
    };
}
//# sourceMappingURL=server.js.map