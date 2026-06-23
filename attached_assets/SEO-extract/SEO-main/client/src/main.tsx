import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Log application startup
console.log("Application starting up...");

try {
  // Find or create the root element
  let rootElement = document.getElementById("root");
  console.log("Root element found:", !!rootElement);

  // Remove any loading indicator
  if (rootElement) {
    // Keep reference to any child nodes we want to clear
    const childNodes = Array.from(rootElement.childNodes);
    
    // Create and render into the root
    const root = createRoot(rootElement);
    
    // Create a function to clear the loading indicator after render
    const clearLoadingIndicator = () => {
      if (childNodes.length > 0 && rootElement) {
        console.log("Clearing loading indicator");
        // We delay this slightly to avoid flash of content
        setTimeout(() => {
          childNodes.forEach(node => {
            if (node.parentNode === rootElement && rootElement) {
              rootElement.removeChild(node);
            }
          });
        }, 100);
      }
    };
    
    // Render the application
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    
    // Clear loading indicator
    clearLoadingIndicator();
  } else {
    console.error("Could not find root element to mount React app");
    
    // Create root element if it doesn't exist
    rootElement = document.createElement("div");
    rootElement.id = "root";
    document.body.appendChild(rootElement);
    
    // Create and render
    const root = createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
  
  console.log("React application rendered successfully");
} catch (error) {
  console.error("Failed to render React application:", error);
  
  // Display error message in the DOM
  const errorDiv = document.createElement("div");
  errorDiv.style.color = "red";
  errorDiv.style.padding = "20px";
  errorDiv.style.margin = "20px";
  errorDiv.style.border = "1px solid red";
  errorDiv.innerHTML = `
    <h2>Application Error</h2>
    <p>There was an error rendering the application:</p>
    <pre>${error instanceof Error ? error.message : String(error)}</pre>
    <button onclick="window.location.reload()">Reload Page</button>
  `;
  
  document.body.appendChild(errorDiv);
}
