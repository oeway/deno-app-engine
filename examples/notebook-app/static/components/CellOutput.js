// Cell Output component
import { h, Component } from 'https://esm.sh/preact@10.19.2';
import { useState, useEffect, useRef } from 'https://esm.sh/preact@10.19.2/hooks';
import { html } from 'https://esm.sh/htm@3.1.1/preact';

export function CellOutput({ outputs = [], error = null }) {
  // Create a reference to the output div
  const outputRef = useRef(null);
  
  // Process HTML content safely
  const createHtmlOutput = (content) => {
    const iframe = document.createElement('iframe');
    iframe.srcdoc = content;
    iframe.className = 'output-html';
    iframe.sandbox = 'allow-scripts allow-same-origin';
    iframe.width = '100%';
    iframe.height = '300px';
    iframe.style.border = 'none';
    
    return iframe;
  };
  
  // Render a single output
  const renderOutput = (output, index) => {
    if (output.name === 'stdout' || output.name === 'stderr') {
      // Text output
      return html`<div key=${index} class="output-text ${output.name}">${output.text}</div>`;
    } else if (output.data && output.data['text/html']) {
      // HTML output (for plots, widgets, etc.)
      useEffect(() => {
        if (outputRef.current) {
          const container = document.createElement('div');
          container.className = 'output-html-container';
          
          const iframe = createHtmlOutput(output.data['text/html']);
          container.appendChild(iframe);
          
          // Find the output div for this specific output
          const outputDiv = outputRef.current.querySelector(`[data-output-index="${index}"]`);
          if (outputDiv) {
            outputDiv.innerHTML = '';
            outputDiv.appendChild(container);
          }
        }
      }, [output.data['text/html']]);
      
      return html`<div key=${index} class="output-html-wrapper" data-output-index=${index}></div>`;
    } else if (output.data && output.data['text/plain']) {
      // Plain text output
      return html`<div key=${index} class="output-text">${output.data['text/plain']}</div>`;
    } else if (output.data && output.data['image/png']) {
      // Image output
      return html`<img key=${index} src="data:image/png;base64,${output.data['image/png']}" />`;
    } else if (output.data && output.data['image/jpeg']) {
      // JPEG image output
      return html`<img key=${index} src="data:image/jpeg;base64,${output.data['image/jpeg']}" />`;
    } else if (output.data && output.data['image/svg+xml']) {
      // SVG image output
      return html`<div key=${index} class="output-svg" dangerouslySetInnerHTML=${{ __html: output.data['image/svg+xml'] }}></div>`;
    } else if (output.data && typeof output.data === 'object') {
      // JSON output
      return html`<pre key=${index} class="output-json">${JSON.stringify(output.data, null, 2)}</pre>`;
    } else {
      // Unknown output type
      return html`<div key=${index} class="output-unknown">Unsupported output type</div>`;
    }
  };
  
  return html`
    <div class="cell-output" ref=${outputRef}>
      ${error ? html`
        <div class="error">${error}</div>
      ` : null}
      
      ${outputs.map((output, index) => renderOutput(output, index))}
    </div>
  `;
} 