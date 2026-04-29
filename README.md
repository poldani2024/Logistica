# Gestión de Transporte — Soka Gakkai Rosario / Gran Rosario

Sistema web para coordinar el transporte de miembros en eventos de la Soka Gakkai de la región Rosario / Gran Rosario.

## Descripción

Aplicación multi-página (MPA) construida con JavaScript vanilla y Firebase. Permite gestionar choferes, pasajeros, asignaciones por fase, tracking en tiempo real y solicitudes de transporte.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | HTML5 + JavaScript ES6 modules + CSS3 |
| Base de datos | Firebase Firestore (tiempo real) |
| Autenticación | Firebase Auth (Google OAuth) |
| Hosting | GitHub Pages (o cualquier hosting estático) |
| Notificaciones | Firebase Cloud Messaging (FCM) |
| Offline | Service Worker + Cache API |

---

## Módulos / Páginas

| Página | Archivo JS | Permiso requerido | Descripción |
|--------|-----------|-------------------|-------------|
| Inicio | `index.js` | — | Dashboard y menú principal |
| Mi Ruta | `mi-ruta.js` | — | Vista simplificada para choferes |
| Eventos | `events.js` | `Eventos` | CRUD de eventos y fases |
| Choferes | `drivers.js` | `Choferes` | Master data de choferes |
| Pasajeros | `passengers.js` | `Pasajeros` | Master data con geocoding |
| Asignaciones | `assignments.js` | `Asignaciones` | Asignar chofer ↔ pasajero por fase |
| Mapa | `map-assignments.js` | `Asignaciones` | Vista geográfica de asignaciones |
| Tracking | `tracking.js` | `Tracking` | Estado en tiempo real por fase |
| Solicitudes | `requests.js` | `Solicitudes` | Pedidos de traslado |
| Adm. Solicitudes | `requests_admin.js` | `Admin.Solicitudes` | Aprobar/rechazar pedidos |
| Choferes x Fase | `choferes-x-fase.js` | `ChoferesXFase` | Disponibilidad por fase |
| Guardia | `guardia-transporte.js` | `Asignaciones` | Guardias de turno |
| Calendario | `calendar.js` | `Asignaciones` | Vista de calendario |
| Permisos | `users_admin.js` | `Permisos` | Gestión de usuarios e invitaciones |
| Invitación | `accept_invite.js` | `AceptInv` | Aceptar invitación |

---

## Sistema de permisos

Los permisos se almacenan en `users/{uid}.perms` en Firestore:

| Flag | Descripción |
|------|-------------|
| `Admin` | Todos los permisos |
| `Eventos` | Crear/editar eventos |
| `Choferes` | Gestionar choferes |
| `Pasajeros` | Gestionar pasajeros |
| `ChoferesXFase` | Asignar choferes a fases |
| `Asignaciones` | Asignar pasajeros a choferes |
| `Tracking` | Ver/actualizar tracking |
| `Mapa` | Ver mapas |
| `Solicitudes` | Crear solicitudes |
| `Admin.Solicitudes` | Aprobar solicitudes |
| `Permisos` | Gestionar usuarios |
| `AceptInv` | Procesar invitaciones |

### Super-Administradores

Los super-admins se configuran en Firestore (`config/superAdmins`), **no** en el código fuente.

**Bootstrap inicial (una sola vez via Firebase Console):**

```
Colección: config
Documento: superAdmins
Campos:
  emails: ["tu-email@gmail.com"]
```

---

## Modelo de datos Firestore

```
/users/{uid}
  email, firstName, lastName, phone
  active (bool)
  perms (object)
  inviteAppliedAt, updatedAt

/config/superAdmins
  emails: string[]

/drivers/{driverId}
  firstName, lastName, email, phone
  address, localidad, zone
  capacity (number)
  lat, lng (opcional, geocodificado)

/passengers/{passengerId}
  firstName, lastName, phone
  address, localidad, zone
  lat, lng (geocodificado)

/events/{eventId}
  name, status, dateStart, dateEnd
  address, localidad
  phases: [{id, name, date, time, originAddress, destinationAddress}]

  /eventDrivers/{driverId}
    phases: {phaseId: bool}
    linkedAt

  /eventPassengers/{passengerId}
    status, trackingStatus
    assignedDriverId
    trackingByPhase: {phaseId: {status, note, updatedAt, updatedBy}}

  /assignments/{driverId}
    phases: {phaseId: passengerId[]}
    passengerIds: [] (legacy compat)

  /history/{entryId}
    action, at, by, byUid
    (detalles de la acción)

/requests/{requestId}
  creator, creatorUid, title
  date, destination, status

/invites/{email}
  email, firstName, lastName, phone, perms, active
  usedAt, usedByUid

/fcmTokens/{uid}
  token, updatedAt, userAgent
```

---

## Configuración inicial

### 1. Crear proyecto Firebase

1. [Firebase Console](https://console.firebase.google.com/) → Nuevo proyecto
2. Habilitar **Authentication** → Google
3. Habilitar **Firestore** (modo producción)
4. Habilitar **Cloud Messaging** (para notificaciones push)

### 2. Configurar `firebase-init.js`

```js
export const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto",
  storageBucket: "tu-proyecto.firebasestorage.app",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};
```

### 3. Desplegar reglas de seguridad

```bash
firebase deploy --only firestore:rules
```

O copiar el contenido de `firestore.rules` en Firebase Console → Firestore → Reglas.

### 4. Crear super-admin inicial

En Firebase Console → Firestore → Crear documento:
- Colección: `config`
- ID: `superAdmins`
- Campo: `emails` (tipo array) → `["tu-email@gmail.com"]`

### 5. Configurar notificaciones push (FCM)

1. Firebase Console → Project Settings → Cloud Messaging
2. Copiar la **clave pública VAPID**
3. Pegar en `fcm.js` → constante `VAPID_KEY`

---

## PWA (Progressive Web App)

La app puede instalarse en el dispositivo del usuario.

- **Service Worker** (`sw.js`): cachea assets estáticos, soporta modo offline básico
- **Manifest** (`manifest.json`): define nombre, íconos, colores y shortcuts
- **Iconos**: crear carpeta `icons/` con `icon-192.png` e `icon-512.png`

---

## Desarrollo local

Como es una app de módulos ES6 cargados por CDN, necesitás un servidor HTTP local:

```bash
# Python
python3 -m http.server 8080

# Node.js
npx serve .

# VS Code
Instalar extensión "Live Server"
```

Luego abrir `http://localhost:8080`.

---

## Estructura de archivos

```
/
├── index.html              # Dashboard principal
├── mi-ruta.html            # Vista de chofer simplificada
├── assignments.html        # Asignaciones
├── tracking.html           # Tracking en tiempo real
├── events.html             # Gestión de eventos
├── drivers.html            # Master choferes
├── passengers.html         # Master pasajeros
├── ...                     # Demás páginas
│
├── core.js                 # Módulo central: auth, estado global, loaders
├── firebase-init.js        # Configuración Firebase
├── fcm.js                  # Notificaciones push
├── validation.js           # Validación de formularios
├── sw.js                   # Service Worker
├── manifest.json           # PWA manifest
├── styles.css              # Estilos globales
├── firestore.rules         # Reglas de seguridad Firestore
└── README.md               # Este archivo
```
