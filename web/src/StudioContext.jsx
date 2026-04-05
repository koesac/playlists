import React, { createContext, useState, useContext } from 'react';

const StudioContext = createContext(null);

export function StudioProvider({ children }) {
  const [importQueue, setImportQueue] = useState([]);

  const queueForImport = (trackNodes) => {
    const items = Array.isArray(trackNodes) ? trackNodes : [trackNodes];
    setImportQueue(prev => {
      const existingIds = new Set(prev.map(t => t.id));
      return [...prev, ...items.filter(t => !existingIds.has(t.id))];
    });
  };

  const clearQueue = () => setImportQueue([]);

  return (
    <StudioContext.Provider value={{ importQueue, queueForImport, clearQueue }}>
      {children}
    </StudioContext.Provider>
  );
}

export const useStudio = () => useContext(StudioContext);