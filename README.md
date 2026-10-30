# Local Gaming

Aplicación para un local gaming con páginas públicas independientes, reservas, cuentas y puntos, torneos, sugerencias de comunidad y panel privado.

## Requisitos

- Node.js 20 o superior y npm.
- En Windows, `better-sqlite3` puede necesitar herramientas de compilación de C++ si no hay un binario precompilado compatible.

## Instalación y desarrollo

```powershell
Copy-Item .env.example .env
npm install
npm run db:setup
npm run dev
```

La web estará en `http://127.0.0.1:5173` y la API en `http://127.0.0.1:3000`.

<<<<<<< HEAD
Rutas públicas: `/`, `/servicios/`, `/tarifas/`, `/torneos/`, `/ranking/`, `/noticias/`, `/comunidad/`, `/cuenta/entrar/`, `/cuenta/crear/`, `/local/` y `/reservar/`. Cada sección principal tiene una página propia; los navegadores compatibles muestran una transición breve entre páginas. El panel del personal está en `/admin/`.
=======
Rutas públicas: `/`, `/servicios/`, `/tarifas/`, `/torneos/`, `/noticias/`, `/comunidad/`, `/cuenta/entrar/`, `/cuenta/crear/`, `/local/` y `/reservar/`. El panel del personal está en `/admin/`.
>>>>>>> 5af4803bddf206bce0207b8407ed54ec08bf7358

## Scripts

- `npm run dev`: inicia API y Vite.
- `npm run build`: genera el frontend de producción en `client/dist`.
- `npm start`: inicia la API y sirve el build si `NODE_ENV=production`.
- `npm test`: ejecuta las pruebas con Vitest.
- `npm run seed`: aplica migraciones y carga datos de demostración.
- `npm run admin:create`: crea una cuenta administradora con credenciales aleatorias; se muestran una sola vez.
- `npm run db:migrate`: aplica migraciones pendientes.
- `npm run db:setup`: aplica migraciones y carga datos de demostración.
- `npm run lint`, `npm run format:check`: revisiones de ESLint y Prettier.

## Variables de entorno

`.env.example` documenta las variables disponibles. `DATABASE_PATH` admite una ruta relativa a la raíz del proyecto; los ficheros SQLite se guardan en `data/`, que no se versiona. La zona horaria inicial es `Europe/Madrid`.

Las cuentas de miembros usan cookies técnicas `HttpOnly`, `SameSite=Strict` y `Secure` en producción. Sin marcar «Recordarme», la cookie dura hasta cerrar el navegador y la sesión caduca como máximo a las 8 horas; al marcarlo, la cookie mantiene el acceso durante `MEMBER_REMEMBER_DAYS` (30 días por defecto, configurable entre 1 y 365). La cookie CSRF asociada mantiene el mismo plazo. Cerrar sesión elimina ambas cookies. No se utilizan cookies publicitarias ni de seguimiento.

Para habilitar el restablecimiento de contraseñas de miembros, configura `PUBLIC_BASE_URL` y las variables SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM`). En producción, `PUBLIC_BASE_URL` debe usar HTTPS. El enlace enviado caduca en una hora y solo se puede utilizar una vez; al cambiar la contraseña se cierran las sesiones existentes.

Las cuentas acumulan 10 puntos por cada euro de reservas completadas. En Comunidad pueden canjearlos al instante por recompensas del catálogo; cada canje descuenta puntos, reduce el stock y genera un código personal para presentar en el local. El catálogo inicial incluye ejemplos editables desde la pestaña «Recompensas» del panel de administración. Los puntos disponibles nunca bajan de cero.

Para crear un administrador aleatorio en un entorno con acceso a consola, ejecuta `npm run admin:create` y guarda las credenciales que imprime. En producción sin consola (por ejemplo, Render gratuito), configura `ADMIN_USERNAME` y `ADMIN_PASSWORD` en las variables de entorno del servicio y vuelve a desplegar: al arrancar, el servidor crea esa cuenta solo si el nombre aún no existe. Usa una contraseña de al menos 12 caracteres. Después puedes cambiarla desde el panel; el arranque no la sobrescribe. No configures estas variables con credenciales débiles ni las publiques. En desarrollo se permite `admin/admin` solo como clave bootstrap, con cambio obligatorio en el primer acceso; no se permite en producción. El hash se genera con bcrypt y la sesión utiliza cookies `httpOnly` más token CSRF. En producción, sirve el sitio exclusivamente por HTTPS.

Render gratuito no ofrece disco persistente para el servicio web: la base de datos SQLite local puede perderse al desplegar de nuevo o reiniciar. Si ocurre, mientras las variables `ADMIN_USERNAME` y `ADMIN_PASSWORD` sigan configuradas, el servidor volverá a crear el administrador al arrancar; el resto de datos SQLite también puede perderse.

## Datos de demostración

El seed es idempotente e incluye cuatro tipos de puesto, tarifas y un bono de ejemplo, horarios, una reserva, tres torneos y jugadores con resultados. Los valores del local se leen desde `.env`. Precios, capacidades, juegos, premios, horarios y datos de contacto son ficticios y deben sustituirse antes de publicar. Los correos usan el dominio reservado `example.test`.

## API

### `GET /api/health`

Respuesta correcta: `200 application/json` con `{"status":"ok"}`.

### `GET /api/public`

Devuelve el negocio, puestos activos, tarifas, horario, torneos abiertos, ranking competitivo, Top 10 de puntos por gasto, ideas aprobadas y noticias publicadas.

### `GET /api/availability?seatType=pc-gaming&date=AAAA-MM-DD&durationHours=2`

Devuelve franjas de inicio, plazas restantes y precio total. Solo incluye horas dentro del horario configurado y excluye festivos/cierres.

### `POST /api/reservations`

Recibe `seatType`, `date`, `startTime`, `durationHours` (1–6), `customerName`, `customerEmail`, `customerPhone`, `consent: true` y `website: ""` (honeypot). La respuesta `201` contiene código, token de cancelación, resumen, total y estado `pending`. La escritura y comprobación de capacidad usan transacción SQLite inmediata.

### `POST /api/reservations/cancel`

Recibe `code` y `token`. Solo cancela reservas activas con al menos 24 horas de antelación.

### `POST /api/members/register`, `POST /api/members/login`, `GET /api/members/session`, `POST /api/members/logout`

Registro público con nombre, email único, contraseña de al menos 12 caracteres y consentimiento. Los usuarios nuevos tienen rol `user`; el servidor almacena bcrypt y usa sesión `httpOnly` con CSRF. Una sesión enlaza la reserva al email de la cuenta.

`POST /api/members/password-reset` solicita un enlace por email y `POST /api/members/password-reset/confirm` lo canjea por una contraseña nueva. La respuesta de solicitud no revela si el email está registrado; el token se almacena como hash, caduca en una hora y solo se puede utilizar una vez.

`GET /api/members/rewards` devuelve el saldo, las recompensas disponibles y los últimos canjes. `POST /api/members/rewards/:id/redeem` canjea una recompensa de forma inmediata y requiere sesión y CSRF.

### `POST /api/members/ideas`, `GET /api/members/ideas`, `PATCH /api/members/ideas/:id`

Los miembros autenticados pueden proponer ideas; solo se publican tras aprobación. `moderator` y `administrator` pueden revisar la cola. El rol `administrator` se asigna desde el panel staff.

### `POST /api/tournaments/:slug/register`

Inscripción pública con nombre, gamertag, email, teléfono y aceptación de normas. Los duplicados por torneo se rechazan y el aforo excedido pasa a lista de espera.

### `POST /api/admin/login`, `GET /api/admin/session`, `POST /api/admin/logout`

Login de personal, consulta de sesión y cierre. Las mutaciones del panel requieren sesión y cabecera `X-CSRF-Token`.

### `GET|POST /api/admin/news`, `PUT|DELETE /api/admin/news/:id`

Listado para personal y gestión de noticias. Crear, editar y eliminar requiere rol `administrator`; el contenido puede mantenerse en borrador o publicarse. Las imágenes deben usar HTTPS.

`GET|POST /api/admin/rewards`, `PUT /api/admin/rewards/:id` permite a administradores gestionar el catálogo, los costes en puntos, el stock y su disponibilidad.

### `GET|POST /api/admin/tournaments`, `PUT|DELETE /api/admin/tournaments/:id`, `GET /api/admin/tournaments/:id/entries`, `POST /api/admin/tournaments/:id/results`

Desde el panel se crean/editan torneos, se abren o cierran inscripciones, se consultan participantes/lista de espera y se registran posiciones/puntos. Guardar resultados finaliza el torneo y recalcula la clasificación competitiva.

### `GET /api/admin/reservations`, `PATCH /api/admin/reservations/:id/status`, `GET /api/admin/members`, `PUT /api/admin/members/:id/role`

El personal actualiza reservas; marcarlas `completed` suma puntos a la cuenta vinculada. El administrador puede asignar `user`, `moderator` o `administrator`.

Los puntos de fidelidad son 10 por euro en reservas completadas, calculados de forma proporcional a los céntimos. El Top público solo muestra puntos y sesiones; el gasto exacto queda en el perfil propio.

## Pendiente antes de producción

- Confirmar datos reales, capacidades, horarios, tarifas, dirección y textos legales/RGPD.
- Configurar proveedor de correo; en desarrollo la confirmación se simula en el log.
- Completar calendario, gestión avanzada de horarios/cierres, métricas y exportación CSV.
- Integrar cobro real de inscripciones, proveedor de email y automatización de cuadros/liguillas.
- Completar la gestión de solicitudes de acceso/borrado de datos y la política legal con el responsable del negocio.
- Configurar HTTPS, copias de seguridad de SQLite y límites de rate-limit compartidos si se ejecutan varias instancias.