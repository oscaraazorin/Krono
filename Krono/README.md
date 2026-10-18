# Krono

Calendario personal de turnos con estimación de horas pagadas y salario neto aproximado. Interfaz oscura, instalable y ajustada a iPhone.

## Tu perfil de nómina

La nómina de referencia se inicializa desde variables privadas de Vercel tras iniciar sesión. Así no se publican cifras personales en el HTML ni en el código del repositorio. El neto futuro se aproxima usando las deducciones medias del recibo y no sustituye el recibo de sueldo.

## Pausas

Cada turno nuevo empieza con una pausa predeterminada de 60 minutos. Puedes cambiar los minutos directamente en el formulario del turno, incluso poner 0. En Ajustes puedes modificar la duración predeterminada y elegir si la pausa cuenta como tiempo pagado. Los turnos ya guardados conservan su pausa; los turnos antiguos sin una pausa guardada mantienen el cálculo anterior según sus reglas.

Para referencia, el SECO indica mínimos distintos en la normativa laboral suiza: 15 min para una jornada de más de 5,5 h, 30 min para más de 7 h y 60 min para más de 9 h. También cuenta como tiempo de trabajo una pausa durante la que no puedas dejar tu puesto. Los valores iniciales de Krono siguen tus ejemplos; ajusta los campos a tu convenio y situación. Consulta la [guía oficial del SECO sobre pausas](https://www.seco.admin.ch/dam/seco/de/dokumente/Publikationen_Dienstleistungen/Publikationen_Formulare/Arbeit/Arbeitsbedingungen/wegleitungen_arbeitsgesetzt/wegleitung_argv_1_2.pdf.download.pdf/arbeitsgesetz_wegleitung_1_2_de.pdf).

## Sincronización privada en Vercel

El proyecto usa Vercel Blob **privado** y funciones API propias. El contenido de la nómina, turnos y trabajos no va a una URL pública. La copia local se guarda además en el navegador para conservar acceso sin conexión. Cada dispositivo sincroniza al guardar y comprueba si hay cambios en otro dispositivo. Si coinciden varios cambios, Krono reintenta automáticamente y prioriza la última copia que se sube; antes conserva un respaldo de la copia remota anterior en el almacenamiento local del navegador (`krono_auto_sync_backup`).

### Preparar el proyecto

1. Importa esta carpeta/repo en Vercel y despliega el proyecto.
2. En el proyecto, crea un Blob store con acceso **Private** y conéctalo al proyecto. Vercel proporciona la autenticación OIDC del Blob a las funciones.
3. En **Settings → Environment Variables**, añade `KRONO_PASSWORD` (contraseña larga y única), `KRONO_SESSION_SECRET` (secreto aleatorio de al menos 32 caracteres), `KRONO_HOURLY_RATE`, `KRONO_MONTHLY_GROSS` y `KRONO_MONTHLY_NET` con los valores de tu nómina. Una forma de generar el secreto localmente es `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. No pongas estas cifras o secretos en el código ni en el navegador.
4. Vuelve a desplegar y abre la web. En **Ajustes → Sincronización privada**, conecta con `KRONO_PASSWORD` desde cada dispositivo.

## Conectar asistentes (MCP)

Krono también ofrece una conexión MCP en `https://kronotime.vercel.app/mcp` para clientes compatibles, como Codex, ChatGPT y Claude. El acceso utiliza OAuth y la contraseña de Krono; no requiere copiar `BLOB_READ_WRITE_TOKEN`, `KRONO_SESSION_SECRET` ni otras claves de Vercel al asistente. Cada asistente pide autorización en una página de Krono. Puedes conceder solo lectura o habilitar también la escritura de turnos.

Herramientas disponibles: consultar resumen semanal/mensual, consultar turnos y trabajos, y añadir o modificar turnos. Los cálculos respetan tarifas, reglas de pausa y pausas personalizadas guardadas. Las escrituras comprueban el ETag de Vercel Blob; si otro dispositivo cambia los datos a la vez, el asistente debe consultar la versión actual antes de reintentar.

Para conectar, añade la URL `https://kronotime.vercel.app/mcp` como servidor MCP remoto en el asistente. Si el asistente permite configurar OAuth, usa el descubrimiento estándar de Krono; inicia sesión en la página de autorización y elige los permisos que quieres conceder. Los tokens duran 14 días; cuando caduquen, el cliente solicitará autorización de nuevo. No se guardan contraseñas ni secretos en el cliente MCP.

El acceso se puede revocar para todos los asistentes rotando `KRONO_SESSION_SECRET` en las variables privadas de Vercel y redeplegando. Para cerrar sesiones de Krono existentes, cambia también `KRONO_PASSWORD`.

Si se despliega sin el Blob privado y estas variables, la app sigue funcionando en local, pero aún no activa la sincronización ni precarga la nómina. Vercel no crea el almacén ni las credenciales por el mero hecho de alojar la web.

## Uso y datos

- `index.html` contiene la aplicación y `/api/auth` y `/api/data` son las funciones de autenticación y almacenamiento.
- `@vercel/blob` debe permanecer como dependencia del proyecto; Vercel instala la función desde `package.json`.
- Los datos locales siguen usando `krono_data_v1`; la app migra `krono_shifts` y `krono_jobs` de la versión anterior.
- Usa **Ajustes → Exportar copia JSON** como respaldo independiente. Puedes importar una copia en otro navegador o compartirla con Codex.
- La copia JSON contiene información personal de horarios y salarios: consérvala en privado.

## Privacidad

El Blob debe crearse como privado. No conviertas este almacén en público ni copies `BLOB_STORE_ID`, tokens, la contraseña de Krono o el secreto de sesión en el frontend. Cambiar `KRONO_PASSWORD` protege los próximos inicios de sesión; las sesiones ya abiertas duran hasta 14 días. Para invalidarlas de inmediato, cambia también `KRONO_SESSION_SECRET`.
