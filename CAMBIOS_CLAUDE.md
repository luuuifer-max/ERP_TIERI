# Cambios realizados (revisión Claude)

No se tocó tu base de datos manualmente. Al iniciar el backend (`node server.js`),
la función `inicializarTablasCaja()` ya existente corre automáticamente los `ALTER TABLE`
necesarios (usa `IF NOT EXISTS`, así que no rompe nada de lo que ya tienes).

## 🐛 Bug corregido
- **Login no traía los permisos del usuario.** La consulta de `/api/login` no incluía
  la columna `usuarios.permisos`, así que por más permisos que le marcaras a un usuario,
  siempre entraba con la lista vacía. Ya se corrigió.

## ✅ Roles editables (nuevo)
- `GET /api/roles` ahora también devuelve los permisos por defecto de cada rol.
- `POST /api/roles`, `PUT /api/roles/:id`, `DELETE /api/roles/:id` (el dueño puede
  crear, renombrar/reconfigurar y eliminar roles). No se puede eliminar el rol con id 1
  (administrador) ni un rol que todavía tenga usuarios asignados.
- Nueva pestaña **"Roles"** en Administración con checklist de permisos.
- Al crear un usuario y elegir su rol, sus permisos se auto-rellenan desde la
  plantilla del rol (y se pueden ajustar antes de guardar).

## ✅ Usuarios editables (nuevo)
- `PUT /api/usuarios/:id`: editar nombre, rol, sucursal, permisos y (opcional)
  restablecer contraseña.
- "Eliminar" sigue siendo desactivar (`PATCH /api/usuarios/:id/estado`), para no
  perder el historial de ventas/caja de ese usuario. Ya existía, no se tocó.
- Formulario de edición agregado en el frontend.

## ✅ Sucursales editables (nuevo)
- `PUT /api/sucursales/:id`: editar nombre, dirección, teléfono.
- "Eliminar" sigue siendo desactivar, mismo motivo que arriba.
- Formulario de edición agregado en el frontend.

## ✅ "Caja" solo edita lo que creó (nuevo)
- Se agregó la columna `productos.creado_por`.
- Al crear un producto, se guarda automáticamente quién lo creó.
- Nuevo permiso `inventario.solo_propios`: si un usuario lo tiene marcado, solo puede
  editar/deshabilitar los productos que él mismo creó (los demás le devuelven 403).
  Si NO lo tiene marcado pero sí tiene `inventario.editar`, puede editar cualquiera
  (comportamiento de antes, para admins/supervisores).
- El frontend ya oculta los botones de editar/deshabilitar en los productos que el
  usuario no puede tocar, en vez de mostrar el botón y fallar después.

## ✅ Ocultar precio de compra (nuevo)
- Nuevo permiso `precios.compra.ver`. Si el usuario no lo tiene (y no es dueño), el
  backend ni siquiera envía `precio_compra_actual` en la respuesta — no es solo un
  tema visual, el dato no viaja.
- El frontend muestra "—" en la columna de precio de compra cuando no llega el dato.

## ✅ Vendedor de calle: sin código nuevo, ya se puede armar con roles
El menú (`App.jsx`) ya filtra cada módulo por permiso (`cotizaciones.ver`,
`inventario.ver`, `ventas.ver`, `caja.ver`, etc.), y el módulo de **Cotizaciones**
que ya tenías es exactamente una "nota de venta" (no descuenta stock ni cierra caja
hasta convertirse en venta). Para armar el rol "Vendedor de calle" desde la pestaña
Roles, márcale: `inventario.ver`, `cotizaciones.ver`, `cotizaciones.crear` — y
deliberadamente NO `precios.compra.ver`, ni `ventas.ver`, ni `caja.ver`.

## Ronda 2 (tras tu prueba en localhost)

### ✅ Ya existían, solo había que usarlos (no se tocó código)
- **Cambiar de sucursal siendo dueño**: ya está arriba en el encabezado, un `<select>`
  que solo ve el dueño. Si no lo notaste, mira junto a tu nombre de usuario.
- **Elegir presentación al vender**: en Ventas, si un producto tiene más de una
  presentación, aparece un desplegable "Otra presentación…" bajo el botón del producto.

### ✅ Presentaciones: cantidad y costo 100% manuales
- El campo "Equivalencia" (decimal raro tipo 0.0833) se cambió por "Cantidad" en
  números enteros (ej. una caja de 15 unidades = escribes 15, no una fracción).
- Se agregó un campo de **Costo** editable por presentación. Si lo dejas vacío, se
  sugiere automáticamente (precio de compra × cantidad), pero lo puedes sobreescribir
  si compraste esa presentación a otro precio. La ganancia en Bs y % ahora se calcula
  sobre ese costo real, no sobre una multiplicación ciega.
- Se agregó la columna `costo` en la tabla `producto_presentaciones` (migración
  automática, no rompe lo que ya tenías).

### ✅ Presentaciones visibles en la lista de inventario
Antes solo se veía el precio base. Ahora, si un producto tiene varias presentaciones,
se listan debajo del precio (ej. "Media caja: Bs 158.00").

### ✅ Bug de scroll con decimales
El scroll del mouse sobre un input numérico enfocado (cualquiera: stock, precios,
descuento, impuesto, efectivo recibido) lo hacía cambiar de valor solo, generando
decimales raros. Se desactivó ese comportamiento en toda la app de una sola vez.

## Ronda 3: Transferencia de stock entre sucursales (nuevo)

- Tabla nueva `transferencias_stock` (migración automática): guarda producto, sucursal
  origen, sucursal destino, cantidad, quién la hizo y cuándo. Queda historial completo.
- Nuevo permiso `inventario.transferir`: el dueño siempre puede transferir desde
  cualquier sucursal; un usuario normal con este permiso **solo puede transferir stock
  que esté en su propia sucursal** hacia otra (no puede mover stock ajeno).
- `POST /api/transferencias`: descuenta de la sucursal origen y suma en la destino
  dentro de una sola transacción (si algo falla, no queda a medias), valida que haya
  suficiente stock disponible antes de mover nada.
- `GET /api/transferencias`: historial. El dueño ve todo; un usuario normal solo ve
  las transferencias donde su sucursal fue origen o destino.
- En Inventario: botón **"Transferir"** en cada producto (solo visible si tienes el
  permiso) y botón **"Historial de transferencias"** arriba para ver el registro
  completo con fecha, producto, de dónde a dónde, cantidad y quién la hizo.

## Ronda 4: bugs reales que reportaste al probar

### 🐛 Transferencias fallaban ("no hay restricción única...")
Tu tabla `inventario` no tiene una restricción única en (producto, sucursal), así que
el `ON CONFLICT` que usé no aplicaba. Corregido: ahora verifica si ya existe el
registro y decide entre `INSERT` o `UPDATE`, en vez de depender de esa restricción.

### 🐛 No se podía guardar al editar un producto (¡bug que ya existía antes, no era mío!)
Encontré que la ruta de editar producto tenía el **mismo problema exacto** en la parte
que actualiza el stock (otro `ON CONFLICT` sin restricción real detrás). Por eso
fallaba, tanto en productos viejos como nuevos. Corregido igual que arriba.

### 🐛 Botones +/- de cantidad en Ventas no hacían nada
Bug real (tampoco era mío, ya estaba antes): el botón usaba el ID del producto para
buscarlo en el carrito, pero el carrito identifica cada línea con una clave distinta
(producto + presentación). Nunca coincidían, así que el clic no encontraba qué
actualizar. Ya corregido, y de paso el límite de "hasta cuánto puedes sumar" ahora
respeta la presentación elegida (si vendes por caja, el tope es en cajas, no en
unidades sueltas).

### 🐛 Cambiar de sucursal no se reflejaba sin cerrar sesión
Inventario, Ventas y Caja cargaban sus datos solo una vez al abrir la pantalla y no se
enteraban si cambiabas de sucursal desde el selector de arriba. Ahora se recargan
automáticamente en cuanto cambia la sucursal activa. También agregué un aviso visible
si el cambio de sucursal falla (antes fallaba en silencio).

### ✅ Usuarios visibles por sucursal
En la pestaña Sucursales, cada tienda ahora muestra la lista de usuarios asignados
(nombre y rol), no solo un número.

### ✅ Stock mostrado de forma más humana
Si un producto tiene varias presentaciones, la columna de stock ahora también muestra
el desglose (ej. "5 caja + 1 media caja + 4 unidad") además del número real de
unidades sueltas. El dato guardado sigue siendo un solo número (es lo correcto, ya que
es el mismo inventario físico se venda como se venda) — esto es solo para leerlo mejor.

### 💬 Aclaración sobre el descuento de stock al vender
Revisé el código: el descuento de stock al vender **ya multiplica correctamente por la
cantidad de cada presentación** antes de restar (5 cajas de 15 + 1 media caja de 7 +
4 sueltas = 86 unidades reales descontadas, no una suma ingenua de "9.5"). No se
recomienda separar el stock en "pilas" por tipo de venta (mayoreo/minorista) porque es
el mismo inventario físico; si más adelante quieres reservar un mínimo para mayoreo,
avísame y lo agregamos como una regla configurable por producto.

## Ronda 5: más bugs reales encontrados al probar

### 🐛 Paginación de inventario no funcionaba
Los botones "Anterior/Siguiente" estaban mal ubicados en el código: solo existían
dentro del modal de vista previa de Excel, nunca en la lista normal de productos.
Ya están en el lugar correcto, debajo de la tabla real.

### ✅ Encabezado de la tabla fijo al hacer scroll
Ya no se pierde de vista qué columna es cuál al bajar en la lista de inventario.

### 🐛 "Ventas rápidas" no dejaba elegir presentación
A diferencia de la búsqueda normal, los botones de productos favoritos no tenían el
desplegable de "otra presentación". Ya se agregó, igual que en la búsqueda normal.

### ✅ Ganancia visible desde el precio base
Ahora se muestra la ganancia en Bs y % apenas completas precio de compra/venta, antes
de llegar a la sección de presentaciones.

### ✅ Quitar imagen del producto
Se agregó el botón (el backend ya soportaba guardarlo vacío).

### 🐛 Devoluciones sin protección ni registro en caja
La ruta de devolución no pedía sesión iniciada (¡cualquiera podía llamarla sin
loguearse!) y no tocaba la caja. Ahora requiere sesión, solo el dueño/administrador
puede aprobarla, y el monto devuelto se registra como egreso en la caja abierta de esa
sucursal.

### 🐛 Modal de cotización duplicado (aparecía superpuesto)
Había dos bloques de código casi idénticos que se mostraban a la vez al abrir una
cotización. Se eliminó el duplicado.

### ✅ Eliminar cotizaciones
El botón para eliminar ya existía conectado al backend pero no estaba visible en
ninguna pantalla. Se agregó dentro del documento y también un "×" rápido en cada
línea del historial (solo para las que siguen vigentes).

### Ya funcionaban bien (falsa alarma de mi parte en el resumen anterior)
Al revisar con más calma, esto ya estaba resuelto en tu código: la fecha de cotización
ya no permite ir hacia atrás, los botones +/- de cantidad en Cotizaciones ya
funcionaban, y el nombre de la sucursal ya se mostraba correctamente en el documento
(lo que viste como "Sucursal 2" era el nombre real de esa sucursal, no un error). Y
confirmé que al concluir la venta desde una cotización, esta se marca como convertida
y desaparece de la lista automáticamente — ya estaba bien conectado.

## Ronda 6

### 🐛 Encabezado fijo (arreglo real esta vez)
El intento anterior no funcionaba porque la tabla no tenía su propio scroll interno
(el "sticky" de CSS necesita eso para funcionar confiablemente en todos los
navegadores). Ahora la tabla tiene su propio cuadro con scroll y altura máxima, y el
encabezado sí se queda fijo arriba mientras bajas dentro de ella.

### ✅ Ahora SÍ se ve el detalle de las devoluciones en caja
Antes solo se veía el total de "Egresos" como un número suelto, sin poder ver de
dónde salió. Se agregó un endpoint nuevo y un botón "Ver detalle" en la tarjeta de
Egresos que lista cada movimiento (concepto, monto, quién y cuándo) — ahí vas a ver
"Devolución venta #X: motivo" cuando apruebes una.
**Importante:** el egreso solo se registra si hay una caja ABIERTA en esa sucursal en
el momento de aprobar la devolución. Si no hay caja abierta, la devolución se aprueba
igual (y el stock se repone) pero no hay dónde anotar el egreso — abre caja antes de
probarlo si quieres ver el registro.

### ✅ Ticket con usuario, sucursal y hora
Ahora el ticket impreso muestra quién atendió, en qué sucursal y la fecha/hora exacta
de la venta.

## PWA instalable (lo que pediste esta ronda)
Se agregó: `manifest.webmanifest`, íconos propios de la app, y un *service worker*
(`sw.js`) que cachea solo los archivos propios de la app (nunca los datos de la API:
stock, precios y ventas siempre se piden en vivo al servidor, nunca desde caché).
Con esto el navegador va a ofrecer "Instalar app" y la app cargará al instante aunque
internet falle un segundo. No toqué nada de la lógica de negocio.

## Ronda 7

### 🐛 Historial de ventas fallaba ("la columna s.nombre debe aparecer en GROUP BY")
Error mío: en la ronda anterior agregué el nombre de sucursal al ticket pero olvidé
incluirlo en el `GROUP BY` de esa consulta. Corregido.

### 🐛 La fecha de cotización sí se podía forzar hacia atrás
El `min` del navegador solo bloquea el calendario visual, no evita que alguien teclee
o use las flechitas del campo para poner una fecha anterior a mano. Corregido en dos
capas: el navegador ahora la corrige al vuelo si se teclea una fecha pasada, Y el
servidor también la rechaza aunque alguien intente mandarla saltándose el navegador.

## Ronda 9: módulo Compras (nuevo)

- **Tablas nuevas:** `proveedores` (versión mínima: nombre, empresa, teléfono — la ficha
  completa con productos y descuentos la armamos en la ronda de Proveedores),
  `compras` y `detalle_compras`.
- **Registrar una compra**: eliges proveedor (o lo creas al vuelo con el botón rápido),
  agregas productos con su presentación (caja, unidad, etc.), cantidad y costo. Al
  guardar: suma el stock de esa sucursal automáticamente, Y actualiza el precio de
  compra vigente del producto (mismo mecanismo de historial que ya usa el resto del
  sistema — no pisa el precio anterior, agrega uno nuevo).
- **No reemplaza la edición manual de stock** que ya tienes en Inventario — esa sigue
  para ajustes puntuales. Compras es el registro "oficial" de entrada de mercadería,
  con historial completo de quién compró qué, a quién y cuándo.
- Nuevos permisos: `compras.ver` (ver el módulo) y `compras.crear` (registrar
  compras) — el dueño siempre puede ambas cosas.
- El menú "Compras" que ya estaba en el sistema (pero no hacía nada) ahora sí abre
  el módulo real.

## Ronda 10: ajustes a Compras

### ✅ Productos nuevos directamente desde Compras
Si el producto que compraste todavía no existe en el inventario, ahora aparece un
aviso con el botón "Crearlo ahora" — abre un formulario rápido (nombre, unidad,
precio de venta opcional) y lo deja seleccionado en esa misma fila para seguir
llenando la compra. No hace falta ir a Inventario primero.

### ✅ Búsqueda rápida de productos al elegir
El selector de producto en cada fila ahora es un campo de texto con autocompletado:
escribes "a" y el navegador filtra todos los productos que contienen esa letra.

## Ronda 11

### 🐛 Compras: "no existe la columna numero_factura en compras"
Tu base de datos ya tenía una tabla `compras` de una versión anterior del proyecto, con
otras columnas, y mi creación de tabla no la modificó. Ahora el módulo usa tablas
propias (`compras_erp` y `detalle_compras_erp`) y no toca la vieja. Lo mismo pasaba con
`proveedores` (tu inventario ya la usaba): se le agregaron las columnas que faltaban
sin tocar las existentes. Además, si algo falla al cargar Compras, ahora se muestra el
error en pantalla en vez de quedarse vacío en silencio.

### ✅ Producto nuevo desde Compras, más visible
Botón fijo "+ Producto nuevo (no está en inventario)". Crea una ficha mínima (nombre,
unidad, precio de venta opcional); el detalle (categoría, presentaciones, código de
barras, imagen) se completa después en Inventario.

### ✅ Módulo Clientes (nuevo)
Tabla propia `clientes_erp`. Ficha (nombre, teléfono, CI/NIT, email, dirección, notas),
buscador, desactivar/reactivar, ranking por monto comprado, y botón Historial con los
5 productos que más compra y sus últimas ventas. Las ventas se enlazan al cliente por
teléfono o nombre (sin cambiar el módulo de Ventas).

## Ronda 12

### ✅ Producto nuevo desde Compras = el mismo formulario de Inventario
Ya no hay una versión resumida. "+ Producto nuevo" y "Crearlo ahora" abren el MISMO
formulario de "Nuevo producto" de Inventario (categoría, proveedor, marca, precios de
compra y venta, presentaciones, código de barras, imagen, nombre en mayúscula). Al
guardarlo vuelve a Compras con el producto ya elegido en la fila y su costo cargado.
Se hizo reutilizando el formulario real (no copiándolo), así que si cambia en
Inventario, cambia también en Compras. Deja el stock inicial en 0: la cantidad se suma
al registrar la compra.

### ✅ Flechas con enteros, decimales a mano
Todos los campos de dinero/decimales (precios, descuento, impuesto, efectivo recibido,
costos, stock mínimo, etc.) ahora suben/bajan de 1 en 1 con las flechas, y los
decimales se escriben a mano. Los campos de cantidad de presentación, transferencia,
compra y cotización siguen aceptando solo enteros.

### ✅ Cliente en Ventas
Campo de búsqueda de cliente registrado (por nombre o teléfono). Al elegirlo llena
nombre y teléfono, y la venta entra a su historial en el módulo Clientes. Sigue
pudiéndose escribir un cliente ocasional a mano. Cualquier usuario con acceso a Ventas
puede buscar clientes aunque no tenga el permiso del módulo Clientes.

### 💬 "El producto nuevo no aparecía en Ventas"
Ventas solo muestra productos con stock mayor a 0 en la sucursal activa. El producto
creado desde el atajo anterior quedó con stock 0 porque esa compra falló por el error
de la columna numero_factura (corregido en la ronda 11), así que nunca se le sumó
stock. Con una compra registrada correctamente debe aparecer en Ventas al entrar.

## Ronda 13

### 🐛 Compras: 1 caja de 270 Bs aparecía como 4050
Error mío. El campo "costo" de Compras se interpretaba como costo POR UNIDAD suelta y se
multiplicaba por las 15 unidades de la caja (270 × 15 = 4050). Ahora el costo que escribes
es el de UNA presentación (una caja = 270), el subtotal es cantidad × ese costo (1 × 270 =
270), y el sistema calcula solo el costo por unidad (270 / 15 = 18) para el costo vigente
del producto. La presentación comprada queda con exactamente lo que pagaste; las otras se
recalculan solo si su costo era el proporcional automático (no pisa costos puestos a mano).
**Si ya registraste una compra de prueba con la versión anterior**, el producto quedó con
costo por unidad = 270 (debía ser 18). Se corrige registrando una compra nueva con esta
versión, o editando el producto en Inventario. El stock sumado sí fue correcto (15).

### ✅ Compras: producto existente con precio de compra editable
En cada línea: el costo es editable y muestra subtotal, costo anterior (sube/baja %), precio
de venta actual y ganancia con el costo nuevo. Botón "Editar producto completo" que abre el
MISMO formulario de Inventario (modo edición) para cambiar precios de compra/venta,
presentaciones, etc.

### 🔒 Costo de presentaciones oculto a quien no puede ver precios de compra
Antes, un usuario sin el permiso "precios.compra.ver" no veía el precio de compra del
producto pero sí podía recibir el costo de cada presentación. Ya no.

### ✅ Ventas: botón "Guardar en Clientes"
Si el cliente escrito no está registrado, aparece el botón para registrarlo en un clic.
Cualquier usuario con acceso a Ventas puede registrar clientes desde ahí.

## Ronda 14

### 🐛 Devolución: "no existe la columna metodo_pago"
Error mío: la consulta pedía `metodo_pago` a la tabla de ventas, pero el método de pago
está en la tabla `pagos`. Ahora se lee de ahí; el egreso en caja queda con el mismo método
con que se pagó la venta (efectivo, QR, etc.).

### ✅ Compras: ficha completa al elegir un producto existente
Al elegir un producto que ya existe, se abre automáticamente su ficha completa (el MISMO
formulario de Inventario, en modo edición) con precios de compra y venta, presentaciones y
ganancia, para ajustar los precios antes de registrar la compra. Se abre solo cuando lo
eliges de la lista (no mientras tecleas). Hay una casilla para desactivarlo si en algún
momento solo quieres sumar stock al mismo precio. Debajo de cada línea también aparece el
botón "Editar ficha completa".

### ✅ Ventas: productos sin stock ya no desaparecen sin explicación
Ventas solo vende productos con stock mayor a 0 (el servidor no deja vender sin stock). Antes,
un producto con stock 0 simplemente no aparecía en la búsqueda. Ahora aparece atenuado con la
leyenda "Sin stock en esta sucursal: registra una compra para poder venderlo".

## Ronda 15

### ✅ Cotizaciones con todas las presentaciones del producto
En "catálogo / productos de la propuesta", cada producto muestra su presentación principal y
un desplegable "Otra presentación…" (caja, media caja, unidad, etc.), igual que en Ventas.
Cada línea guarda qué presentación y a qué precio se cotizó, se ve en el documento impreso y,
al pasar la cotización a Ventas, llega con la misma presentación. Las cotizaciones viejas
(sin presentación) siguen funcionando. Cambio de comportamiento: al agregar un producto sin
elegir, ahora entra la presentación principal (la más grande) y no la unidad suelta.
También se corrigió que las líneas de una cotización cargada en Ventas no podían subir/bajar
cantidad con los botones +/-.

### ✅ Roles desde el formulario de usuario
Botón "+ Crear rol nuevo" dentro de "Crear usuario": marcas los permisos, le pones nombre y
queda creado y seleccionado. Hay plantillas rápidas (Cajero, Vendedor de calle, Encargado de
almacén), también en la pestaña Roles; son un punto de partida y se pueden ajustar.

### ✅ Preparado para usar desde otros dispositivos/redes
Ver CONEXION_OTROS_DISPOSITIVOS.md. En tu PC nada cambia. Se agregó el reenvío de /api en
vite.config.js, un ajuste en main.jsx que solo actúa cuando la app se abre desde otro
dispositivo, y el service worker ya nunca guarda en caché respuestas de /api/.

## 🔲 Pendiente (para la próxima ronda)
- Precio mayor/menor con cantidad mínima automática (el ejemplo del aceite: comprás
  por caja, vendés distinto por mayor/menor/unidad suelta). El cálculo de ganancia por
  presentación ya existía y no se tocó porque ya funcionaba como pediste.

## Cómo probarlo
1. Corre el proyecto como siempre (`INICIAR_ERP_GPT.bat` o tu método habitual).
2. Entra como dueño/administrador → pestaña **Roles**: crea el rol "Vendedor de calle"
   con los permisos de arriba.
3. Pestaña **Usuarios**: crea un usuario con ese rol, o edita uno existente y cámbiale
   el rol/permisos con el botón "Editar".
4. Pestaña **Sucursales**: prueba "Editar" en una sucursal existente.
5. En **Inventario**, crea un producto con un usuario que tenga `inventario.crear` +
   `inventario.solo_propios`, y confirma que otro usuario "caja" no puede editarlo
   (debería aparecer "Sin permiso" en vez de los botones).
6. Si algo tira error en la consola del navegador o del backend, mándame el mensaje
   exacto y lo reviso.
