# Krono

Calendario personal de turnos con estimación de horas pagadas y salario neto aproximado. Interfaz oscura, instalable y ajustada a iPhone.

## Tu perfil de nómina

La nómina de referencia se inicializa desde variables privadas de Vercel tras iniciar sesión. Así no se publican cifras personales en el HTML ni en el código del repositorio. El neto futuro se aproxima usando las deducciones medias del recibo y no sustituye el recibo de sueldo.

## Pausas

Los valores iniciales reflejan los ejemplos que has dado: no hay pausa hasta 5,5 h, se descuenta 30 min a partir de 5,5 h y 60 min a partir de 8 h. En Ajustes puedes cambiar los umbrales, la duración y si la pausa cuenta como tiempo pagado. La hora concreta de la pausa no hace falta introducirla.

Para referencia, el SECO indica mínimos distintos en la normativa laboral suiza: 15 min para una jornada de más de 5,5 h, 30 min para más de 7 h y 60 min para más de 9 h. También cuenta como tiempo de trabajo una pausa durante la que no puedas dejar tu puesto. Los valores iniciales de Krono siguen tus ejemplos; ajusta los campos a tu convenio y situación. Consulta la [guía oficial del SECO sobre pausas](https://www.seco.admin.ch/dam/seco/de/dokumente/Publikationen_Dienstleistungen/Publikationen_Formulare/Arbeit/Arbeitsbedingungen/wegleitungen_arbeitsgesetzt/wegleitung_argv_1_2.pdf.download.pdf/arbeitsgesetz_wegleitung_1_2_de.pdf).

## Sincronización privada en Vercel

El proyecto usa Vercel Blob **privado** y funciones API propias. El contenido de la nómina, turnos y trabajos no va a una URL pública. La copia local se guarda además en el navegador para conservar acceso sin conexión. Cada dispositivo sincroniza al guardar y comprueba si hay cambios en otro dispositivo; si detecta ediciones simultáneas, ofrece elegir la versión y conserva una copia local previa.

### Preparar el proyecto

1. Importa esta carpeta/repo en Vercel y despliega el proyecto.
2. En el proyecto, crea un Blob store con acceso **Private** y conéctalo al proyecto. Vercel proporciona la autenticación OIDC del Blob a las funciones.
3. En **Settings → Environment Variables**, añade `KRONO_PASSWORD` (contraseña larga y única), `KRONO_SESSION_SECRET` (secreto aleatorio de al menos 32 caracteres), `KRONO_HOURLY_RATE`, `KRONO_MONTHLY_GROSS` y `KRONO_MONTHLY_NET` con los valores de tu nómina. Una forma de generar el secreto localmente es `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. No pongas estas cifras o secretos en el código ni en el navegador.
4. Vuelve a desplegar y abre la web. En **Ajustes → Sincronización privada**, conecta con `KRONO_PASSWORD` desde cada dispositivo.

Si se despliega sin el Blob privado y estas variables, la app sigue funcionando en local, pero aún no activa la sincronización ni precarga la nómina. Vercel no crea el almacén ni las credenciales por el mero hecho de alojar la web.

## Uso y datos

- `index.html` contiene la aplicación y `/api/auth` y `/api/data` son las funciones de autenticación y almacenamiento.
- `@vercel/blob` debe permanecer como dependencia del proyecto; Vercel instala la función desde `package.json`.
- Los datos locales siguen usando `krono_data_v1`; la app migra `krono_shifts` y `krono_jobs` de la versión anterior.
- Usa **Ajustes → Exportar copia JSON** como respaldo independiente. Puedes importar una copia en otro navegador o compartirla con Codex.
- La copia JSON contiene información personal de horarios y salarios: consérvala en privado.

## Privacidad

El Blob debe crearse como privado. No conviertas este almacén en público ni copies `BLOB_STORE_ID`, tokens, la contraseña de Krono o el secreto de sesión en el frontend. Cambiar `KRONO_PASSWORD` protege los próximos inicios de sesión; las sesiones ya abiertas duran hasta 14 días. Para invalidarlas de inmediato, cambia también `KRONO_SESSION_SECRET`.
