# DaFont Fonts (SillyTavern)

Usa fuentes de [DaFont](https://www.dafont.com) en SillyTavern: una para los mensajes del personaje y otra (opcional) para los tuyos.

## Instalación
- Desde GitHub: pega la URL del repo en el instalador de extensiones de ST.
- A mano: copia la carpeta `dafont-fonts-st` a `data/<tu-usuario>/extensions/` (o `public/scripts/extensions/third-party/`) y reinicia ST.

## Uso
1. En DaFont descarga la fuente (te da un `.zip`).
2. Extensions → **DaFont Fonts** → **Subir archivo** y elige el `.zip` (o un `.ttf`/`.otf`/`.woff`).
3. Elige la fuente del personaje y/o la tuya en los selectores.

Otras formas de agregar: pegar un enlace directo a un archivo de fuente (por ejemplo de catbox) o el enlace de la página de DaFont (solo funciona si tu ST tiene `enableCorsProxy: true` en `config.yaml`).

## Detalles
- Las fuentes se guardan en el navegador (IndexedDB); no hay que reconfigurar al reabrir ST.
- Solo cambia el CSS de los mensajes; tus chats no se modifican.
- Eliminar una fuente la quita de las listas y restablece los selectores que la usaban.
- Revisa la licencia de cada fuente en DaFont si la vas a usar para algo más que uso personal.
