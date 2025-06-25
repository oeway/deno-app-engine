// Vision utilities for Deno App Engine
// Provides image inspection capabilities for AI agents

import OpenAI from 'npm:openai@^4.0.0';
import type { JSONSchema } from 'npm:openai@^4.0.0/lib/jsonschema';

export interface ImageInfo {
  url: string;
  title?: string;
}

export interface VisionInspectionOptions {
  images: ImageInfo[];
  query: string;
  contextDescription?: string;
  model?: string;
  maxTokens?: number;
  baseURL?: string;
  apiKey?: string;
  outputSchema?: JSONSchema;
}

/**
 * API options type for inspectImages when called from agent code
 * This matches the interface that agents use when calling api.inspectImages()
 * Model settings (model, baseURL, apiKey) are automatically taken from the agent
 */
export interface InspectImagesOptions {
  /** Array of images to inspect */
  images: ImageInfo[];
  /** Query or question about the images */
  query: string;
  /** Optional context description for the analysis */
  contextDescription?: string;
  /** Maximum tokens for response (can use max_tokens or maxTokens) */
  max_tokens?: number;
  maxTokens?: number;
  /** Optional JSON schema for structured output */
  outputSchema?: JSONSchema;
}

/**
 * Inspects images using OpenAI Vision models with streaming support.
 * This function is designed to work in the Deno environment.
 * 
 * @param options Configuration options for the vision inspection
 * @returns An async generator that yields streaming response chunks:
 *   - { type: 'text_chunk', content: string } - Intermediate streaming chunk
 *   - { type: 'text', content: string } - Final complete response
 */
export async function* inspectImages({
  images,
  query,
  contextDescription,
  model = "gpt-4o-mini",
  maxTokens = 1024,
  baseURL,
  apiKey,
  outputSchema,
  stream = true
}: VisionInspectionOptions & { stream?: boolean }): AsyncGenerator<
  | { type: 'text_chunk'; content: string } // Streaming intermediate chunk  
  | { type: 'text'; content: string }, // Final complete response
  void, 
  unknown
> {

  // Validate image URLs
  for (const image of images) {
    if (!image.url.startsWith('http://') && !image.url.startsWith('https://') && !image.url.startsWith('data:')) {
      throw new Error(`Invalid image URL format: ${image.url}. URL must start with http://, https://, or data:.`);
    }
  }

  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
  });

  // Build the content array for the user message conditionally
  const userContentParts: (OpenAI.Chat.ChatCompletionContentPartText | OpenAI.Chat.ChatCompletionContentPartImage)[] = [];

  if (contextDescription && typeof contextDescription === 'string' && contextDescription.trim() !== '') {
    userContentParts.push({ type: "text" as const, text: contextDescription });
  }

  if (query && typeof query === 'string' && query.trim() !== '') {
    userContentParts.push({ type: "text" as const, text: query });
  }

  userContentParts.push(...images.map(image => ({
    type: "image_url" as const,
    image_url: {
      url: image.url,
    }
  })));

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: "You are a helpful AI assistant that helps users inspect the provided images visually based on the context, make insightful comments and answer questions about the provided images."
    },
    {
      role: "user",
      content: userContentParts
    }
  ];

  try {
    // Conditionally add response_format based on outputSchema
    const completionParams: OpenAI.Chat.ChatCompletionCreateParams = {
      model: model,
      messages: messages,
      max_tokens: maxTokens,
      stream: stream,
    };

    if (outputSchema && typeof outputSchema === 'object' && Object.keys(outputSchema).length > 0) {
      // For structured output, disable streaming as it's not supported with json_schema
      completionParams.stream = false;
      completionParams.response_format = { 
        type: "json_schema", 
        json_schema: { 
          schema: outputSchema as Record<string, unknown>, 
          name: "outputSchema", 
          strict: true 
        } 
      };
    }

    if (stream && !outputSchema) {
      // Streaming mode
      const streamResponse = await openai.chat.completions.create(completionParams) as AsyncIterable<any>;
      let accumulatedContent = '';
      
      for await (const chunk of streamResponse) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          accumulatedContent += delta;
          yield { type: 'text_chunk', content: delta };
        }
      }
      
      yield { type: 'text', content: accumulatedContent };
    } else {
      // Non-streaming mode (for structured output or when stream=false)
      const response = await openai.chat.completions.create(completionParams) as any;
      const content = response.choices[0].message.content || "No response generated";
      
      // if outputSchema is provided, parse the response using JSON.parse
      if (outputSchema && typeof outputSchema === 'object' && Object.keys(outputSchema).length > 0) {
        const parsed = JSON.parse(content);
        yield { type: 'text', content: typeof parsed === 'string' ? parsed : JSON.stringify(parsed) };
      } else {
        yield { type: 'text', content };
      }
    }
  } catch (error) {
    console.error("Error in vision inspection:", error);
    throw error;
  }
}

/**
 * Converts a File or Blob to a base64 data URL.
 * Works in Deno environment using Web APIs.
 * 
 * @param file The file or blob to convert
 * @returns A promise that resolves to the base64 data URL
 */
export async function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert file to data URL'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Converts a base64 string to a data URL with the correct MIME type.
 * 
 * @param base64 The base64 string
 * @param mimeType The MIME type of the image
 * @returns The complete data URL
 */
export function base64ToDataUrl(base64: string, mimeType: string): string {
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Simple utility to create an ImageInfo object from a URL
 * 
 * @param url The image URL
 * @param title Optional title for the image
 * @returns ImageInfo object
 */
export function createImageInfo(url: string, title?: string): ImageInfo {
  return { url, title };
} 