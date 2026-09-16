import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'

function Inventario() {
  const [productos, setProductos] = useState([])
  const [mostrarDeshabilitados, setMostrarDeshabilitados] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(true)
  const [excelVistaPrevia, setExcelVistaPrevia] = useState([])
  const [mostrarVistaExcel, setMostrarVistaExcel] = useState(false)
  const [error, setError] = useState('')
  const [paginaActual, setPaginaActual] = useState(1)
  const [productosPorPagina, setProductosPorPagina] = useState(50)

  const [mostrarNuevoProducto, setMostrarNuevoProducto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [productoEditando, setProductoEditando] = useState(null)
  const [mensajeExito, setMensajeExito] = useState('')
  const nombreProductoRef = useRef(null)
  const codigoBarrasRef = useRef(null)
  
  const cerrarVistaExcel = () => {
  setMostrarVistaExcel(false)
  setExcelVistaPrevia([])
}

  const [nuevoProducto, setNuevoProducto] = useState({
    nombre: '',
    codigo_barras: '',
    marca: '',
    categoria_id: '',
    proveedor_id: '',
    unidad: 'Unidad',
    descripcion: '',
    precio_compra: '',
    precio_venta: '',
    stock_inicial: '',
    stock_minimo: '',
    imagen_url: ''
  })

  useEffect(() => {
    cargarProductos()
  }, [])

  useEffect(() => {
    if (!mostrarNuevoProducto) {
      return undefined
    }

    nombreProductoRef.current?.focus()

    const cerrarConEscape = (evento) => {
      if (evento.key === 'Escape' && !guardando) {
        setProductoEditando(null)
        setError('')
        setMostrarNuevoProducto(false)
      }
    }

    document.addEventListener('keydown', cerrarConEscape)

    return () => document.removeEventListener('keydown', cerrarConEscape)
  }, [mostrarNuevoProducto, guardando])

  const cargarProductos = async () => {
    try {
      setCargando(true)
      setError('')

      const respuesta = await fetch('http://localhost:3000/api/productos')
      const datos = await respuesta.json()

      if (!respuesta.ok || !datos.ok) {
        throw new Error(
          datos.mensaje || 'No se pudieron cargar los productos'
        )
      }

      setProductos(datos.productos || [])
    } catch (err) {
      setError(err.message || 'Error conectando con el servidor')
    } finally {
      setCargando(false)
    }
  }
const cargarProductosDeshabilitados = async () => {
  try {
    setError('')

    const respuesta = await fetch(
      'http://localhost:3000/api/productos/deshabilitados'
    )

    const datos = await respuesta.json()

    if (!respuesta.ok || !datos.ok) {
      throw new Error(
        datos.mensaje ||
        'No se pudieron cargar los productos deshabilitadossssssssss'
      )
    }

    setProductos(datos.productos || [])

  } catch (err) {
    setError(
      err.message ||
      'Error cargando productos deshabilitados'
    )
  }
}

const importarExcel = async (evento) => {
  const archivo = evento.target.files?.[0]

  if (!archivo) {
    return
  }

  try {
    setError('')

    const datos = await archivo.arrayBuffer()
    const libro = XLSX.read(datos, {
      type: 'array'
    })

    const primeraHoja = libro.Sheets[libro.SheetNames[0]]

    const filas = XLSX.utils.sheet_to_json(primeraHoja, {
      defval: ''
    })

    if (filas.length === 0) {
      alert('El archivo Excel está vacío.')
      return
    }

    setExcelVistaPrevia(filas)
    setMostrarVistaExcel(true)
 	 	
  } catch (error) {
    console.error('ERROR IMPORTANDO EXCEL:', error)

    setError(
      error.message || 'No se pudo leer el archivo Excel'
    )
  } finally {
    evento.target.value = ''
  }
}  
const productosFiltrados = productos.filter((producto) => {
    const texto = busqueda.toLowerCase()

    return (
      producto.nombre?.toLowerCase().includes(texto) ||
      producto.codigo_interno?.toLowerCase().includes(texto) ||
      producto.codigo_barras?.toLowerCase().includes(texto) ||
      producto.categoria?.toLowerCase().includes(texto) ||
      producto.marca?.toLowerCase().includes(texto)
    )
  })
  
  const totalPaginas = Math.max(
    1,
    Math.ceil(
      productosFiltrados.length / productosPorPagina
    )
  )

  const productosPaginados = productosFiltrados.slice(
    (paginaActual - 1) * productosPorPagina,
    paginaActual * productosPorPagina
  )

  const estadoStock = (producto) => {
    const stock = Number(producto.stock_actual || 0)
    const minimo = Number(producto.stock_minimo || 0)

    if (stock <= minimo) {
      return {
        clase: 'stock-low',
        texto: 'Stock bajo'
      }
    }

    if (stock <= minimo * 2) {
      return {
        clase: 'stock-warning',
        texto: 'Vigilar'
      }
    }

    return {
      clase: 'stock-ok',
      texto: 'Disponible'
    }
  }

  const cambiarCampo = (campo, valor) => {
  const valorFinal =
    campo === 'nombre'
      ? valor.toUpperCase()
      : valor

  setNuevoProducto((anterior) => ({
    ...anterior,
    [campo]: valorFinal
  }))
}

  const seleccionarImagen = (evento) => {
    const archivo = evento.target.files?.[0]

    if (!archivo) {
      return
    }

    if (archivo.size > 600000) {
      setError('La imagen debe pesar menos de 600 KB.')
      return
    }

    const lector = new FileReader()
    lector.onload = () => cambiarCampo('imagen_url', lector.result)
    lector.readAsDataURL(archivo)
  }
	const limpiarFormulario = () => {
  
	setProductoEditando(null)

  
	setError('')
	
	setNuevoProducto({
    
	nombre: '',
    
	codigo_barras: '',
    
	marca: '',
    
	categoria_id: '',
    
	proveedor_id: '',
    
	unidad: 'Unidad',
    
	descripcion: '',
    
	precio_compra: '',
    
	precio_venta: '',
    
	stock_inicial: '',
    
  stock_minimo: '',

  imagen_url: ''
  
	})
	
}

	  const guardarNuevoProducto = async (e) => {
    
	  e.preventDefault()

    

	if (!nuevoProducto.nombre.trim()) {
      
	alert('El nombre del producto es obligatorio.')
      
	return
    
	}



	try {
      
		setGuardando(true)
      
		setError('')

      
	const respuesta = await fetch(
        
	productoEditando
          
	? `http://localhost:3000/api/productos/${productoEditando.id}`
          
	: 'http://localhost:3000/api/productos',
        
	{
          
	method: productoEditando ? 'PUT' : 'POST',
          
	headers: {
            
	'Content-Type': 'application/json'
          
	},
          
	body: JSON.stringify({
            
	...nuevoProducto,
            
	categoria_id: nuevoProducto.categoria_id || null,
            
	proveedor_id: nuevoProducto.proveedor_id || null,
            
	precio_compra: Number(nuevoProducto.precio_compra) || 0,
            
	precio_venta: Number(nuevoProducto.precio_venta) || 0,
            
	stock_inicial: Number(nuevoProducto.stock_inicial) || 0,
            
	stock_minimo: Number(nuevoProducto.stock_minimo) || 0
          
	})
        
      }
      
     )

      
	const datos = await respuesta.json()

 
     
	if (!respuesta.ok || !datos.ok) {
        
	throw new Error(
          
	datos.mensaje || 'No se pudo guardar el producto'
        
	)
      
       }

   
   
	/// CORRECCIÓN: Avisa correctamente si se creó o si se editó
setMensajeExito(
  productoEditando
    ? 'Producto actualizado correctamente.'
    : 'Producto creado correctamente.'
)

// CORRECCIÓN: Limpia las variables de edición y cierra la ventana
limpiarFormulario()
setMostrarNuevoProducto(false)
setProductoEditando(null)  // ← ESTA LÍNEA ES LA CLAVE

// Recarga la lista de productos actualizados
await cargarProductos()

  
  
	} catch (err) {
      
	setError(
        
	err.message || 'No se pudo guardar el producto'
      
	)
    
	} finally {
      
	setGuardando(false)
    
	 }
  
	}

  return (
    <section className="inventory-page">

      <div className="inventory-top">

        <div>
          <h2>Inventario</h2>
          <p>Productos registrados en Tienda Tieri</p>
        </div>

        <div className="inventory-actions">

          <>
  <input
    id="input-importar-excel"
    type="file"
    accept=".xlsx,.xls"
    style={{ display: 'none' }}
    onChange={importarExcel}
  />

  <button
  className="secondary-button"
  type="button"
  onClick={() => {
    setMostrarNuevoProducto(false)
    setProductoEditando(null)
    limpiarFormulario()
    cerrarVistaExcel()

    document
      .getElementById('input-importar-excel')
      .click()
  }}
>
  📥 Importar Excel
</button>
</>

          <button
  className="secondary-button"
  type="button"
  onClick={() => {
    const datosExcel = productos.map((producto) => ({
      'Código interno': producto.codigo_interno || '',
      'Código de barras': producto.codigo_barras || '',
      'Nombre': producto.nombre || '',
      'Marca': producto.marca || '',
      'Categoría': producto.categoria || '',
      'Unidad': producto.unidad || '',
      'Precio compra': producto.precio_compra_actual || 0,
      'Precio venta': producto.precio_venta_actual || 0,
      'Stock actual': producto.stock_actual || 0,
      'Stock mínimo': producto.stock_minimo || 0
    }))

    const hoja = XLSX.utils.json_to_sheet(datosExcel)
    const libro = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(
      libro,
      hoja,
      'Inventario'
    )

    XLSX.writeFile(
      libro,
      'Inventario_Tienda_Tieri.xlsx'
    )
  }}
>
  📤 Exportar Excel
</button>
	<button
  className="secondary-button"
  type="button"
  onClick={async () => {
    if (mostrarDeshabilitados) {
      await cargarProductos()
      setMostrarDeshabilitados(false)
    } else {
      await cargarProductosDeshabilitados()
      setMostrarDeshabilitados(true)
    }
  }}
	>
  {mostrarDeshabilitados
    ? 'Ver productos activos'
    : 'Ver productos deshabilitados'}
</button>
          <button
            className="primary-button"
            type="button"
            onClick={() => {
  
	    cerrarVistaExcel()
  
	    setProductoEditando(null)
  
	    limpiarFormulario()
  
	    setMostrarNuevoProducto(true)

	}}

          >
            + Nuevo producto
          </button>

        </div>

      </div>

      <div className="inventory-toolbar">

        <div className="search-box">
          🔎

          <input
            type="text"
            placeholder="Buscar por nombre, código, marca o categoría..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />

        </div>

        <div className="inventory-count">
          {productosFiltrados.length} productos
        </div>

        <button
          className="refresh-button"
          type="button"
          onClick={cargarProductos}
        >
          ↻ Actualizar
        </button>

      </div>

      {cargando && (
        <div className="inventory-message">
          Cargando productos...
        </div>
      )}

      {error && (
        <div className="inventory-error">
          {error}
        </div>
      )}

      {!cargando && !error && (
        <div className="inventory-table-container">

          <table className="inventory-table">

            <thead>
              <tr>
                <th>Producto</th>
                <th>Código</th>
                <th>Categoría</th>
                <th>Marca</th>
                <th>Unidad</th>
		<th>Precio compra</th>
                <th>Precio venta</th>
                <th>Stock</th>
		<th>Stock mínimo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>

            <tbody>

              {productosPaginados.map((producto) => {

                const estado = estadoStock(producto)

                return (
                  <tr key={producto.id}>

                    <td>
                      <div className="product-name">
                        <strong>
                          {producto.nombre}
                        </strong>

                        {producto.descripcion && (
                          <small>
                            {producto.descripcion}
                          </small>
                        )}
                      </div>
                    </td>

                    <td>
                      <span className="code">
                        {producto.codigo_interno || '-'}
                      </span>
                    </td>

                    <td>
                      {producto.categoria || '-'}
                    </td>

                    <td>
                      {producto.marca || '-'}
                    </td>

                    <td>
                      {producto.unidad || '-'}
                    </td>

                    <td>
  <strong>
    Bs{' '}
    {Number(
      producto.precio_compra_actual || 0
    ).toFixed(2)}
  </strong>
</td>

<td>
  <strong>
    Bs{' '}
    {Number(
      producto.precio_venta_actual || 0
    ).toFixed(2)}
  </strong>
</td>

                    <td>
  <strong>
    {Number(
      producto.stock_actual || 0
    )}
  </strong>
</td>

<td>
  <strong>
    {Number(
      producto.stock_minimo || 0
    )}
  </strong>
</td>

<td>
  <span
    className={`stock-badge ${estado.clase}`}
  >
    {estado.texto}
  </span>
</td>

                    <td>
  <div style={{ display: 'flex', gap: '8px' }}>

    <button
      className="table-action"
      type="button"
      onClick={() => {
	cerrarVistaExcel()
        setProductoEditando(producto)

        setNuevoProducto({
          nombre: producto.nombre || '',
          codigo_barras: producto.codigo_barras || '',
          marca: producto.marca || '',
          categoria_id: producto.categoria_id || '',
          proveedor_id: producto.proveedor_id || '',
          unidad: producto.unidad || 'Unidad',
          descripcion: producto.descripcion || '',
          precio_compra: producto.precio_compra_actual || '',
          precio_venta: producto.precio_venta_actual || '',
          stock_inicial: producto.stock_actual || '',
            stock_minimo: producto.stock_minimo || '',
            imagen_url: producto.imagen_url || ''
        })

        setMostrarNuevoProducto(true)
      }}
    >
      Editar
    </button>

    <button
  className="table-action"
  type="button"
  onClick={async () => {
    const nuevoEstado = producto.activo === false

    const confirmar = window.confirm(
      nuevoEstado
        ? `¿Deseas habilitar el producto "${producto.nombre}"?`
        : `¿Deseas deshabilitar el producto "${producto.nombre}"?`
    )

    if (!confirmar) {
      return
    }

    try {
      setError('')

      const respuesta = await fetch(
        `http://localhost:3000/api/productos/${producto.id}/estado`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            activo: nuevoEstado
          })
        }
      )

      const datos = await respuesta.json()

      if (!respuesta.ok || !datos.ok) {
        throw new Error(
          datos.mensaje || 'No se pudo cambiar el estado del producto'
        )
      }

      alert(datos.mensaje)

      await cargarProductos()

    } catch (error) {
      console.error(
        'ERROR CAMBIANDO ESTADO PRODUCTO:',
        error
      )

      setError(
        error.message ||
        'No se pudo cambiar el estado del producto'
      )
    }
  }}
>
  {producto.activo === false
    ? 'Habilitar'
    : 'Deshabilitar'}
</button>

  </div>
</td>

                  </tr>
                )
              })}

            </tbody>
	 </table>

          <div
  style={{
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '15px'
  }}
>
  <label>
    Mostrar:
  </label>

  <select
    value={productosPorPagina}
    onChange={(e) => {
      setProductosPorPagina(Number(e.target.value))
      setPaginaActual(1)
    }}
  >
    <option value={25}>25</option>
    <option value={50}>50</option>
    <option value={100}>100</option>
    <option value={200}>200</option>
  </select>

  <span>productos por página</span>
</div>

          {productosFiltrados.length === 0 && (
            <div className="empty-inventory">
              No se encontraron productos.
            </div>
          )}

        </div>
      )}
{mostrarVistaExcel && (
  <div className="modal-overlay">

    <div className="modal-card">

      <div className="modal-header">

        <div>
          <h2>Vista previa de Excel</h2>

          <p>
            Se encontraron {excelVistaPrevia.length} productos.
            Revisa los datos antes de continuar.
          </p>
        </div>

        <button
          className="modal-close"
          type="button"
          onClick={() => {
            setMostrarVistaExcel(false)
            setExcelVistaPrevia([])
	    setError('')
          }}
        >
          ✕
        </button>

      </div>

      <div style={{ overflowX: 'auto' }}>

        <table className="inventory-table">

          <thead>
            <tr>
              {excelVistaPrevia.length > 0 &&
                Object.keys(excelVistaPrevia[0]).map((columna) => (
                  <th key={columna}>
                    {columna}
                  </th>
                ))}
            </tr>
          </thead>

          <tbody>

            {excelVistaPrevia.map((fila, indice) => (
              <tr key={indice}>

                {Object.keys(
                  excelVistaPrevia[0] || {}
                ).map((columna) => (
                  <td key={columna}>
                    {String(fila[columna] ?? '')}
                  </td>
                ))}

              </tr>
            ))}
              </tbody>

            </table>

            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '15px',
                marginTop: '20px',
                marginBottom: '20px'
              }}
            >
              <button
                className="secondary-button"
                type="button"
                disabled={paginaActual === 1}
                onClick={() => {
                  setPaginaActual((pagina) => pagina - 1)
                }}
              >
                ← Anterior
              </button>

              <span>
                Página {paginaActual} de {totalPaginas}
              </span>

              <button
                className="secondary-button"
                type="button"
                disabled={paginaActual === totalPaginas}
                onClick={() => {
                  setPaginaActual((pagina) => pagina + 1)
                }}
              >
                Siguiente →
              </button>
            </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px',
          marginTop: '20px'
        }}
      >

        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setMostrarVistaExcel(false)
            setExcelVistaPrevia([])
	    setError('')
          }}
        >
          Cancelar
        </button>

        <button
  className="primary-button"
  type="button"
  onClick={async () => {
    try {
      setError('')

      for (const fila of excelVistaPrevia) {
        const respuesta = await fetch(
          'http://localhost:3000/api/productos',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              nombre: fila['Nombre'] || '',
              codigo_barras: fila['Código de barras'] || '',
              marca: fila['Marca'] || '',
              unidad: fila['Unidad'] || 'Unidad',
              precio_compra: Number(fila['Precio compra']) || 0,
              precio_venta: Number(fila['Precio venta']) || 0,
              stock_inicial: Number(fila['Stock actual']) || 0,
              stock_minimo: Number(fila['Stock mínimo']) || 0
            })
          }
        )

        const datos = await respuesta.json()

        if (!respuesta.ok || !datos.ok) {
          throw new Error(
            datos.mensaje || 'No se pudo importar un producto'
          )
        }
      }

      alert(
        `${excelVistaPrevia.length} productos importados correctamente.`
      )

      cerrarVistaExcel()
      await cargarProductos()

    } catch (error) {
      console.error('ERROR IMPORTANDO PRODUCTOS:', error)

      setError(
        error.message || 'No se pudieron importar los productos'
      )
    }
  }}
>
  Importar productos
</button>

      </div>

    </div>

  </div>
)}
      {mostrarNuevoProducto && (
        <div
          className="modal-overlay"
          role="presentation"
          onMouseDown={(evento) => {
            if (evento.target === evento.currentTarget && !guardando) {
              limpiarFormulario()
              setMostrarNuevoProducto(false)
            }
          }}
        >

          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="producto-modal-titulo"
          >

            <div className="modal-header">

              <div>
                <h2 id="producto-modal-titulo">
  {productoEditando
    ? 'Editar producto'
    : 'Nuevo producto'}
</h2>

<p>
  {productoEditando
    ? 'Actualiza la información del producto.'
    : 'Registra un nuevo producto en el inventario.'}
</p>
              </div>

              <button
                className="modal-close"
                type="button"
                onClick={() => {
		limpiarFormulario()
    
		setProductoEditando(null)
		setMostrarNuevoProducto(false)
  
		}}
              >
                ✕
              </button>

            </div>

            <form onSubmit={guardarNuevoProducto}>

              <div className="form-grid">

                <div className="form-group">
                  <label>Nombre *</label>

                  <input
                    ref={nombreProductoRef}
                    type="text"
                    value={nuevoProducto.nombre}
                    onChange={(e) =>
                      cambiarCampo(
                        'nombre',
                        e.target.value
                      )
                    }
                    placeholder="Ej. Leche PIL 1L"
                    required
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') {
                        return
                      }

                      e.preventDefault()
                      const valor = e.currentTarget.value.trim()

                      if (/^\d{4,}$/.test(valor) && !nuevoProducto.codigo_barras) {
                        cambiarCampo('codigo_barras', valor)
                        cambiarCampo('nombre', '')
                        codigoBarrasRef.current?.focus()
                      }
                    }}
                  />
                </div>

                <div className="form-group">
                  <label>Código de barras</label>

                  <input
                    ref={codigoBarrasRef}
                    type="text"
                    value={nuevoProducto.codigo_barras}
                    onChange={(e) =>
                      cambiarCampo(
                        'codigo_barras',
                        e.target.value
                      )
                    }
                    placeholder="Opcional"
                  />
                </div>

                <div className="form-group">
                  <label>Marca</label>

                  <input
                    type="text"
                    value={nuevoProducto.marca}
                    onChange={(e) =>
                      cambiarCampo(
                        'marca',
                        e.target.value
                      )
                    }
                    placeholder="Ej. PIL"
                  />
                </div>

                <div className="form-group">
                  <label>Unidad</label>

                  <select
                    value={nuevoProducto.unidad}
                    onChange={(e) =>
                      cambiarCampo(
                        'unidad',
                        e.target.value
                      )
                    }
                  >
                    <option value="Unidad">
  Unidad
</option>

<option value="Caja">
  Caja
</option>

<option value="Jaba">
  Jaba
</option>

<option value="Paquete">
  Paquete
</option>

<option value="Docena">
  Docena
</option>

<option value="Quintal">
  Quintal
</option>

<option value="Kg">
  Kg
</option>

<option value="Gramo">
  Gramo
</option>

<option value="Litro">
  Litro
</option>

<option value="Display">
  Display
</option>

<option value="Otro">
  Otro
</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Categoría</label>

<select
  value={nuevoProducto.categoria_id}
  onChange={(e) =>
    cambiarCampo(
      'categoria_id',
      e.target.value
    )
  }
>
  <option value="">
    Seleccionar categoría
  </option>

  <option value="1">
    Abarrotes
  </option>

  <option value="2">
    Bebidas
  </option>

  <option value="3">
    Lacteos
  </option>

  <option value="4">
    Limpieza
  </option>

  <option value="5">
    Snacks
  </option>
</select>
                </div>

                <div className="form-group">
                  <label>Proveedor</label>

<select
  value={nuevoProducto.proveedor_id}
  onChange={(e) =>
    cambiarCampo(
      'proveedor_id',
      e.target.value
    )
  }
>
  <option value="">
    Seleccionar proveedor
  </option>

  <option value="1">
    Distribuidora Central
  </option>

  <option value="2">
    Coca Cola Bolivia
  </option>

  <option value="3">
    Lacteos Bolivia
  </option>

  <option value="4">
    Importadora Tieri
  </option>

  <option value="5">
    Distribuidora Nacional
  </option>

</select>
                </div>

                <div className="form-group">
                  <label>Precio compra</label>

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={nuevoProducto.precio_compra}
                    onChange={(e) =>
                      cambiarCampo(
                        'precio_compra',
                        e.target.value
                      )
                    }
                    placeholder="0.00"
                  />
                </div>

                <div className="form-group">
                  <label>Precio venta</label>

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={nuevoProducto.precio_venta}
                    onChange={(e) =>
                      cambiarCampo(
                        'precio_venta',
                        e.target.value
                      )
                    }
                    placeholder="0.00"
                  />
                </div>

                <div className="form-group">
                  <label>Stock inicial</label>

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={nuevoProducto.stock_inicial}
                    onChange={(e) =>
                      cambiarCampo(
                        'stock_inicial',
                        e.target.value
                      )
                    }
                    placeholder="0"
                  />
                </div>

                <div className="form-group">
                  <label>Stock mínimo</label>

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={nuevoProducto.stock_minimo}
                    onChange={(e) =>
                      cambiarCampo(
                        'stock_minimo',
                        e.target.value
                      )
                    }
                    placeholder="0"
                  />
                </div>

                <div className="form-group form-group-full">
                  <label>Descripción</label>

                  <textarea
                    value={nuevoProducto.descripcion}
                    onChange={(e) =>
                      cambiarCampo(
                        'descripcion',
                        e.target.value
                      )
                    }
                    placeholder="Descripción opcional del producto"
                    rows="3"
                  />
                </div>

                <div className="form-group form-group-full">
                  <label>Imagen de referencia</label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={seleccionarImagen}
                  />
                  {nuevoProducto.imagen_url && (
                    <img
                      className="producto-imagen-preview"
                      src={nuevoProducto.imagen_url}
                      alt="Vista previa del producto"
                    />
                  )}
                </div>

              </div>

              <div className="modal-footer">

                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
		    limpiarFormulario()	
		    setProductoEditando(null)
                    setMostrarNuevoProducto(false)
                  }}
                  disabled={guardando}
                >
                  Cancelar
                </button>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={guardando}
                >
                  {guardando
                    ? 'Guardando...'
                    : 'Guardar producto'}
                </button>

              </div>

            </form>

          </div>

        </div>
      )}

{mensajeExito && (
  <div className="modal-overlay">
    <div
      className="modal-card"
      style={{
        maxWidth: '420px',
        textAlign: 'center'
      }}
    >
      <div
        style={{
          fontSize: '48px',
          marginBottom: '12px'
        }}
      >
        ✓
      </div>

      <h2>Operación exitosa</h2>

      <p>{mensajeExito}</p>

      <button
        className="primary-button"
        type="button"
        onClick={() => setMensajeExito('')}
      >
        Aceptar
      </button>
    </div>
  </div>
)}
    </section>
  )
}

export default Inventario