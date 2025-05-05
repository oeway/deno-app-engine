// Cell component
import { h, Component } from 'https://esm.sh/preact@10.19.2';
import { useState, useEffect, useRef } from 'https://esm.sh/preact@10.19.2/hooks';
import { html } from 'https://esm.sh/htm@3.1.1/preact';
import { CellOutput } from './CellOutput.js';

// Load Prism for syntax highlighting
import 'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js';
import 'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-python.min.js';

export function Cell({
  cell,
  active,
  onCellClick,
  onExecute,
  onUpdate,
  onDelete,
  onAddBelow
}) {
  const [source, setSource] = useState(cell.source || '');
  const textareaRef = useRef(null);
  
  // Update the source when the cell changes
  useEffect(() => {
    setSource(cell.source || '');
  }, [cell.id, cell.source]);
  
  // Focus the textarea when the cell becomes active
  useEffect(() => {
    if (active && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [active]);
  
  // Handle source changes
  const handleSourceChange = (e) => {
    const newSource = e.target.value;
    setSource(newSource);
    onUpdate({ source: newSource });
  };
  
  // Handle key commands
  const handleKeyDown = (e) => {
    // Shift+Enter: Execute cell
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      onExecute(source);
    }
    
    // Ctrl+Enter: Execute cell and add new cell below
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      onExecute(source).then(() => {
        onAddBelow();
      });
    }
  };
  
  // Execute the cell
  const handleExecute = () => {
    onExecute(source);
  };
  
  return html`
    <div class="cell ${active ? 'focused' : ''}" onClick=${onCellClick}>
      <div class="cell-toolbar">
        <button onClick=${handleExecute} title="Run cell (Shift+Enter)">▶ Run</button>
        <button onClick=${onAddBelow} title="Add cell below">+ Add</button>
        <button onClick=${onDelete} title="Delete cell">🗑️ Delete</button>
        ${cell.executing && html`<span>Executing...</span>`}
      </div>
      
      <div class="cell-editor">
        <textarea
          ref=${textareaRef}
          value=${source}
          onInput=${handleSourceChange}
          onKeyDown=${handleKeyDown}
          placeholder="Enter Python code here..."
        ></textarea>
      </div>
      
      ${(cell.outputs && cell.outputs.length > 0) || cell.error ? html`
        <${CellOutput} outputs=${cell.outputs || []} error=${cell.error} />
      ` : null}
    </div>
  `;
} 