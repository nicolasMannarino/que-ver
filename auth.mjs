// Cuentas, sesiones y la API key de cada uno.
//
// Una CUENTA es una persona con mail y contraseña. Adentro tiene sus PERFILES
// (vos, tu viejo), que son los que ya existían. Entrás con tus credenciales
// desde donde sea y ves tus perfiles: nada más y nada menos.
//
// Todo con lo que ya trae Node: scrypt para las contraseñas, HMAC para firmar
// la cookie, AES-GCM para guardar la key de TMDB. Cero dependencias nuevas.
import crypto from "node:crypto";
import * as A from "./almacen.mjs";

const F_CUENTAS = "cuentas.json";
const COOKIE = "qv_sesion";
const DURACION_MS = 90 * 24 * 3600e3;          // 90 días

// --- Secreto del servidor ---------------------------------------------------
// Firma las cookies y cifra las keys de TMDB. Si cambia, se caen todas las
// sesiones y ninguna key guardada se puede volver a leer.

function secreto() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.DATABASE_URL) {
    // En el hosting no hay dónde dejar un secreto generado al vuelo: cada
    // reinicio inventaría otro y desloguearía a todo el mundo. Mejor romper
    // ahora, con un mensaje claro, que a los tres días sin entender por qué.
    console.error(
      "\n  FALTA SESSION_SECRET (32+ caracteres).\n" +
      "  Generá uno con:  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
      "  y cargalo como variable de entorno en Render.\n");
    process.exit(1);
  }
  // Local: uno estable guardado en data/, así no te deslogueás en cada reinicio.
  let g = A.leer("secreto.json", null);
  if (!g?.valor) {
    g = { valor: crypto.randomBytes(32).toString("hex") };
    A.escribir("secreto.json", g);
  }
  return g.valor;
}
let SECRETO = null;
const clave = () => (SECRETO ??= secreto());
const claveDe = (uso) => crypto.createHash("sha256").update(clave() + "|" + uso).digest();

// El login solo se exige cuando la app está publicada. En tu compu seguís
// entrando directo, como siempre.
export const requiereLogin = () =>
  !!process.env.DATABASE_URL || process.env.REQUERIR_LOGIN === "1";

// --- Contraseñas ------------------------------------------------------------

const hashear = (pass, sal) =>
  crypto.scryptSync(pass.normalize("NFKC"), sal, 64, { N: 16384, r: 8, p: 1 }).toString("hex");

// Comparación en tiempo constante: comparar con === filtra la contraseña por
// cuánto tarda en fallar.
function iguales(a, b) {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// --- Cifrado de la key de TMDB ----------------------------------------------
// En claro en la base, cualquiera con acceso a un backup se lleva las keys de
// todos. Cifrada, hace falta además el secreto del servidor.

export function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", claveDe("tmdb"), iv);
  const dato = Buffer.concat([c.update(String(texto), "utf8"), c.final()]);
  return [iv.toString("base64url"), c.getAuthTag().toString("base64url"), dato.toString("base64url")].join(".");
}

export function descifrar(guardado) {
  try {
    const [iv, tag, dato] = String(guardado).split(".");
    const d = crypto.createDecipheriv("aes-256-gcm", claveDe("tmdb"), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(dato, "base64url")), d.final()]).toString("utf8");
  } catch { return ""; }   // secreto cambiado o dato corrupto: como si no hubiera key
}

// --- Cuentas ----------------------------------------------------------------

const cuentas = () => A.leer(F_CUENTAS, []);
const guardarCuentas = (l) => A.escribir(F_CUENTAS, l);
const normalizarMail = (m) => String(m || "").trim().toLowerCase();

export const buscarCuenta = (id) => cuentas().find(c => c.id === id) || null;
export const cuentaPorMail = (mail) => cuentas().find(c => c.email === normalizarMail(mail)) || null;

export class ErrorAuth extends Error {}

export function registrar(mail, pass) {
  const email = normalizarMail(mail);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErrorAuth("Ese mail no parece un mail.");
  if (String(pass || "").length < 8) throw new ErrorAuth("La contraseña tiene que tener al menos 8 caracteres.");
  if (cuentaPorMail(email)) throw new ErrorAuth("Ya hay una cuenta con ese mail.");

  const sal = crypto.randomBytes(16).toString("hex");
  const cuenta = {
    id: crypto.randomUUID(),
    email,
    sal,
    hash: hashear(pass, sal),
    tmdbKey: "",                       // cifrada, se carga después
    creada: new Date().toISOString(),
  };
  guardarCuentas([...cuentas(), cuenta]);
  return cuenta;
}

// Freno a la fuerza bruta. En memoria: se limpia en cada reinicio, y alcanza
// para lo que es esto. Si algún día hay que aguantar de verdad, va a la base.
const intentos = new Map();
function frenar(llave) {
  const ahora = Date.now();
  const x = intentos.get(llave);
  if (x && ahora - x.desde > 15 * 60e3) intentos.delete(llave);
  const y = intentos.get(llave);
  if (y && y.n >= 8) throw new ErrorAuth("Demasiados intentos. Probá de nuevo en 15 minutos.");
}
function fallo(llave) {
  const x = intentos.get(llave) || { n: 0, desde: Date.now() };
  x.n++;
  intentos.set(llave, x);
}

export function entrar(mail, pass, ip = "") {
  const email = normalizarMail(mail);
  const llave = email + "|" + ip;
  frenar(llave);
  const c = cuentaPorMail(email);
  // Mismo mensaje exista o no la cuenta: si no, la pantalla de login se
  // convierte en una forma de averiguar quién está registrado.
  const generico = "Mail o contraseña incorrectos.";
  if (!c) { fallo(llave); throw new ErrorAuth(generico); }
  if (!iguales(hashear(pass, c.sal), c.hash)) { fallo(llave); throw new ErrorAuth(generico); }
  intentos.delete(llave);
  return c;
}

export function cambiarKeyTmdb(cuentaId, key) {
  const l = cuentas();
  const c = l.find(x => x.id === cuentaId);
  if (!c) throw new ErrorAuth("No existe la cuenta.");
  c.tmdbKey = key ? cifrar(String(key).trim()) : "";
  guardarCuentas(l);
  return c;
}

export const keyTmdbDe = (cuenta) => (cuenta?.tmdbKey ? descifrar(cuenta.tmdbKey) : "");

// --- Sesión en cookie firmada ------------------------------------------------
// Sin tabla de sesiones: la cookie lleva el id y su vencimiento, firmados. No
// se puede falsificar sin el secreto, y no cuesta una consulta por request.

const firmar = (dato) =>
  crypto.createHmac("sha256", claveDe("cookie")).update(dato).digest("base64url");

export function crearSesion(cuentaId) {
  const dato = Buffer.from(JSON.stringify({ c: cuentaId, exp: Date.now() + DURACION_MS }), "utf8").toString("base64url");
  return dato + "." + firmar(dato);
}

export function leerSesion(cookieHeader) {
  const bruto = (cookieHeader || "").split(";").map(s => s.trim())
    .find(s => s.startsWith(COOKIE + "="));
  if (!bruto) return null;
  const [dato, firma] = decodeURIComponent(bruto.slice(COOKIE.length + 1)).split(".");
  if (!dato || !firma || !iguales(firma, firmar(dato))) return null;
  try {
    const { c, exp } = JSON.parse(Buffer.from(dato, "base64url").toString("utf8"));
    if (!c || Date.now() > exp) return null;
    return buscarCuenta(c);            // borrada la cuenta, muerta la sesión
  } catch { return null; }
}

// Secure solo con HTTPS: en tu compu es http y el navegador tiraría la cookie.
// Render termina TLS y avisa por x-forwarded-proto.
export function cookieDeSesion(valor, req) {
  const https = (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
  const partes = [
    COOKIE + "=" + encodeURIComponent(valor),
    "Path=/", "HttpOnly", "SameSite=Lax",
    "Max-Age=" + (valor ? Math.floor(DURACION_MS / 1000) : 0),
  ];
  if (https) partes.push("Secure");
  return partes.join("; ");
}

export const cookieVacia = (req) => cookieDeSesion("", req);

// Lo que la web puede saber de una cuenta. El hash y la sal no salen de acá.
export const publico = (c) => c && ({ id: c.id, email: c.email, tieneKey: !!c.tmdbKey });

export const cantidadDeCuentas = () => cuentas().length;
