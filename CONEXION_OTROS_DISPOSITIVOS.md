# Usar el ERP desde otros dispositivos y otras redes (opción recomendada: Tailscale)

Tailscale crea una red privada entre TUS dispositivos (PC servidor, celulares, tablets).
Nada del ERP queda expuesto a internet: solo entran los dispositivos que tú autorices.
Funciona igual con datos móviles o con cualquier Wi-Fi.

## Una sola vez
1. Crea una cuenta en tailscale.com (el plan gratuito sirve para uso pequeño; revisa
   los límites vigentes en su sitio).
2. Instala Tailscale en la PC donde corre el ERP e inicia sesión.
3. En el panel de administración de Tailscale activa **MagicDNS** y **HTTPS Certificates**.
4. En esa PC, abre una terminal y ejecuta (la sintaxis puede variar según la versión;
   consulta `tailscale serve --help`):

       tailscale serve --bg 5173

   Con `tailscale serve status` ves la dirección, algo como
   `https://nombre-pc.tu-red.ts.net`.

## Cada dispositivo (celular, tablet, otra PC)
1. Instala Tailscale e inicia sesión con la misma cuenta (o invita al usuario desde el panel).
2. Abre en el navegador la dirección `https://nombre-pc.tu-red.ts.net`.
3. Inicia sesión en el ERP. Con HTTPS el navegador ofrece "Instalar app" (PWA).

## Cada día
- La PC servidor debe estar encendida, con internet y con el ERP corriendo
  (`INICIAR_ERP_GPT.bat`, como siempre). Si se apaga, nadie puede usar el sistema.
- En la PC servidor sigues usando http://localhost:5173 como hasta ahora.

## Limitaciones a tener en cuenta
- Sin conexión a la PC servidor no se puede vender: la PWA solo guarda la pantalla, no los datos.
- Todo depende de una sola PC. Haz copias de seguridad de la base de datos con frecuencia.
- Cuando el negocio lo necesite, el siguiente paso es mover backend y base de datos a un
  hosting en la nube (no requiere reescribir el sistema).
