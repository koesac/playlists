import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import { StudioProvider } from './StudioContext';

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <StudioProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StudioProvider>
  </React.StrictMode>
);
