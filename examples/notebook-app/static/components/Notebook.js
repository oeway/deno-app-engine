// Notebook component
import { h, Component } from 'https://esm.sh/preact@10.19.2';
import { useState, useEffect, useRef } from 'https://esm.sh/preact@10.19.2/hooks';
import { html } from 'https://esm.sh/htm@3.1.1/preact';
import { Cell } from './Cell.js';

export function Notebook({
  notebook,
  executeCode,
  updateCell,
  addCell,
  deleteCell,
  addCellOutput
}) {
  const [activeCell, setActiveCell] = useState(null);
  
  // Set focus to the first cell when loading a new notebook
  useEffect(() => {
    if (notebook && notebook.cells.length > 0) {
      setActiveCell(notebook.cells[0].id);
    }
  }, [notebook?.id]);
  
  if (!notebook) {
    return html`<div>No notebook loaded.</div>`;
  }
  
  // Handle cell execution
  const handleExecuteCell = async (cellId, code) => {
    await executeCode(code, cellId);
  };
  
  // Handle adding a new cell after the current one
  const handleAddCell = (index) => {
    addCell('code', index);
  };
  
  // Set active cell when clicked
  const handleCellClick = (cellId) => {
    setActiveCell(cellId);
  };
  
  return html`
    <div class="notebook">
      <h2 class="notebook-title">${notebook.name}</h2>
      
      <div class="cells-container">
        ${notebook.cells.map((cell, index) => html`
          <${Cell}
            key=${cell.id}
            cell=${cell}
            active=${cell.id === activeCell}
            onCellClick=${() => handleCellClick(cell.id)}
            onExecute=${(code) => handleExecuteCell(cell.id, code)}
            onUpdate=${(updates) => updateCell(cell.id, updates)}
            onDelete=${() => deleteCell(cell.id)}
            onAddBelow=${() => handleAddCell(index)}
          />
        `)}
      </div>
      
      <div class="add-cell">
        <button onClick=${() => addCell('code')}>+ Add Cell</button>
      </div>
    </div>
  `;
} 