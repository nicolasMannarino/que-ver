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

// Las más tipeadas del mundo. No es una lista exhaustiva ni pretende serlo: el
// que ataca prueba las primeras mil, y estas son las que aparecen en cada
// filtración. Frenar las obvias cuesta veinte líneas.
const OBVIAS = new Set([
  "contrasena", "contraseña", "password", "password1", "passw0rd", "123456789",
  "1234567890", "12345678", "qwertyuiop", "1q2w3e4r5t", "iloveyou", "princess",
  "admin1234", "welcome123", "abc123456", "letmein123", "monkey123", "football",
  "baseball", "superman", "trustno1", "sunshine", "starwars", "whatever",
  "qwerty123", "1qaz2wsx", "zaq12wsx", "asdfghjkl", "michael1", "jennifer",
]);

export const LARGO_MINIMO = 10;

// Devuelve el motivo por el que NO sirve, o null si está bien.
export function motivoPassDebil(pass, email = "") {
  const p = String(pass || "");
  if (p.length < LARGO_MINIMO) return `La contraseña tiene que tener al menos ${LARGO_MINIMO} caracteres.`;
  if (p.length > 200) return "Esa contraseña es absurdamente larga.";
  const plano = p.toLowerCase().normalize("NFKC");
  if (OBVIAS.has(plano)) return "Esa contraseña es de las más usadas del mundo. Poné otra.";
  if (/^(.)\1+$/.test(p)) return "Una sola letra repetida no es una contraseña.";
  // Secuencias corridas del teclado o de los números
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/.test(plano)) return "Eso es una secuencia del teclado. Poné otra.";
  const usuario = String(email || "").split("@")[0].toLowerCase();
  if (usuario.length >= 4 && plano.includes(usuario)) return "La contraseña no puede contener tu mail.";
  // Variedad: no le pido símbolos obligatorios (empujan a "Password1!", que no
  // suma nada), pero sí que no sea un solo tipo de caracter de punta a punta.
  const clases = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(r => r.test(p)).length;
  if (clases < 2) return "Mezclá al menos dos cosas: mayúsculas, minúsculas, números o símbolos.";
  return null;
}

export function registrar(mail, pass, { codigo = "", ip = "" } = {}) {
  const email = normalizarMail(mail);
  frenar("registro|" + ip, 6, "Demasiadas cuentas desde acá. Probá en 15 minutos.");

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErrorAuth("Ese mail no parece un mail.");
  const debil = motivoPassDebil(pass, email);
  if (debil) throw new ErrorAuth(debil);
  if (cuentaPorMail(email)) throw new ErrorAuth("Ya hay una cuenta con ese mail.");

  // El portón de verdad: sin invitación no se entra. Un desconocido que llegue a
  // la URL ve la pantalla de entrar y no tiene por dónde seguir.
  const invitacion = validarInvitacion(codigo, email, ip);

  const sal = crypto.randomBytes(16).toString("hex");
  const cuenta = {
    id: crypto.randomUUID(),
    email,
    sal,
    hash: hashear(pass, sal),
    tmdbKey: "",                       // cifrada, se carga después
    v: 1,                              // versión de sesión, para desloguear todo
    creada: new Date().toISOString(),
  };
  guardarCuentas([...cuentas(), cuenta]);
  if (invitacion) consumirInvitacion(invitacion, cuenta);
  // Se cuentan las cuentas CREADAS, no los intentos fallidos: limitar los
  // errores dejaría afuera a alguien por equivocarse seis veces al tipear.
  fallo("registro|" + ip);
  return cuenta;
}

// Freno a la fuerza bruta. En memoria: se limpia en cada reinicio, y alcanza
// para lo que es esto. Si algún día hay que aguantar de verdad, va a la base.
const fallos = new Map();
const VENTANA_MS = 15 * 60e3;

function frenar(llave, maximo = 8, mensaje = "Demasiados intentos. Probá de nuevo en 15 minutos.") {
  const x = fallos.get(llave);
  if (x && Date.now() - x.desde > VENTANA_MS) { fallos.delete(llave); return; }
  if (x && x.n >= maximo) throw new ErrorAuth(mensaje);
}
function fallo(llave) {
  const x = fallos.get(llave) || { n: 0, desde: Date.now() };
  x.n++;
  fallos.set(llave, x);
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
  fallos.delete(llave);
  return c;
}

// --- Invitaciones -----------------------------------------------------------
// Para crearse una cuenta hay que traer un código que salió de acá adentro.
// Se guardan HASHEADOS: quien se lleve un backup de la base no se lleva
// invitaciones usables, igual que no se lleva contraseñas.

const F_INVITES = "invitaciones.json";
const invitaciones = () => A.leer(F_INVITES, []);
const guardarInvitaciones = (l) => A.escribir(F_INVITES, l);

const hashCodigo = (c) => crypto.createHash("sha256").update(normalizarCodigo(c)).digest("hex");
// Sin vocales: así no sale ninguna palabra fea por casualidad, y sin 0/O ni 1/I,
// que son las que se copian mal cuando alguien lo pasa a mano.
const ALFABETO = "23456789BCDFGHJKLMNPQRSTVWXZ";
const normalizarCodigo = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function generarCodigo() {
  const bytes = crypto.randomBytes(16);
  let s = "";
  for (let i = 0; i < 16; i++) s += ALFABETO[bytes[i] % ALFABETO.length];
  return s.match(/.{4}/g).join("-");            // ABCD-EFGH-IJKL-MNOP
}

// El dueño es la primera cuenta que se creó. Con ADMIN_EMAILS se puede fijar a
// mano, que es lo que conviene si algún día hay más de una persona.
export function esAdmin(cuenta) {
  if (!cuenta) return false;
  const fijos = (process.env.ADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (fijos.length) return fijos.includes(cuenta.email);
  const primera = [...cuentas()].sort((a, b) => String(a.creada).localeCompare(String(b.creada)))[0];
  return !!primera && primera.id === cuenta.id;
}

// Una lista de mails habilitados que no necesita código. Es la escotilla para
// no quedarte afuera de tu propia app si perdés todas las invitaciones.
const mailLibre = (email) =>
  (process.env.REGISTRO_PERMITIDO || "").split(",").map(s => s.trim().toLowerCase())
    .filter(Boolean).includes(email);

function validarInvitacion(codigo, email, ip) {
  if (mailLibre(email)) return null;

  // La primera cuenta de todas no puede tener quién la invite.
  if (!cuentas().length) return null;

  frenar("invite|" + ip, 10, "Demasiados códigos probados. Esperá 15 minutos.");
  const limpio = normalizarCodigo(codigo);
  if (!limpio) throw new ErrorAuth("Para crear una cuenta hace falta un código de invitación.");

  const lista = invitaciones();
  const hash = hashCodigo(limpio);
  const inv = lista.find(i => iguales(i.hash, hash));
  if (!inv) { fallo("invite|" + ip); throw new ErrorAuth("Ese código de invitación no existe."); }
  if (inv.revocada) throw new ErrorAuth("Ese código fue dado de baja.");
  if (inv.vence && Date.now() > Date.parse(inv.vence)) throw new ErrorAuth("Ese código venció.");
  if (inv.usos >= inv.maxUsos) throw new ErrorAuth("Ese código ya se usó.");
  fallos.delete("invite|" + ip);
  return inv;
}

function consumirInvitacion(inv, cuenta) {
  const lista = invitaciones();
  const guardada = lista.find(i => i.hash === inv.hash);
  if (!guardada) return;
  guardada.usos++;
  (guardada.usadaPor ||= []).push({ email: cuenta.email, cuando: new Date().toISOString() });
  guardarInvitaciones(lista);
}

// Devuelve el código en claro UNA sola vez: después queda solo el hash y no hay
// forma de recuperarlo. Si se pierde, se genera otro.
export function crearInvitacion(cuenta, { etiqueta = "", maxUsos = 1, dias = 14 } = {}) {
  if (!esAdmin(cuenta)) throw new ErrorAuth("Solo el dueño puede generar invitaciones.");
  const codigo = generarCodigo();
  const inv = {
    hash: hashCodigo(codigo),
    etiqueta: String(etiqueta || "").trim().slice(0, 40),
    maxUsos: Math.max(1, Math.min(20, Number(maxUsos) || 1)),
    usos: 0,
    usadaPor: [],
    revocada: false,
    creada: new Date().toISOString(),
    creadaPor: cuenta.email,
    vence: dias > 0 ? new Date(Date.now() + dias * 24 * 3600e3).toISOString() : null,
  };
  guardarInvitaciones([...invitaciones(), inv]);
  return { codigo, invitacion: publicaInvitacion(inv) };
}

export function revocarInvitacion(cuenta, hash) {
  if (!esAdmin(cuenta)) throw new ErrorAuth("Solo el dueño puede dar de baja invitaciones.");
  const lista = invitaciones();
  const inv = lista.find(i => i.hash === hash);
  if (!inv) throw new ErrorAuth("No existe esa invitación.");
  inv.revocada = true;
  guardarInvitaciones(lista);
  return publicaInvitacion(inv);
}

// El hash entero no sale nunca a la web: alcanza con un pedazo para poder
// identificar cuál dar de baja.
const publicaInvitacion = (i) => ({
  id: i.hash.slice(0, 12),
  etiqueta: i.etiqueta, usos: i.usos, maxUsos: i.maxUsos,
  revocada: i.revocada, creada: i.creada, vence: i.vence,
  usadaPor: (i.usadaPor || []).map(u => u.email),
  activa: !i.revocada && i.usos < i.maxUsos && (!i.vence || Date.now() < Date.parse(i.vence)),
});

export function listarInvitaciones(cuenta) {
  if (!esAdmin(cuenta)) return [];
  return invitaciones().map(publicaInvitacion).reverse();
}

export const hashDeInvitacionCorta = (id) =>
  invitaciones().find(i => i.hash.startsWith(id))?.hash || null;

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
  const v = buscarCuenta(cuentaId)?.v || 1;
  const dato = Buffer.from(JSON.stringify({ c: cuentaId, v, exp: Date.now() + DURACION_MS }), "utf8").toString("base64url");
  return dato + "." + firmar(dato);
}

// "Cerrar sesión en todos lados". Sin tabla de sesiones no hay una lista que
// borrar, así que la cuenta lleva un número de versión: subirlo de uno deja
// vieja a toda cookie emitida hasta ahora, esté en el celular que esté.
export function cerrarTodasLasSesiones(cuentaId) {
  const l = cuentas();
  const c = l.find(x => x.id === cuentaId);
  if (!c) throw new ErrorAuth("No existe la cuenta.");
  c.v = (c.v || 1) + 1;
  guardarCuentas(l);
  return c;
}

export function leerSesion(cookieHeader) {
  const bruto = (cookieHeader || "").split(";").map(s => s.trim())
    .find(s => s.startsWith(COOKIE + "="));
  if (!bruto) return null;
  const [dato, firma] = decodeURIComponent(bruto.slice(COOKIE.length + 1)).split(".");
  if (!dato || !firma || !iguales(firma, firmar(dato))) return null;
  try {
    const { c, v, exp } = JSON.parse(Buffer.from(dato, "base64url").toString("utf8"));
    if (!c || Date.now() > exp) return null;
    const cuenta = buscarCuenta(c);    // borrada la cuenta, muerta la sesión
    if (!cuenta) return null;
    if ((v || 1) !== (cuenta.v || 1)) return null;   // deslogueada a distancia
    return cuenta;
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
export const publico = (c) => c && ({
  id: c.id, email: c.email, tieneKey: !!c.tmdbKey, admin: esAdmin(c),
});

export const cantidadDeCuentas = () => cuentas().length;
