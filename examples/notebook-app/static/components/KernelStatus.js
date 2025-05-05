// Kernel Status component
import { h, Component } from 'https://esm.sh/preact@10.19.2';
import { html } from 'https://esm.sh/htm@3.1.1/preact';

export function KernelStatus({ status = 'idle', kernelId = null }) {
  if (!kernelId) {
    return html`<div class="kernel-status">No kernel connected</div>`;
  }
  
  const statusClasses = {
    idle: 'status-idle',
    busy: 'status-busy',
    error: 'status-error'
  };
  
  const statusTexts = {
    idle: 'Kernel Idle',
    busy: 'Kernel Busy',
    error: 'Kernel Error'
  };
  
  return html`
    <div class="kernel-status">
      <span class="status-indicator ${statusClasses[status] || 'status-idle'}"></span>
      <span class="status-text">${statusTexts[status] || 'Unknown Status'}</span>
      <span class="kernel-id">(${kernelId})</span>
    </div>
  `;
} 