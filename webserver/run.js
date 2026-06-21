// -----------------------------------------------------------------------------
// run.js -- JavaScript Manager entry point
// -----------------------------------------------------------------------------
// This file is passed as the parameter to the WinCC OA JavaScript Manager.
// It is a plain JavaScript file (not TypeScript) because the JavaScript
// Manager loads it directly without a build step.
//
// It imports the compiled TypeScript code from dist/ (the build output) and
// starts the customer-specific dashboard server.
//
// To use this file:
//   1. Build the TypeScript sources: npm run build
//   2. Add a JavaScript Manager in WinCC OA with this file as its parameter:
//      customer-webserver-example/run.js
// -----------------------------------------------------------------------------

const { CustomerDashboardServer, WsjServerGlobal } = require('.');

/**
 * Main function to run the customer-specific dashboard server.
 *
 * Creates an instance of CustomerDashboardServer (which extends
 * WsjDashboardServer) and calls open() to start it. The open() method:
 *   1. Initializes the embedded CTRL runtime
 *   2. Registers all WebSocket request handlers (standard + custom)
 *   3. Reads the configured port and WebSocket endpoint from config/config
 *   4. Sets up all HTTP routes (standard + custom)
 *   5. Starts listening for connections
 *
 * If any error occurs during startup, the process logs the error and
 * exits the JavaScript Manager via WsjServerGlobal.winccoa.exit().
 * This is the WinCC OA equivalent of process.exit() -- it shuts down
 * the manager cleanly and reports the exit to the WinCC OA system.
 */
async function runServer() {
  try {
    const server = new CustomerDashboardServer();
    await server.open();
  } catch (err) {
    console.error(err);
    console.error('Unexpected error (see above) - run.js is exiting');
    WsjServerGlobal.winccoa.exit(1);
  }
}

// Start the server
void runServer();
