# Krono — guía del repositorio

Krono es una aplicación personal, en español y optimizada para iPhone, para organizar turnos de trabajo. Sirve para registrar y editar turnos en un calendario mensual/semanal, calcular horas pagadas y estimar ingresos brutos y netos. El objetivo es que el calendario sea sencillo, rápido y visualmente limpio.

## Dónde trabajar

- La raíz de Git es esta carpeta.
- La aplicación está en `./Krono/`; ese es el directorio principal que normalmente hay que editar.
- Lee `./Krono/AGENTS.md` antes de cambiar la aplicación: contiene las reglas detalladas de producto, sincronización y privacidad.
- Lee `./Krono/README.md` para conocer configuración, despliegue y funciones disponibles.

## Reglas esenciales

- Mantén la interfaz oscura, clara y mobile-first, con controles cómodos para iPhone.
- Conserva los turnos, trabajos, reglas de pausa, salario estimado y la sincronización entre dispositivos.
- Los cambios de datos deben conservar la protección de concurrencia/ETag y no sobrescribir en silencio una versión más reciente.
- Nunca incluyas en el cliente ni en el repositorio contraseñas, secretos de sesión, tokens de Vercel o cifras personales de nómina. Las variables privadas se configuran en Vercel.
- No cambies el almacenamiento Blob privado a público.
- No añadas objetivos semanales ni pantallas ajenas a la gestión de turnos e ingresos.
- Conserva compatibilidad con los datos ya guardados y las migraciones descritas en `./Krono/AGENTS.md`.

## Alcance

Antes de hacer cambios, inspecciona la implementación y sigue sus patrones existentes. Mantén el trabajo centrado en Krono y evita refactorizaciones amplias que no sean necesarias para la petición concreta.
