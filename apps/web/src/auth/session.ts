import Keycloak from 'keycloak-js';

// La redirect URI registrada en Keycloak es exacta, sin comodines: siempre la raíz del sitio.
// Eso rompería los QR de los tickets impresos, que apuntan a /t/{id}, así que el destino real
// se guarda antes de salir y se restaura al volver.
const DESTINATION = 'corkbit:destination';

let keycloak: Keycloak | null = null;

interface AuthConfig {
  issuer: string;
  client_id: string;
}

function splitIssuer(issuer: string): { url: string; realm: string } {
  const [url, realm] = issuer.split('/realms/');
  return { url, realm };
}

/** Deja la sesión lista antes de pintar nada. Si no hay sesión, redirige a Keycloak y no vuelve.
 *
 * Con una API sin Keycloak configurado sigue adelante sin sesión. No es un agujero: quien decide
 * si se puede hacer algo es la API, que responde 401 sin token. El navegador nunca es la puerta.
 */
export async function signIn(): Promise<Keycloak | null> {
  const base = import.meta.env.VITE_API_URL || '/api';
  const config: AuthConfig = await (await fetch(`${base}/auth-config`)).json();
  if (!config.issuer) return null;

  const { url, realm } = splitIssuer(config.issuer);
  keycloak = new Keycloak({ url, realm, clientId: config.client_id });

  const authenticated = await keycloak.init({
    onLoad: 'check-sso',
    pkceMethod: 'S256',
    redirectUri: `${window.location.origin}/`,
  });

  if (!authenticated) {
    sessionStorage.setItem(DESTINATION, window.location.pathname + window.location.search);
    await keycloak.login({ redirectUri: `${window.location.origin}/` });
    await new Promise(() => {}); // login() navega fuera; no sigas pintando mientras tanto.
  }

  const destination = sessionStorage.getItem(DESTINATION);
  if (destination && destination !== '/') {
    sessionStorage.removeItem(DESTINATION);
    window.history.replaceState(null, '', destination);
  }
  return keycloak;
}

/** Token fresco para la siguiente llamada. Keycloak lo renueva si le quedan menos de 30 s. */
export async function accessToken(): Promise<string> {
  if (!keycloak) return '';
  await keycloak.updateToken(30).catch(() => keycloak?.login());
  return keycloak.token ?? '';
}

export const currentName = (): string =>
  (keycloak?.tokenParsed?.name as string) ||
  (keycloak?.tokenParsed?.preferred_username as string) ||
  '';

export const signOut = (): void => {
  void keycloak?.logout({ redirectUri: `${window.location.origin}/` });
};
