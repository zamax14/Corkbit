import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { signIn } from './auth/session';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import './styles.css';

// La sesión se resuelve antes de montar nada: sin ella, Keycloak se lleva al navegador y no
// llegamos a pintar un tablero vacío que luego se llenaría de 401.
signIn().then(
  () =>
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  (error: Error) => {
    document.getElementById('root')!.textContent = `No se pudo iniciar sesión: ${error.message}`;
  },
);
