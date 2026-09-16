import { useState } from 'react'
import Inventario from './Inventario'
import Caja from './Caja'
import Ventas from './Ventas'
import Configuracion from './Configuracion'

function App() {
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [cargando, setCargando] = useState(false)
  const [sesion, setSesion] = useState(null)
  const [error, setError] = useState('')
  const [modulo, setModulo] = useState('inicio')

  const iniciarSesion = async (e) => {
    e.preventDefault()

    setError('')
    setCargando(true)

    try {
      const respuesta = await fetch('http://localhost:3000/api/login', {
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

  const menu = [
    { id: 'inicio', icono: '🏠', nombre: 'Inicio' },
    { id: 'ventas', icono: '🛒', nombre: 'Ventas' },
    { id: 'inventario', icono: '📦', nombre: 'Inventario' },
    { id: 'cotizaciones', icono: '🧾', nombre: 'Cotizaciones' },
    { id: 'compras', icono: '🛍️', nombre: 'Compras' },
    { id: 'caja', icono: '💰', nombre: 'Caja' },
    { id: 'clientes', icono: '👥', nombre: 'Clientes' },
    { id: 'proveedores', icono: '🚚', nombre: 'Proveedores' },
    { id: 'reportes', icono: '📊', nombre: 'Reportes' },
    { id: 'usuarios', icono: '👤', nombre: 'Usuarios' },
    { id: 'sucursales', icono: '🏪', nombre: 'Sucursales' },
    { id: 'configuracion', icono: '⚙️', nombre: 'Configuración' }
  ]

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

          {menu.slice(0, 9).map((item) => (
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

          {menu.slice(9).map((item) => (
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

              <strong>
                {sesion.sucursal_id === 2
                  ? 'Tienda Tieri - Principal'
                  : `Sucursal ${sesion.sucursal_id || '-'}`}
              </strong>
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
                  <strong>Bs 0,00</strong>
                  <small>Preparado para datos reales</small>
                </article>

                <article className="stat-card">
                  <span>Productos</span>
                  <strong>1</strong>
                  <small>Productos registrados</small>
                </article>

                <article className="stat-card">
                  <span>Stock bajo</span>
                  <strong>0</strong>
                  <small>Requieren atención</small>
                </article>

                <article className="stat-card">
                  <span>Caja</span>
                  <strong>Bs 0,00</strong>
                  <small>Estado de caja</small>
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

          {modulo === 'inventario' && <Inventario />}

          {modulo === 'ventas' && <Ventas usuario={sesion} />}

          {modulo === 'caja' && <Caja usuario={sesion} />}

          {modulo === 'configuracion' && <Configuracion usuario={sesion} />}

          {modulo !== 'inicio' && modulo !== 'inventario' && modulo !== 'ventas' && modulo !== 'caja' && modulo !== 'configuracion' && (
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
