// Main application file for the notebook UI
import { h, render, Component } from 'https://esm.sh/preact@10.19.2';
import { useState, useEffect, useRef } from 'https://esm.sh/preact@10.19.2/hooks';
import { html } from 'https://esm.sh/htm@3.1.1/preact';

// Components
import { Notebook } from './components/Notebook.js';
import { KernelStatus } from './components/KernelStatus.js';

// Main App component
function App() {
  const [kernelId, setKernelId] = useState(null);
  const [kernelStatus, setKernelStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [notebooks, setNotebooks] = useState([]);
  const [currentNotebookId, setCurrentNotebookId] = useState(null);
  const [notebook, setNotebook] = useState(null);
  const [loading, setLoading] = useState(true);
  const websocketRef = useRef(null);
  
  // Initialize the application
  useEffect(() => {
    // Create a kernel when the app starts
    createKernel();
    
    // Load the list of notebooks
    fetchNotebooks();
    
    // Cleanup on unmount
    return () => {
      if (websocketRef.current) {
        websocketRef.current.close();
      }
      
      if (kernelId) {
        destroyKernel(kernelId);
      }
    };
  }, []);
  
  // When kernel ID changes, connect to the kernel events WebSocket
  useEffect(() => {
    if (kernelId) {
      connectToKernelEvents(kernelId);
    }
  }, [kernelId]);
  
  // When current notebook changes, fetch it
  useEffect(() => {
    if (currentNotebookId) {
      fetchNotebook(currentNotebookId);
    } else {
      setNotebook(null);
    }
  }, [currentNotebookId]);
  
  // Create a new kernel
  const createKernel = async () => {
    try {
      setLoading(true);
      setMessage('Creating kernel...');
      const response = await fetch('/api/kernels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      const data = await response.json();
      if (response.ok) {
        setKernelId(data.id);
        setMessage(`Kernel created: ${data.id}`);
      } else {
        setMessage(`Error creating kernel: ${data.error}`);
      }
    } catch (error) {
      setMessage(`Error creating kernel: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  // Destroy a kernel
  const destroyKernel = async (id) => {
    try {
      await fetch(`/api/kernels/${id}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.error('Error destroying kernel:', error);
    }
  };
  
  // Event handlers
  const handleStreamOutput = (data, cellId) => {
    // Add the stream output to the executing cell
    if (data.name && (data.name === 'stdout' || data.name === 'stderr') && data.text) {
      setNotebook(prevNotebook => {
        return {
          ...prevNotebook,
          cells: prevNotebook.cells.map(cell => {
            if (cell.id === cellId) {
              return {
                ...cell,
                outputs: [...(cell.outputs || []), {
                  name: data.name,
                  text: data.text
                }]
              };
            }
            return cell;
          })
        };
      });
    }
  };
  
  const handleExecuteResult = (data, cellId) => {
    if (data && data.data) {
      setNotebook(prevNotebook => {
        return {
          ...prevNotebook,
          cells: prevNotebook.cells.map(cell => {
            if (cell.id === cellId) {
              return {
                ...cell,
                outputs: [...(cell.outputs || []), {
                  data: data.data
                }]
              };
            }
            return cell;
          })
        };
      });
    }
    setKernelStatus('idle');
  };
  
  const handleExecuteError = (data, cellId) => {
    if (cellId) {
      setNotebook(prevNotebook => {
        return {
          ...prevNotebook,
          cells: prevNotebook.cells.map(cell => {
            if (cell.id === cellId) {
              return {
                ...cell,
                executing: false,
                error: data.traceback || data.ename + ': ' + data.evalue
              };
            }
            return cell;
          })
        };
      });
    }
    setKernelStatus('error');
  };
  
  const handleDisplayData = (data, cellId) => {
    if (data && data.data) {
      setNotebook(prevNotebook => {
        return {
          ...prevNotebook,
          cells: prevNotebook.cells.map(cell => {
            if (cell.id === cellId) {
              return {
                ...cell,
                outputs: [...(cell.outputs || []), {
                  data: data.data
                }]
              };
            }
            return cell;
          })
        };
      });
    }
  };
  
  const handleInputRequest = (data) => {
    // This is handled by the Notebook component
    console.log('Input request:', data);
  };
  
  // Execute code using SSE streaming API
  const executeCode = async (code, cellId) => {
    try {
      setKernelStatus('busy');
      // Mark cell as executing
      setNotebook(prevNotebook => {
        return {
          ...prevNotebook,
          cells: prevNotebook.cells.map(cell => {
            if (cell.id === cellId) {
              return {
                ...cell,
                executing: true,
                outputs: [] // Clear previous outputs
              };
            }
            return cell;
          })
        };
      });
      // Use SSE for streaming output
      const response = await fetch(`/api/kernels/${kernelId}/execute/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code }) // CHANGED: only send code
      });
      if (!response.body) throw new Error('No response body for SSE');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let lines = buffer.split('\n\n');
        buffer = lines.pop(); // last incomplete event
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const event = JSON.parse(line.slice(6));
            switch (event.type) {
              case 'stream':
                handleStreamOutput(event.data, cellId);
                break;
              case 'execute_result':
                handleExecuteResult(event.data, cellId);
                break;
              case 'error':
                handleExecuteError(event.data, cellId);
                break;
              case 'display_data':
                handleDisplayData(event.data, cellId);
                break;
            }
          }
        }
      }
      // Mark cell as done executing
      setNotebook(prevNotebook => {
        return {
          ...prevNotebook,
          cells: prevNotebook.cells.map(cell => {
            if (cell.id === cellId) {
              return {
                ...cell,
                executing: false,
                outputs: cell.outputs || []
              };
            }
            return cell;
          })
        };
      });
      setKernelStatus('idle');
      return { success: true };
    } catch (error) {
      setKernelStatus('error');
      setNotebook(prevNotebook => {
        return {
          ...prevNotebook,
          cells: prevNotebook.cells.map(cell => {
            if (cell.id === cellId) {
              return {
                ...cell,
                executing: false,
                error: error.toString()
              };
            }
            return cell;
          })
        };
      });
      return { success: false, error: error.toString() };
    }
  };
  
  // Fetch the list of notebooks
  const fetchNotebooks = async () => {
    try {
      const response = await fetch('/api/notebooks');
      const data = await response.json();
      
      setNotebooks(data);
      
      if (data.length > 0 && !currentNotebookId) {
        // Load the first notebook if none is selected
        setCurrentNotebookId(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching notebooks:', error);
    }
  };
  
  // Fetch a specific notebook
  const fetchNotebook = async (id) => {
    try {
      setLoading(true);
      
      const response = await fetch(`/api/notebooks/${id}`);
      const data = await response.json();
      
      if (response.ok) {
        setNotebook(data);
      } else {
        setMessage(`Error loading notebook: ${data.error}`);
        setNotebook(null);
      }
    } catch (error) {
      console.error('Error fetching notebook:', error);
      setMessage(`Error loading notebook: ${error.message}`);
      setNotebook(null);
    } finally {
      setLoading(false);
    }
  };
  
  // Create a new notebook
  const createNotebook = async () => {
    try {
      const name = prompt('Enter a name for the new notebook:', 'Untitled Notebook');
      
      if (!name) return;
      
      const response = await fetch('/api/notebooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          cells: [
            {
              id: `cell-${Date.now()}`,
              type: 'code',
              source: '# Welcome to Deno Notebook\n# Try running this cell to get started\nprint("Hello, world!")'
            }
          ]
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        // Refresh the list of notebooks
        fetchNotebooks();
        
        // Select the new notebook
        setCurrentNotebookId(data.id);
      } else {
        setMessage(`Error creating notebook: ${data.error}`);
      }
    } catch (error) {
      console.error('Error creating notebook:', error);
      setMessage(`Error creating notebook: ${error.message}`);
    }
  };
  
  // Save the current notebook
  const saveNotebook = async () => {
    if (!notebook) return;
    
    try {
      const response = await fetch(`/api/notebooks/${notebook.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(notebook)
      });
      
      if (response.ok) {
        setMessage('Notebook saved');
      } else {
        const data = await response.json();
        setMessage(`Error saving notebook: ${data.error}`);
      }
    } catch (error) {
      console.error('Error saving notebook:', error);
      setMessage(`Error saving notebook: ${error.message}`);
    }
  };
  
  // Update a cell in the notebook
  const updateCell = (cellId, updates) => {
    if (!notebook) return;
    
    setNotebook(prevNotebook => {
      return {
        ...prevNotebook,
        cells: prevNotebook.cells.map(cell => {
          if (cell.id === cellId) {
            return {
              ...cell,
              ...updates
            };
          }
          return cell;
        })
      };
    });
  };
  
  // Add a new cell to the notebook
  const addCell = (type = 'code', index) => {
    if (!notebook) return;
    
    const newCell = {
      id: `cell-${Date.now()}`,
      type,
      source: ''
    };
    
    setNotebook(prevNotebook => {
      const cells = [...prevNotebook.cells];
      
      if (index !== undefined) {
        cells.splice(index + 1, 0, newCell);
      } else {
        cells.push(newCell);
      }
      
      return {
        ...prevNotebook,
        cells
      };
    });
  };
  
  // Delete a cell from the notebook
  const deleteCell = (cellId) => {
    if (!notebook) return;
    
    setNotebook(prevNotebook => {
      return {
        ...prevNotebook,
        cells: prevNotebook.cells.filter(cell => cell.id !== cellId)
      };
    });
  };

  // Add an output to a cell
  const addCellOutput = (cellId, output) => {
    if (!notebook) return;
    
    setNotebook(prevNotebook => {
      return {
        ...prevNotebook,
        cells: prevNotebook.cells.map(cell => {
          if (cell.id === cellId) {
            return {
              ...cell,
              outputs: [...(cell.outputs || []), output]
            };
          }
          return cell;
        })
      };
    });
  };
  
  // Create a new example notebook for matplotlib
  const createMatplotlibExample = async () => {
    try {
      const response = await fetch('/api/notebooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'Matplotlib Example',
          cells: [
            {
              id: `cell-${Date.now()}`,
              type: 'code',
              source: '# Matplotlib Example Notebook\nprint("This notebook demonstrates using matplotlib with the Deno Code Interpreter")'
            },
            {
              id: `cell-${Date.now() + 1}`,
              type: 'code',
              source: '# Simple line plot\nimport matplotlib.pyplot as plt\nimport numpy as np\n\nx = np.linspace(0, 10, 100)\ny = np.sin(x)\n\nplt.figure(figsize=(8, 4))\nplt.plot(x, y)\nplt.title("Sine Wave")\nplt.xlabel("x")\nplt.ylabel("sin(x)")\nplt.grid(True)\nplt.show()'
            },
            {
              id: `cell-${Date.now() + 2}`,
              type: 'code',
              source: '# Multiple plots\nplt.figure(figsize=(10, 6))\n\n# First subplot\nplt.subplot(2, 2, 1)\nx1 = np.linspace(0, 5, 100)\ny1 = np.sin(x1)\nplt.plot(x1, y1, "b-")\nplt.title("Sine")\n\n# Second subplot\nplt.subplot(2, 2, 2)\nx2 = np.linspace(0, 5, 100)\ny2 = np.cos(x2)\nplt.plot(x2, y2, "r-")\nplt.title("Cosine")\n\n# Third subplot\nplt.subplot(2, 2, 3)\nx3 = np.linspace(0, 5, 100)\ny3 = np.tan(x3)\nplt.plot(x3, y3, "g-")\nplt.title("Tangent")\n\n# Fourth subplot\nplt.subplot(2, 2, 4)\nx4 = np.linspace(0, 5, 100)\ny4 = x4**2\nplt.plot(x4, y4, "k-")\nplt.title("Quadratic")\n\nplt.tight_layout()\nplt.show()'
            },
            {
              id: `cell-${Date.now() + 3}`,
              type: 'code',
              source: '# Scatter plot with colormap\nplt.figure(figsize=(8, 6))\n\nx = np.random.rand(100)\ny = np.random.rand(100)\ncolors = np.random.rand(100)\nsizes = 1000 * np.random.rand(100)\n\nplt.scatter(x, y, c=colors, s=sizes, alpha=0.5, cmap="viridis")\nplt.colorbar()\nplt.title("Scatter Plot with Colormap")\nplt.show()'
            },
            {
              id: `cell-${Date.now() + 4}`,
              type: 'code',
              source: '# 3D plot\nfrom mpl_toolkits.mplot3d import Axes3D\n\nfig = plt.figure(figsize=(10, 8))\nax = fig.add_subplot(111, projection="3d")\n\n# Create data\nx = np.linspace(-5, 5, 50)\ny = np.linspace(-5, 5, 50)\nX, Y = np.meshgrid(x, y)\nZ = np.sin(np.sqrt(X**2 + Y**2))\n\n# Plot the surface\nsurf = ax.plot_surface(X, Y, Z, cmap="viridis", linewidth=0, antialiased=True)\n\n# Add a color bar\nfig.colorbar(surf, ax=ax, shrink=0.5, aspect=5)\n\nax.set_title("3D Surface Plot")\nax.set_xlabel("X axis")\nax.set_ylabel("Y axis")\nax.set_zlabel("Z axis")\n\nplt.show()'
            }
          ]
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        fetchNotebooks();
        setCurrentNotebookId(data.id);
      } else {
        setMessage(`Error creating example: ${data.error}`);
      }
    } catch (error) {
      console.error('Error creating example:', error);
      setMessage(`Error creating example: ${error.message}`);
    }
  };
  
  // Create a new example notebook for Plotly
  const createPlotlyExample = async () => {
    try {
      const response = await fetch('/api/notebooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'Plotly Example',
          cells: [
            {
              id: `cell-${Date.now()}`,
              type: 'code',
              source: '# Plotly Example Notebook\nprint("This notebook demonstrates using Plotly with the Deno Code Interpreter")'
            },
            {
              id: `cell-${Date.now() + 1}`,
              type: 'code',
              source: '# Install plotly if not already installed\nimport sys\nif "plotly" not in sys.modules:\n    !pip install plotly\n\nimport plotly.express as px\nimport numpy as np\nimport pandas as pd\nfrom IPython.display import display, HTML'
            },
            {
              id: `cell-${Date.now() + 2}`,
              type: 'code',
              source: '# Simple line chart with Plotly\ndf = pd.DataFrame({\n    "x": np.linspace(0, 10, 100),\n    "y": np.sin(np.linspace(0, 10, 100))\n})\n\nfig = px.line(df, x="x", y="y", title="Sine Wave with Plotly")\ndisplay(fig)'
            },
            {
              id: `cell-${Date.now() + 3}`,
              type: 'code',
              source: '# Interactive scatter plot\nimport plotly.graph_objects as go\n\n# Generate random data\nnp.random.seed(42)\nn = 100\nx = np.random.randn(n)\ny = np.random.randn(n)\nsize = np.random.uniform(5, 15, n)\ncolor = np.random.randn(n)\n\n# Create figure\nfig = go.Figure()\n\nfig.add_trace(\n    go.Scatter(\n        x=x,\n        y=y,\n        mode="markers",\n        marker=dict(\n            size=size,\n            color=color,\n            colorscale="Viridis",\n            showscale=True\n        ),\n        text=[f"Point {i}" for i in range(n)],\n        hoverinfo="text+x+y"\n    )\n)\n\nfig.update_layout(\n    title="Interactive Scatter Plot",\n    width=800,\n    height=600,\n    xaxis_title="X Axis",\n    yaxis_title="Y Axis"\n)\n\ndisplay(fig)'
            },
            {
              id: `cell-${Date.now() + 4}`,
              type: 'code',
              source: '# 3D Surface plot\nx = np.outer(np.linspace(-3, 3, 50), np.ones(50))\ny = x.copy().T\nz = np.cos(x) * np.cos(y * 2)\n\nfig = go.Figure(data=[go.Surface(z=z, x=x, y=y)])\nfig.update_layout(\n    title="3D Surface Plot",\n    width=800,\n    height=700,\n    scene=dict(\n        xaxis_title="X Axis",\n        yaxis_title="Y Axis",\n        zaxis_title="Z Axis"\n    )\n)\n\ndisplay(fig)'
            },
            {
              id: `cell-${Date.now() + 5}`,
              type: 'code',
              source: '# Interactive Bar Chart\ncountries = ["USA", "China", "India", "Japan", "Germany", "UK", "France", "Brazil", "Italy", "Canada"]\npopulation = [331, 1441, 1380, 126, 83, 68, 65, 213, 60, 38]\n\nfig = px.bar(\n    x=countries,\n    y=population,\n    title="Population by Country (in millions)",\n    labels={"x": "Country", "y": "Population (millions)"},\n    color=population,\n    color_continuous_scale="Viridis"\n)\n\nfig.update_layout(width=800, height=500)\ndisplay(fig)'
            }
          ]
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        fetchNotebooks();
        setCurrentNotebookId(data.id);
      } else {
        setMessage(`Error creating example: ${data.error}`);
      }
    } catch (error) {
      console.error('Error creating example:', error);
      setMessage(`Error creating example: ${error.message}`);
    }
  };
  
  // Create a new example notebook for ipywidgets
  const createWidgetsExample = async () => {
    try {
      const response = await fetch('/api/notebooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'IPyWidgets Example',
          cells: [
            {
              id: `cell-${Date.now()}`,
              type: 'code',
              source: '# IPyWidgets Example Notebook\nprint("This notebook demonstrates using ipywidgets with the Deno Code Interpreter")'
            },
            {
              id: `cell-${Date.now() + 1}`,
              type: 'code',
              source: '# Install ipywidgets if not already installed\nimport sys\nif "ipywidgets" not in sys.modules:\n    !pip install ipywidgets\n\nimport ipywidgets as widgets\nfrom IPython.display import display\nimport matplotlib.pyplot as plt\nimport numpy as np'
            },
            {
              id: `cell-${Date.now() + 2}`,
              type: 'code',
              source: '# Simple slider\nslider = widgets.IntSlider(\n    value=50,\n    min=0,\n    max=100,\n    step=1,\n    description="Value:",\n    continuous_update=False\n)\ndisplay(slider)'
            },
            {
              id: `cell-${Date.now() + 3}`,
              type: 'code',
              source: '# Interactive plot with a slider\nx = np.linspace(0, 10, 1000)\n\ndef plot_sin(frequency=1.0):\n    plt.figure(figsize=(10, 6))\n    plt.plot(x, np.sin(frequency * x))\n    plt.title(f"Sine Wave with Frequency {frequency:.2f}")\n    plt.xlabel("x")\n    plt.ylabel("sin(frequency * x)")\n    plt.grid(True)\n    plt.ylim(-1.1, 1.1)\n    plt.show()\n\nfrequency_slider = widgets.FloatSlider(\n    value=1.0,\n    min=0.1,\n    max=5.0,\n    step=0.1,\n    description="Frequency:",\n    continuous_update=False\n)\n\nwidgets.interact(plot_sin, frequency=frequency_slider)'
            },
            {
              id: `cell-${Date.now() + 4}`,
              type: 'code',
              source: '# Interactive widgets\n# Create dropdown\ndropdown = widgets.Dropdown(\n    options=["Circle", "Square", "Triangle"],\n    value="Circle",\n    description="Shape:"\n)\n\n# Create sliders\ncolor_picker = widgets.ColorPicker(\n    concise=False,\n    description="Color",\n    value="#FF0000"\n)\n\nsize_slider = widgets.IntSlider(\n    value=5,\n    min=1,\n    max=10,\n    step=1,\n    description="Size:"\n)\n\n# Function to draw the shape\ndef draw_shape(shape, color, size):\n    plt.figure(figsize=(6, 6))\n    ax = plt.gca()\n    \n    if shape == "Circle":\n        circle = plt.Circle((0.5, 0.5), size/20, color=color)\n        ax.add_patch(circle)\n    elif shape == "Square":\n        square = plt.Rectangle((0.5-size/20, 0.5-size/20), size/10, size/10, color=color)\n        ax.add_patch(square)\n    elif shape == "Triangle":\n        points = np.array([[0.5, 0.5+size/20], [0.5-size/20, 0.5-size/20], [0.5+size/20, 0.5-size/20]])\n        triangle = plt.Polygon(points, color=color)\n        ax.add_patch(triangle)\n    \n    ax.set_xlim(0, 1)\n    ax.set_ylim(0, 1)\n    ax.set_aspect("equal")\n    ax.set_title(f"{shape} with size {size}")\n    plt.grid(True)\n    plt.show()\n\n# Connect the widgets to the function\nwidgets.interact(draw_shape, shape=dropdown, color=color_picker, size=size_slider)'
            },
            {
              id: `cell-${Date.now() + 5}`,
              type: 'code',
              source: '# Button and output widget example\noutput = widgets.Output()\nbutton = widgets.Button(description="Click me!")\ncounter = 0\n\n@output.capture()\ndef on_button_clicked(b):\n    global counter\n    counter += 1\n    print(f"Button clicked {counter} times")\n    if counter % 5 == 0:\n        print("High five! 🖐️")\n\nbutton.on_click(on_button_clicked)\n\ndisplay(button, output)'
            }
          ]
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        fetchNotebooks();
        setCurrentNotebookId(data.id);
      } else {
        setMessage(`Error creating example: ${data.error}`);
      }
    } catch (error) {
      console.error('Error creating example:', error);
      setMessage(`Error creating example: ${error.message}`);
    }
  };
  
  return html`
    <div class="app">
      <h1>Deno Notebook</h1>
      
      ${message && html`<div class="message">${message}</div>`}
      
      <div class="notebook-controls">
        <div class="notebook-selector">
          <label>
            Notebook: 
            <select value=${currentNotebookId} onChange=${e => setCurrentNotebookId(e.target.value)}>
              <option value="">-- Select Notebook --</option>
              ${notebooks.map(nb => html`
                <option key=${nb.id} value=${nb.id}>${nb.name}</option>
              `)}
            </select>
          </label>
        </div>
        
        <div class="notebook-actions">
          <button onClick=${createNotebook}>New Notebook</button>
          <button onClick=${saveNotebook} disabled=${!notebook}>Save</button>
          <button onClick=${createMatplotlibExample}>Matplotlib Example</button>
          <button onClick=${createPlotlyExample}>Plotly Example</button>
          <button onClick=${createWidgetsExample}>Widgets Example</button>
        </div>
      </div>
      
      ${loading ? html`<div>Loading...</div>` : (
        notebook ? html`
          <${Notebook}
            notebook=${notebook}
            executeCode=${executeCode}
            updateCell=${updateCell}
            addCell=${addCell}
            deleteCell=${deleteCell}
            addCellOutput=${addCellOutput}
          />
        ` : html`
          <div>No notebook selected. Select a notebook or create a new one.</div>
        `
      )}
      
      <${KernelStatus} status=${kernelStatus} kernelId=${kernelId} />
    </div>
  `;
}

// Render the app to the DOM
document.addEventListener('DOMContentLoaded', () => {
  render(h(App, {}), document.getElementById('app'));
}); 