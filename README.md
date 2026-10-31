# WiFi Finder Pro — Instalación en iPhone (sin computadora)

App web progresiva (PWA). Se instala gratis en GitHub Pages, que da una dirección HTTPS (necesaria para la ubicación, el cifrado y el modo sin conexión).

## 1. Prepara los archivos
1. Guarda `wifi-finder-pro.zip` en la app **Archivos**.
2. Tócalo: iOS crea la carpeta `wifi-finder-pro` con 12 archivos.

## 2. Súbelos a GitHub Pages (desde Safari)
1. Entra a **github.com** y crea una cuenta gratis (o inicia sesión).
2. Toca **+** → **New repository**. Nombre: `wifi-finder-pro`. Elige **Public**. Toca **Create repository**.
3. En el repositorio vacío, toca **uploading an existing file**.
   - Si no lo ves: toca **aA** en la barra de Safari → **Solicitar sitio web de escritorio**.
4. Toca **choose your files** → **Examinar** → abre la carpeta `wifi-finder-pro` → **Seleccionar** → marca **todos** los archivos → **Abrir**.
5. Baja y toca **Commit changes**.
6. Ve a **Settings** → **Pages** → en *Build and deployment* elige **Deploy from a branch**, rama **main**, carpeta **/(root)** → **Save**.
7. Espera 1–2 minutos y recarga: aparecerá tu dirección, del tipo
   `https://TU-USUARIO.github.io/wifi-finder-pro/`

## 3. Instálala en la pantalla de inicio
1. Abre esa dirección en **Safari**.
2. Toca **Compartir** (cuadro con flecha) → **Agregar a pantalla de inicio**.
3. Si aparece **Abrir como app web**, déjalo activado → **Agregar**.
4. Abre **WiFi Finder** desde el ícono nuevo.

## 4. Permisos
- **Ubicación**: al tocar “Buscar cerca de mí”, elige **Permitir**. Si la negaste: Safari → **aA** → *Configuración del sitio web* → *Ubicación* → **Permitir**; y en *Ajustes → Privacidad y seguridad → Localización*, activa la localización y pon *Sitios web de Safari* en **Al usar la app**.
- **Cámara/Fotos**: solo al leer un QR; iOS te deja tomar la foto o elegirla en ese momento.

## 5. Importante
- Crea tu bóveda **dentro de la app instalada**: Safari y la app instalada no comparten datos.
- Exporta una copia cifrada de la bóveda de vez en cuando (Bóveda → Copia de seguridad) y guárdala en iCloud Drive.
- La contraseña maestra no se puede recuperar.

## Actualizar la app
Sube de nuevo los archivos modificados al repositorio (Add file → Upload files). Cambia `VERSION` en `sw.js` para que el iPhone descargue la versión nueva.

## Qué hace y qué no
| Función | Cómo funciona |
|---|---|
| Wi-Fi públicas cercanas | Lugares con Wi-Fi registrados en OpenStreetMap, alrededor de tu ubicación o de una dirección; mapa e indicaciones en Apple Maps |
| Gratis / clientes / de pago | Según las etiquetas de OpenStreetMap (`internet_access:fee`); bibliotecas, parques y edificios públicos aparecen como “probablemente gratis” |
| Contraseñas de tus redes | Bóveda cifrada (AES-GCM 256, PBKDF2-SHA256 de 310 000 iteraciones), solo en el dispositivo; se bloquea sola |
| Recuperar contraseñas | Guía: Ajustes de iOS, app Contraseñas, etiqueta/QR del router, panel del router, proveedor |
| Análisis de seguridad | Cifrado, fortaleza de la clave, nombre de fábrica, WPS, firmware, etc.; y una lista de comprobación para Wi-Fi pública |
| QR para compartir | Generador propio (sin conexión), pantalla completa, compartir/guardar imagen, imprimir; lector de QR desde foto |

**Ninguna app web de iOS puede** escanear redes Wi-Fi, leer las contraseñas guardadas en el sistema, conectarse sola a una red ni descubrir contraseñas ajenas. Esta app no lo intenta.
