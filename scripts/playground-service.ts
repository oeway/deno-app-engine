/**
 * Playground ASGI Service for Hypha Core
 * 
 * This service provides frontend playground interfaces through hypha-core ASGI.
 */

export interface PlaygroundServiceConfig {
  id: string;
  name?: string;
  description?: string;
}

/**
 * Create and register the playground service with HyphaCore
 */
export async function createPlaygroundService(api: any, config: PlaygroundServiceConfig = { id: 'playground-service' }) {
  const service = {
    id: config.id,
    name: config.name || 'Playground Service',
    description: config.description || 'Frontend playground interfaces for kernels, agents, and vector databases',
    type: 'asgi',
    config: {},
    
    async serve({ scope, receive, send }: { scope: any, receive: any, send: any }) {
      console.log('🔄 ASGI serve called:', scope.method, scope.path);
      
      if (scope.type !== 'http') {
        console.log('❌ Non-HTTP scope, returning');
        return;
      }
      
      // Consume the request body (ASGI protocol requirement)
      try {
        await receive();
      } catch (error) {
        console.log('⚠️ Failed to receive request data:', error);
      }
      
      const path = scope.path || '/';
      
      let htmlContent = '';
      let contentType = 'text/html; charset=utf-8';
      let status = 200;
      
      try {
        if (path === '/' || path === '/index.html') {
          htmlContent = await readHtmlFile('static/playground-main.html');
        } else if (path === '/kernels' || path === '/kernels.html') {
          htmlContent = await readHtmlFile('static/playground-kernels.html');
        } else if (path === '/agents' || path === '/agents.html') {
          htmlContent = await readHtmlFile('static/playground-agents.html');
        } else if (path === '/vectordb' || path === '/vectordb.html') {
          htmlContent = await readHtmlFile('static/playground-vectordb.html');
        } else {
          // 404 Not Found
          htmlContent = await readHtmlFile('static/playground-404.html');
          status = 404;
        }
        
        // Send successful response
        await send({
          type: 'http.response.start',
          status,
          headers: [
            [new TextEncoder().encode('content-type'), new TextEncoder().encode(contentType)]
          ]
        });
        
        await send({
          type: 'http.response.body',
          body: new TextEncoder().encode(htmlContent),
          more_body: false
        });
        
      } catch (error) {
        console.error('❌ Error in ASGI serve:', error);
        
        await send({
          type: 'http.response.start',
          status: 500,
          headers: [
            [new TextEncoder().encode('content-type'), new TextEncoder().encode('text/plain')]
          ]
        });
        
        await send({
          type: 'http.response.body',
          body: new TextEncoder().encode('Internal Server Error'),
          more_body: false
        });
      }
    }
  };
  
  await api.registerService(service);
  console.log(`✅ Playground service registered: ${config.id}`);
  return service;
}

/**
 * Read HTML file from the filesystem
 */
async function readHtmlFile(filePath: string): Promise<string> {
  try {
    const content = await Deno.readTextFile(filePath);
    return content;
  } catch (error) {
    console.error(`❌ Failed to read HTML file ${filePath}:`, error);
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Error - File Not Found</title>
</head>
<body>
    <h1>Error</h1>
    <p>Failed to load page: ${filePath}</p>
    <p>Error: ${error instanceof Error ? error.message : String(error)}</p>
    <a href="../">← Back to Dashboard</a>
</body>
</html>`;
  }
} 