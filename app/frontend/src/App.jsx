import { Component, useEffect, useState } from 'react'
import Inventario from './Inventario'
import Caja from './Caja'
import Ventas from './Ventas'
import Configuracion from './Configuracion'
import Reportes from './Reportes'
import Cotizaciones from './Cotizaciones'
import Administracion from './Administracion'
import Compras from './Compras'
import Clientes from './Clientes'
import { API } from './api'

class InventarioErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('ERROR MOSTRANDO INVENTARIO:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <section className="inventory-error" role="alert">
          <strong>No se pudo mostrar el inventario.</strong>
          <div>{this.state.error.message || 'Ocurrió un error inesperado.'}</div>
          <button className="secondary-button" type="button" onClick={() => window.location.reload()}>
            Recargar aplicación
          </button>
        </section>
      )
    }

    return this.props.children
  }
}

function App() {
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [cargando, setCargando] = useState(false)
  const [sesion, setSesion] = useState(null)
  const [error, setError] = useState('')
  const [modulo, setModulo] = useState('inicio')
  const [ventaInicial, setVentaInicial] = useState(null)
  const [resumen, setResumen] = useState(null)
  const [sucursales, setSucursales] = useState([])
  const esDueno = [1, '1'].includes(sesion?.rol_id) || ['dueño', 'dueno', 'propietario'].includes(String(sesion?.rol || '').toLowerCase())
  const puedeVerGanancias = esDueno || ['admin', 'administrador', 'gerente general'].includes(String(sesion?.rol || '').toLowerCase())

  const iniciarSesion = async (e) => {
    e.preventDefault()

    setError('')
    setCargando(true)

    try {
      const respuesta = await fetch(`${API}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          usuario,
          password
        })
      })

      const datos = await respuesta.json()

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.mensaje || 'No se pudo iniciar sesión')
      }

      localStorage.setItem('tieri_token', datos.token)
      localStorage.setItem('tieri_usuario', JSON.stringify(datos.usuario))

      setSesion(datos.usuario)
      setPassword('')
    } catch (err) {
      setError(err.message || 'Error de conexión con el servidor')
    } finally {
      setCargando(false)
    }
  }

  const cerrarSesion = () => {
    localStorage.removeItem('tieri_token')
    localStorage.removeItem('tieri_usuario')
    setSesion(null)
    setUsuario('')
    setPassword('')
  }

  useEffect(() => {
    if (!sesion || !esDueno) return
    fetch(`${API}/sucursales`, { headers: { Authorization: `Bearer ${localStorage.getItem('tieri_token') || ''}` } })
      .then((respuesta) => respuesta.json())
      .then((datos) => { if (datos.ok) setSucursales(datos.sucursales || []) })
      .catch(() => {})
  }, [sesion, esDueno])

  useEffect(() => {
    if (!sesion?.sucursal_id) return
    fetch(`${API}/dashboard/resumen?sucursal_id=${sesion.sucursal_id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('tieri_token') || ''}` } })
      .then((respuesta) => respuesta.json())
      .then((datos) => { if (datos.ok) setResumen(datos) })
      .catch(() => {})
  }, [sesion?.sucursal_id, modulo])

  const cambiarSucursal = async (evento) => {
    const sucursal_id = Number(evento.target.value)
    if (!sucursal_id || sucursal_id === Number(sesion.sucursal_id)) return
    const respuesta = await fetch(`${API}/sesion/sucursal`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('tieri_token') || ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sucursal_id })
    })
    const datos = await respuesta.json()
    if (!respuesta.ok || !datos.ok) return window.alert(datos.mensaje || 'No se pudo cambiar de sucursal')
    const actualizado = { ...sesion, sucursal_id, sucursal_nombre: datos.sucursal.nombre }
    localStorage.setItem('tieri_token', datos.token)
    localStorage.setItem('tieri_usuario', JSON.stringify(actualizado))
    setSesion(actualizado)
    setModulo('inicio')
  }

  const menu = [
    { id: 'inicio', icono: '🏠', nombre: 'Inicio' },
    { id: 'ventas', permiso: 'ventas.ver', icono: '🛒', nombre: 'Ventas' },
    { id: 'inventario', permiso: 'inventario.ver', icono: '📦', nombre: 'Inventario' },
    { id: 'cotizaciones', permiso: 'cotizaciones.ver', icono: '🧾', nombre: 'Cotizaciones' },
    { id: 'compras', permiso: 'compras.ver', icono: '🛍️', nombre: 'Compras' },
    { id: 'caja', permiso: 'caja.ver', icono: '💰', nombre: 'Caja' },
    { id: 'clientes', permiso: 'clientes.ver', icono: '👥', nombre: 'Clientes' },
    { id: 'proveedores', permiso: 'proveedores.ver', icono: '🚚', nombre: 'Proveedores' },
    { id: 'reportes', permiso: 'reportes.ver', icono: '📊', nombre: 'Reportes' },
    { id: 'usuarios', permiso: 'usuarios.ver', icono: '👤', nombre: 'Usuarios' },
    { id: 'sucursales', permiso: 'sucursales.ver', icono: '🏪', nombre: 'Sucursales' },
    { id: 'configuracion', permiso: 'configuracion.ver', icono: '⚙️', nombre: 'Configuración' }
  ]
  const menuVisible = menu.filter((item) => !item.permiso || esDueno || sesion?.permisos?.includes(item.permiso))

  const tituloModulo =
    menu.find((item) => item.id === modulo)?.nombre || 'Inicio'

  if (!sesion) {
    return (
      <main className="login-page">
        <section className="login-card">

          <div className="brand">
            <div className="brand-icon">T</div>
            <h1>Tienda Tieri</h1>
            <p>ERP MINIMARKET BOLIVIA</p>
          </div>

          <div className="login-title">
            <h2>Iniciar sesión</h2>
            <span>Ingresa para administrar tu negocio</span>
          </div>

          <form onSubmit={iniciarSesion}>

            <label htmlFor="usuario">Usuario</label>

            <input
              id="usuario"
              type="text"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="Ingresa tu usuario"
              autoComplete="username"
              required
            />

            <label htmlFor="password">Contraseña</label>

            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Ingresa tu contraseña"
              autoComplete="current-password"
              required
            />

            <button type="submit" disabled={cargando}>
              {cargando ? 'Ingresando...' : 'INGRESAR'}
            </button>

          </form>

          {error && (
            <div className="message error">
              {error}
            </div>
          )}

          <footer>
            <span>© Tienda Tieri</span>
            <span>ERP para minimarkets</span>
          </footer>

        </section>
      </main>
    )
  }

  return (
    <main className="erp-layout">

      <aside className="sidebar">

        <div className="sidebar-brand">
          <div className="brand-icon small">T</div>

          <div>
            <strong>Tienda Tieri</strong>
            <span>ERP MINIMARKET</span>
          </div>
        </div>

        <nav className="sidebar-menu">

          <div className="menu-label">PRINCIPAL</div>

          {menuVisible.filter((item) => ['inicio', 'ventas', 'inventario', 'cotizaciones', 'compras', 'caja', 'clientes', 'proveedores', 'reportes'].includes(item.id)).map((item) => (
            <button
              key={item.id}
              className={`menu-item ${modulo === item.id ? 'active' : ''}`}
              onClick={() => setModulo(item.id)}
            >
              <span className="menu-icon">{item.icono}</span>
              <span>{item.nombre}</span>
            </button>
          ))}

          <div className="menu-label">ADMINISTRACIÓN</div>

          {menuVisible.filter((item) => ['usuarios', 'sucursales', 'configuracion'].includes(item.id)).map((item) => (
            <button
              key={item.id}
              className={`menu-item ${modulo === item.id ? 'active' : ''}`}
              onClick={() => setModulo(item.id)}
            >
              <span className="menu-icon">{item.icono}</span>
              <span>{item.nombre}</span>
            </button>
          ))}

        </nav>

        <div className="sidebar-bottom">

          <div className="logged-user">

            <div className="avatar">
              {sesion.nombre?.charAt(0)?.toUpperCase() || 'U'}
            </div>

            <div>
              <strong>{sesion.nombre}</strong>
              <span>{sesion.rol || 'Usuario'}</span>
            </div>

          </div>

          <button className="logout-menu" onClick={cerrarSesion}>
            🚪 Cerrar sesión
          </button>

        </div>

      </aside>

      <section className="erp-main">

        <header className="erp-header">

          <div>
            <span className="breadcrumb">TIENDA TIERI /</span>
            <h1>{tituloModulo}</h1>
          </div>

          <div className="header-actions">

            <div className="branch-info">
              <span>SUCURSAL</span>

              {esDueno ? <select value={sesion.sucursal_id || ''} onChange={cambiarSucursal}>{sucursales.filter((item) => item.activo).map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select> : <strong>{sesion.sucursal_nombre || `Sucursal ${sesion.sucursal_id || '-'}`}</strong>}
            </div>

            <div className="header-user">
              <strong>{sesion.nombre}</strong>
              <span>{sesion.rol || 'Usuario'}</span>
            </div>

          </div>

        </header>

        <div className="erp-content">

          {modulo === 'inicio' && (
            <>
              <section className="welcome">
                <div>
                  <h2>Bienvenido, {sesion.nombre}</h2>
                  <p>
                    Este es el centro de control de tu negocio.
                  </p>
                </div>
              </section>

              <section className="stats-grid">

                <article className="stat-card">
                  <span>Ventas de hoy</span>
                  <strong>Bs {Number(resumen?.ventas_hoy || 0).toFixed(2)}</strong>
                  <small>{resumen ? `${resumen.operaciones_hoy} venta(s)` : 'Cargando...'}</small>
                </article>

                {puedeVerGanancias && <article className="stat-card">
                  <span>Ganancia bruta de hoy</span>
                  <strong>Bs {Number(resumen?.ganancia_bruta_hoy || 0).toFixed(2)}</strong>
                  <small>{resumen?.ventas_sin_costo_hoy ? `${resumen.ventas_sin_costo_hoy} venta(s) con costo pendiente` : 'Costos y descuentos registrados'}</small>
                </article>}

                <article className="stat-card">
                  <span>Productos</span>
                  <strong>{resumen?.productos_total ?? '—'}</strong>
                  <small>Productos registrados</small>
                </article>

                <article className="stat-card">
                  <span>Stock bajo</span>
                  <strong>{resumen?.stock_bajo ?? '—'}</strong>
                  <small>Requieren atención</small>
                </article>

                <article className="stat-card">
                  <span>Caja</span>
                  <strong>{resumen?.caja_abierta ? `Bs ${Number(resumen.caja_saldo).toFixed(2)}` : 'Cerrada'}</strong>
                  <small>{resumen?.caja_abierta ? 'Efectivo esperado' : 'Abre caja para empezar'}</small>
                </article>

              </section>

              <h2 className="section-title">
                Acciones rápidas
              </h2>

              <section className="quick-actions">

                <button onClick={() => setModulo('ventas')}>
                  <span>🛒</span>
                  <strong>Nueva venta</strong>
                  <small>Abrir punto de venta</small>
                </button>

                <button onClick={() => setModulo('inventario')}>
                  <span>📦</span>
                  <strong>Inventario</strong>
                  <small>Consultar productos</small>
                </button>

                <button onClick={() => setModulo('cotizaciones')}>
                  <span>🧾</span>
                  <strong>Cotización</strong>
                  <small>Crear una cotización</small>
                </button>

                <button onClick={() => setModulo('caja')}>
                  <span>💰</span>
                  <strong>Caja</strong>
                  <small>Consultar caja</small>
                </button>

              </section>
            </>
          )}

          {modulo === 'inventario' && <InventarioErrorBoundary><Inventario usuario={sesion} /></InventarioErrorBoundary>}

          {modulo === 'ventas' && <Ventas usuario={sesion} ventaInicial={ventaInicial} onVentaInicialCargada={() => setVentaInicial(null)} />}

          {modulo === 'caja' && <Caja usuario={sesion} />}

          {modulo === 'configuracion' && <Configuracion usuario={sesion} />}

          {modulo === 'reportes' && <Reportes />}

          {modulo === 'cotizaciones' && <Cotizaciones usuario={sesion} onIrAVentas={(cotizacion) => { setVentaInicial(cotizacion); setModulo('ventas') }} />}
          {modulo === 'compras' && <Compras usuario={sesion} />}
          {modulo === 'clientes' && <Clientes usuario={sesion} />}

          {modulo === 'sucursales' && <Administracion usuario={sesion} />}

          {modulo === 'usuarios' && <Administracion usuario={sesion} vistaInicial="usuarios" />}

          {modulo !== 'inicio' && modulo !== 'inventario' && modulo !== 'ventas' && modulo !== 'caja' && modulo !== 'configuracion' && modulo !== 'reportes' && modulo !== 'cotizaciones' && modulo !== 'sucursales' && modulo !== 'usuarios' && (
            <section className="module-placeholder">

              <div className="placeholder-icon">
                {menu.find((item) => item.id === modulo)?.icono}
              </div>

              <h2>{tituloModulo}</h2>

              <p>
                Módulo preparado para su implementación.
              </p>

              <small>
                Aquí conectaremos las funciones reales con PostgreSQL.
              </small>

            </section>
          )}

        </div>

      </section>

    </main>
  )
}

export default App
