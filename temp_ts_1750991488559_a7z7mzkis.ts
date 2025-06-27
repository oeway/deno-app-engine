
// Test the chatCompletion API from TypeScript agent
// Use globalThis to access the _hypha_server that was set in the previous execution
console.log("🔄 Testing chatCompletion API from TypeScript...");

const messages = [
    { role: "user", content: "Explain the concept of recursion in programming with a simple example." }
];

try {
    console.log("📤 Calling chatCompletion API using globalThis._hypha_server...");
    
    // Use globalThis to access the _hypha_server from previous execution
    if (!globalThis._hypha_server) {
        throw new Error("globalThis._hypha_server is not available. Previous connection may have failed.");
    }
    
    // Call the chatCompletion method directly on globalThis._hypha_server
    // The context (including target agent) is automatically provided by HyphaCore
    const chatGenerator = await globalThis._hypha_server.chatCompletion(messages);
    
    console.log("✅ Successfully got chat completion generator from TypeScript");
    
    let resultChunks: any[] = [];
    let finalResponse = "";
    
    // Iterate through the async generator
    for await (const chunk of chatGenerator) {
        resultChunks.push(chunk);
        
        if (chunk.type === 'text_chunk' && chunk.content) {
            console.log(`📝 TS Chunk: ${chunk.content}`);
            finalResponse += chunk.content; // Accumulate chunks
        } else if (chunk.type === 'text' && chunk.content) {
            finalResponse = chunk.content;
            console.log(`✅ TS Final: ${chunk.content}`);
        }
    }
    
    console.log(`📊 TS Total chunks received: ${resultChunks.length}`);
    console.log(`🎯 TS Final response: ${finalResponse}`);
    
    // Verify we got a reasonable response about recursion
    const responseText = finalResponse.toLowerCase();
    if (responseText.includes("recursion") || responseText.includes("function") || responseText.includes("itself")) {
        console.log("✅ TypeScript ChatCompletion API test PASSED - Got expected recursion explanation");
    } else {
        console.log(`⚠️ TypeScript ChatCompletion API test WARNING - Unexpected response: ${finalResponse}`);
    }
    
} catch (error) {
    console.error("❌ TypeScript ChatCompletion API test FAILED:", error);
    console.error("Error details:", error.message);
    console.error("Error stack:", error.stack);
}


export const result = undefined;